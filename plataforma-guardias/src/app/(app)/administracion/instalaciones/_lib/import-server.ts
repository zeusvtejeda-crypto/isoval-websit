import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/actions";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { getCategories, getMunicipalities, getStates } from "@/lib/data/catalogs";
import type {
  ExistingFacilityRef,
  FacilityImportCatalogs,
  FacilityImportRowResult,
  ImportApplyResult,
} from "@/lib/import/facilities";
import { resetRepeatedReason } from "./reason";

const EXISTING_SELECT =
  "id, internal_code, official_name, unit_key, category_id, description, state_id, municipality_id, address, latitude, longitude, phone, schedule, services, services_verified, source, source_url, last_verified_at, verification_status, notes, timezone, arrival_tolerance_minutes, is_demo, active, change_reason";

type ExistingWithReason = ExistingFacilityRef & { change_reason: string | null };

/**
 * Catálogos e instalaciones registradas (administración ve todas por RLS)
 * con los que se validan las filas del archivo.
 */
export async function loadFacilityImportData(
  supabase: ServerSupabase,
): Promise<{ catalogs: FacilityImportCatalogs; existing: ExistingFacilityRef[]; storedReasons: Map<string, string | null> }> {
  const [categories, states, municipalities, existing] = await Promise.all([
    getCategories(supabase),
    getStates(supabase),
    getMunicipalities(supabase),
    fetchAll<ExistingWithReason>((from, to) => supabase.from("facilities").select(EXISTING_SELECT).order("id").range(from, to)),
  ]);
  return {
    catalogs: {
      categories: categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name, active: c.active })),
      states: states.map((s) => ({ id: s.id, name: s.name, abbreviation: s.abbreviation, default_timezone: s.default_timezone })),
      municipalities: municipalities.map((m) => ({ id: m.id, state_id: m.state_id, name: m.name, inegi_code: m.inegi_code, timezone: m.timezone })),
    },
    existing,
    // Motivo guardado de cada instalación (para no repetirlo; ver resetRepeatedReason).
    storedReasons: new Map(existing.map((f) => [f.id, f.change_reason])),
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
 * Aplica solo las filas válidas: crea en lotes (si un lote falla se reintenta
 * fila por fila para identificar cuál no se pudo guardar) y actualiza una por
 * una con los campos que cambian. Cada escritura lleva el motivo para la bitácora.
 */
export async function applyFacilityImport(
  supabase: ServerSupabase,
  rows: FacilityImportRowResult[],
  reason: string,
  storedReasons: Map<string, string | null> = new Map(),
): Promise<Map<number, AppliedRow>> {
  const out = new Map<number, AppliedRow>();

  // --- Altas ---
  const creates = rows.filter(
    (r): r is FacilityImportRowResult & { create: NonNullable<FacilityImportRowResult["create"]> } => r.status === "nueva" && !!r.create,
  );
  for (const batch of chunk(creates, BATCH_SIZE)) {
    const { error } = await supabase.from("facilities").insert(batch.map((r) => ({ ...r.create, change_reason: reason })));
    if (!error) {
      for (const r of batch) out.set(r.row, { result: "creada" });
      continue;
    }
    for (const r of batch) {
      const { error: rowError } = await supabase.from("facilities").insert({ ...r.create, change_reason: reason });
      out.set(r.row, rowError ? { result: "fallo", message: friendlyDbError(rowError, "No se pudo crear la instalación.") } : { result: "creada" });
    }
  }

  // --- Actualizaciones ---
  const updates = rows.filter((r) => r.status === "actualizacion" && r.targetId);
  for (const r of updates) if (r.noop || !r.patch) out.set(r.row, { result: "sin_cambios" });

  await forEachLimit(
    updates.filter((r) => !r.noop && r.patch),
    UPDATE_CONCURRENCY,
    async (r) => {
      const id = r.targetId as string;
      const resetError = await resetRepeatedReason(supabase, id, storedReasons.get(id), reason);
      if (resetError) {
        out.set(r.row, { result: "fallo", message: friendlyDbError(resetError, "No se pudo actualizar.") });
        return;
      }
      const { data, error } = await supabase
        .from("facilities")
        .update({ ...r.patch, change_reason: reason })
        .eq("id", id)
        .select("id");
      if (error || !data || data.length === 0) {
        out.set(r.row, {
          result: "fallo",
          message: error ? friendlyDbError(error, "No se pudo actualizar.") : "No tienes permiso para modificar esta instalación o ya no existe.",
        });
        return;
      }
      out.set(r.row, { result: "actualizada" });
    },
  );

  return out;
}
