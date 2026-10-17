import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import { loadShiftsWithAttendance, type ShiftWithAttendance } from "@/lib/attendance/load";
import { chunk } from "@/lib/data/fetch-all";
import { DEFAULT_TIMEZONE, dayRangeUtc } from "@/lib/time";
import type { FilterLabels } from "./document";
import type { ReportFilters } from "./params";
import { buildReportRows, type ReportRow } from "./rows";

const DAY_MS = 86_400_000;

export type LoadedReport = {
  rows: ReportRow[];
  /** Guardias completas (con sesiones) por si la vista necesita el detalle. */
  shifts: ShiftWithAttendance[];
};

/**
 * Carga el reporte con el cliente del usuario (RLS). El rango se amplía un día
 * a cada lado para cubrir sedes en otras zonas horarias; después se filtra por
 * la fecha LOCAL de inicio de cada guardia (zona de su sede). Solo guardias ya
 * iniciadas.
 */
export async function loadReport(supabase: ServerSupabase, filters: ReportFilters, now: Date = new Date()): Promise<LoadedReport> {
  const from = new Date(dayRangeUtc(filters.desde, DEFAULT_TIMEZONE).start.getTime() - DAY_MS);
  const rangeEnd = dayRangeUtc(filters.hasta, DEFAULT_TIMEZONE).end.getTime() + DAY_MS;
  // Las guardias que aún no inician no forman parte del historial.
  const to = new Date(Math.min(rangeEnd, now.getTime() + 1));
  if (to <= from) return { rows: [], shifts: [] };

  const includeCancelled = filters.attendance === "cancelada" || filters.attendance === "todas";
  const shifts = await loadShiftsWithAttendance(supabase, {
    from,
    to,
    facilityIds: filters.facilityId ? [filters.facilityId] : null,
    workerId: filters.workerId,
    stateId: filters.stateId,
    includeCancelled,
    now,
  });
  const rows = buildReportRows(shifts, {
    desde: filters.desde,
    hasta: filters.hasta,
    workerId: filters.workerId,
    attendance: filters.attendance,
    onlyStarted: true,
    now,
  });
  return { rows, shifts };
}

/** Nombres de los filtros aplicados (lo que RLS permita leer). */
export async function resolveFilterLabels(supabase: ServerSupabase, filters: ReportFilters): Promise<FilterLabels> {
  const [facility, state, worker] = await Promise.all([
    filters.facilityId
      ? supabase.from("facilities").select("official_name").eq("id", filters.facilityId).maybeSingle()
      : Promise.resolve({ data: null }),
    filters.stateId ? supabase.from("states").select("name").eq("id", filters.stateId).maybeSingle() : Promise.resolve({ data: null }),
    filters.workerId ? supabase.from("workers").select("full_name").eq("id", filters.workerId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    facility: (facility.data as { official_name: string } | null)?.official_name ?? null,
    state: (state.data as { name: string } | null)?.name ?? null,
    worker: (worker.data as { full_name: string } | null)?.full_name ?? null,
  };
}

/** Nombres visibles de cuentas de acceso (lo que RLS permita leer de `profiles`). */
export async function getProfileNames(supabase: ServerSupabase, ids: Array<string | null | undefined>): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names: Record<string, string> = {};
  for (const batch of chunk(unique)) {
    const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", batch);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) if (p.display_name) names[p.id] = p.display_name;
  }
  return names;
}

/** Cuenta de acceso vinculada a cada trabajador (si RLS permite verla). */
export async function getWorkerProfileIds(supabase: ServerSupabase, workerIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const batch of chunk([...new Set(workerIds)])) {
    const { data, error } = await supabase.from("profiles").select("id, worker_id").in("worker_id", batch);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) if (p.worker_id) out[p.worker_id] = p.id;
  }
  return out;
}

export type WorkerOption = { id: string; full_name: string; internal_code: string };

export const WORKER_OPTIONS_LIMIT = 1500;

/**
 * Personas visibles para el filtro (RLS), en orden alfabético. Con una sede
 * seleccionada se listan las adscritas a ella. Si hay más del límite se avisa;
 * la persona seleccionada siempre se incluye.
 */
export async function getWorkerOptions(
  supabase: ServerSupabase,
  options: { selectedId: string | null; facilityId?: string | null; limit?: number },
): Promise<{ workers: WorkerOption[]; truncated: boolean }> {
  const { selectedId, facilityId } = options;
  const limit = options.limit ?? WORKER_OPTIONS_LIMIT;
  let query = supabase.from("workers").select("id, full_name, internal_code").order("full_name").limit(limit + 1);
  if (facilityId) query = query.eq("facility_id", facilityId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as WorkerOption[];
  const workers = rows.slice(0, limit);
  if (selectedId && !workers.some((w) => w.id === selectedId)) {
    const { data: selected } = await supabase.from("workers").select("id, full_name, internal_code").eq("id", selectedId).maybeSingle();
    if (selected) workers.unshift(selected as WorkerOption);
  }
  return { workers, truncated: rows.length > limit };
}
