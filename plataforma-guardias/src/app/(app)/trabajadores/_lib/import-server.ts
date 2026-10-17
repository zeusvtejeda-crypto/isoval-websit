import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/actions";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { getMunicipalities, getStates } from "@/lib/data/catalogs";
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
 * validan las filas del archivo.
 */
export async function loadImportContext(supabase: ServerSupabase, user: SessionUser, mode: WorkerImportMode): Promise<WorkerImportContext> {
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

  return {
    mode,
    scope: { isAdmin: user.isAdmin, facilityIds: user.facilityIds },
    states: states.map((s) => ({ id: s.id, name: s.name, abbreviation: s.abbreviation })),
    municipalities: municipalities.map((m) => ({ id: m.id, state_id: m.state_id, name: m.name, inegi_code: m.inegi_code })),
    facilities,
    existing,
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

/**
 * Aplica las filas válidas: crea (en lotes, con id generado aquí para enlazar
 * los datos privados) y actualiza (una por una). Si un lote falla se reintenta
 * fila por fila para identificar cuál no se pudo guardar.
 */
export async function applyWorkerImport(
  supabase: ServerSupabase,
  rows: WorkerImportRowResult[],
  reason: string,
): Promise<Map<number, AppliedRow>> {
  const out = new Map<number, AppliedRow>();

  // --- Altas ---
  const creates = rows
    .filter((r): r is WorkerImportRowResult & { create: NonNullable<WorkerImportRowResult["create"]> } => r.status === "nueva" && !!r.create)
    .map((r) => ({ r, id: crypto.randomUUID() }));
  const created: typeof creates = [];

  for (const batch of chunk(creates, BATCH_SIZE)) {
    const payload = batch.map(({ r, id }) => ({ id, ...r.create, change_reason: reason }));
    const { error } = await supabase.from("workers").insert(payload);
    if (!error) {
      created.push(...batch);
      continue;
    }
    for (const item of batch) {
      const { error: rowError } = await supabase.from("workers").insert({ id: item.id, ...item.r.create, change_reason: reason });
      if (rowError) out.set(item.r.row, { result: "fallo", message: friendlyDbError(rowError, "No se pudo crear el registro.") });
      else created.push(item);
    }
  }
  for (const item of created) out.set(item.r.row, { result: "creada" });

  const createdPrivate = created.filter((c) => c.r.privateData);
  for (const batch of chunk(createdPrivate, BATCH_SIZE)) {
    const payload = batch.map(({ r, id }) => ({ worker_id: id, ...r.privateData!, change_reason: reason }));
    const { error } = await supabase.from("worker_private").insert(payload);
    if (!error) continue;
    for (const item of batch) {
      const { error: rowError } = await supabase.from("worker_private").insert({ worker_id: item.id, ...item.r.privateData!, change_reason: reason });
      if (rowError) {
        out.set(item.r.row, {
          result: "creada",
          message: `Se creó el registro, pero no se guardaron el número de trabajador ni el teléfono: ${friendlyDbError(rowError)} Corrígelo desde la ficha del trabajador.`,
        });
      }
    }
  }

  // --- Actualizaciones ---
  const updates = rows.filter((r) => r.status === "actualizacion" && r.targetId);
  for (const r of updates) if (r.noop) out.set(r.row, { result: "sin_cambios" });

  await forEachLimit(
    updates.filter((r) => !r.noop),
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
        const { error } = await supabase
          .from("worker_private")
          .upsert({ worker_id: workerId, ...r.privateData, change_reason: reason }, { onConflict: "worker_id" });
        if (error) {
          out.set(
            r.row,
            r.patch
              ? {
                  result: "actualizada",
                  message: `Se actualizaron los datos generales, pero no el número de trabajador ni el teléfono: ${friendlyDbError(error)}`,
                }
              : { result: "fallo", message: friendlyDbError(error, "No se pudieron guardar los datos privados.") },
          );
          return;
        }
      }
      out.set(r.row, { result: "actualizada" });
    },
  );

  return out;
}
