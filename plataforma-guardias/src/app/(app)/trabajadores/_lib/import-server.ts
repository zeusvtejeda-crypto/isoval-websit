import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/actions";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { getMunicipalities, getStates } from "@/lib/data/catalogs";
import { EMPLOYEE_NUMBER_TAKEN, employeeNumberKey } from "@/lib/validation/worker";
import type {
  ExistingWorkerRef,
  ImportApplyResult,
  ImportFacilityRef,
  WorkerImportContext,
  WorkerImportMode,
  WorkerImportRowResult,
} from "@/lib/import/workers";

/**
 * Catálogos y trabajadores visibles para la cuenta (RLS) con los que se
 * validan las filas del archivo. Los números de trabajador del archivo que la
 * cuenta no ve se comprueban aparte (employee_numbers_taken: solo sí/no), para
 * detectar los que ya pertenecen a alguien de otra sede.
 */
export async function loadImportContext(
  supabase: ServerSupabase,
  user: SessionUser,
  mode: WorkerImportMode,
  fileEmployeeNumbers: string[] = [],
): Promise<WorkerImportContext> {
  const [states, municipalities, facilities, workers, privates] = await Promise.all([
    getStates(supabase),
    getMunicipalities(supabase),
    fetchAll<ImportFacilityRef>((from, to) =>
      supabase.from("facilities").select("id, internal_code, unit_key, official_name, state_id, active").order("official_name").range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("workers")
        .select("id, internal_code, full_name, state_id, municipality_id, facility_id, area, position, usual_shift, active")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) => supabase.from("worker_private").select("worker_id, employee_number, phone").order("worker_id").range(from, to)),
  ]);

  const privateById = new Map(privates.map((p) => [p.worker_id, p]));
  const existing: ExistingWorkerRef[] = workers.map((w) => {
    const p = privateById.get(w.id);
    return { ...w, employee_number: p?.employee_number ?? null, phone: p?.phone ?? null };
  });

  const visibleNumbers = new Set(privates.map((p) => employeeNumberKey(p.employee_number)).filter(Boolean));
  const hidden = [...new Set(fileEmployeeNumbers.map(employeeNumberKey))].filter((k): k is string => !!k && !visibleNumbers.has(k));
  const takenEmployeeNumbers: string[] = [];
  for (const batch of chunk(hidden, 1000)) {
    const { data, error } = await supabase.rpc("employee_numbers_taken", { p_numbers: batch });
    if (error) throw new Error(error.message);
    takenEmployeeNumbers.push(...(data ?? []));
  }

  return {
    mode,
    scope: { isAdmin: user.isAdmin, facilityIds: user.facilityIds },
    states: states.map((s) => ({ id: s.id, name: s.name, abbreviation: s.abbreviation })),
    municipalities: municipalities.map((m) => ({ id: m.id, state_id: m.state_id, name: m.name, inegi_code: m.inegi_code })),
    facilities,
    existing,
    takenEmployeeNumbers,
  };
}

export type AppliedRow = { result: ImportApplyResult; message?: string };

const BATCH_SIZE = 200;
const UPDATE_CONCURRENCY = 6;

async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

type CreateRowResult = { ok: boolean; taken: boolean; code?: string; message?: string };

/** Resultado por fila de create_workers (mismo orden que las filas enviadas). */
function parseCreateResults(data: unknown): CreateRowResult[] {
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      ok: o.ok === true,
      taken: o.taken === true,
      code: typeof o.code === "string" ? o.code : undefined,
      message: typeof o.message === "string" ? o.message : undefined,
    };
  });
}

type CurrentPrivate = { employee_number: string | null; phone: string | null };

/** Datos privados actuales de los registros que se actualizan (para escribir solo lo que cambia). */
async function loadCurrentPrivate(supabase: ServerSupabase, workerIds: string[]): Promise<Map<string, CurrentPrivate>> {
  const out = new Map<string, CurrentPrivate>();
  for (const batch of chunk(workerIds)) {
    const { data, error } = await supabase.from("worker_private").select("worker_id, employee_number, phone").in("worker_id", batch);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) out.set(p.worker_id, { employee_number: p.employee_number, phone: p.phone });
  }
  return out;
}

/**
 * Aplica las filas válidas: crea en lotes con create_workers (cada alta con sus
 * datos privados es atómica: si el número de trabajador ya existe, aunque sea
 * en otra sede, no queda nada creado) y actualiza una por una. En las
 * actualizaciones el teléfono se escribe directamente y el número de
 * trabajador con set_employee_number (consume la cuota de comprobación).
 */
export async function applyWorkerImport(
  supabase: ServerSupabase,
  rows: WorkerImportRowResult[],
  reason: string,
): Promise<Map<number, AppliedRow>> {
  const out = new Map<number, AppliedRow>();

  // --- Altas ---
  const creates = rows.filter(
    (r): r is WorkerImportRowResult & { create: NonNullable<WorkerImportRowResult["create"]> } => r.status === "nueva" && !!r.create,
  );
  for (const batch of chunk(creates, BATCH_SIZE)) {
    const payload = batch.map((r) => ({ ...r.create, employee_number: r.privateData?.employee_number ?? null, phone: r.privateData?.phone ?? null }));
    const { data, error } = await supabase.rpc("create_workers", { p_rows: payload, p_change_reason: reason });
    const results = error ? [] : parseCreateResults(data);
    batch.forEach((r, i) => {
      const res = results[i];
      if (res?.ok) out.set(r.row, { result: "creada" });
      else if (res?.taken) out.set(r.row, { result: "fallo", message: EMPLOYEE_NUMBER_TAKEN });
      else {
        const cause = error ?? (res ? { code: res.code, message: res.message } : null);
        out.set(r.row, { result: "fallo", message: friendlyDbError(cause, "No se pudo crear el registro.") });
      }
    });
  }

  // --- Actualizaciones ---
  const updates = rows.filter((r) => r.status === "actualizacion" && r.targetId);
  for (const r of updates) if (r.noop) out.set(r.row, { result: "sin_cambios" });

  let pending = updates.filter((r) => !r.noop);
  let currentPrivate = new Map<string, CurrentPrivate>();
  try {
    currentPrivate = await loadCurrentPrivate(
      supabase,
      pending.filter((r) => r.privateData).map((r) => r.targetId as string),
    );
  } catch {
    // Sin los datos actuales no se sabe qué cambia: esas filas no se tocan.
    for (const r of pending) if (r.privateData) out.set(r.row, { result: "fallo", message: "No se pudieron leer los datos privados actuales." });
    pending = pending.filter((r) => !r.privateData);
  }

  await forEachLimit(
    pending,
    UPDATE_CONCURRENCY,
    async (r) => {
      const workerId = r.targetId as string;
      if (r.patch) {
        const { data, error } = await supabase
          .from("workers")
          .update({ ...r.patch, change_reason: reason })
          .eq("id", workerId)
          .select("id");
        if (error || !data || data.length === 0) {
          out.set(r.row, {
            result: "fallo",
            message: error ? friendlyDbError(error, "No se pudo actualizar.") : "No tienes permiso para modificar este registro o ya no existe.",
          });
          return;
        }
      }
      if (r.privateData) {
        const current = currentPrivate.get(workerId);
        const phoneChanged = r.privateData.phone !== (current?.phone ?? null);
        const numberChanged = r.privateData.employee_number !== (current?.employee_number ?? null);
        let phoneWritten = false;
        let problem: string | null = null;
        let missing = "";
        if (phoneChanged) {
          const { error } = await supabase
            .from("worker_private")
            .upsert({ worker_id: workerId, phone: r.privateData.phone, change_reason: reason }, { onConflict: "worker_id" });
          if (error) {
            problem = friendlyDbError(error, "No se pudieron guardar los datos privados.");
            missing = numberChanged ? "el número de trabajador ni el teléfono" : "el teléfono";
          } else phoneWritten = true;
        }
        if (!problem && numberChanged) {
          const { data, error } = await supabase.rpc("set_employee_number", {
            p_worker_id: workerId,
            p_number: r.privateData.employee_number ?? "",
            p_reason: reason,
          });
          if (error || data === "taken") {
            problem = error ? friendlyDbError(error, "No se pudo guardar el número de trabajador.") : EMPLOYEE_NUMBER_TAKEN;
            missing = "el número de trabajador";
          }
        }
        if (problem) {
          const saved = [r.patch ? "los datos generales" : null, phoneWritten ? "el teléfono" : null].filter(Boolean);
          out.set(
            r.row,
            saved.length
              ? { result: "actualizada", message: `Se actualizaron ${saved.join(" y ")}, pero no ${missing}: ${problem}` }
              : { result: "fallo", message: problem },
          );
          return;
        }
      }
      out.set(r.row, { result: "actualizada" });
    },
  );

  return out;
}
