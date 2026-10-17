import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/data/fetch-all";

/** Sede seleccionable en el filtro del tablero «Quién está aquí». */
export type BoardFacilityOption = { id: string; official_name: string; timezone: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Busca una sede por id con el cliente del usuario (RLS decide si la puede ver). */
export async function findFacility(supabase: ServerSupabase, id: unknown): Promise<BoardFacilityOption | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase.from("facilities").select("id, official_name, timezone").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

type ShiftFacilityRow = { facility: BoardFacilityOption | null };

/**
 * Sedes con guardias (no canceladas) que se traslapan con [from, to).
 * Para administración: evita enviar en cada actualización (cada 30 s) la lista
 * completa de instalaciones del directorio, que puede tener miles.
 */
export async function facilitiesWithShifts(supabase: ServerSupabase, from: Date, to: Date): Promise<BoardFacilityOption[]> {
  const rows = await fetchAll<ShiftFacilityRow>(
    (start, end) =>
      supabase
        .from("shifts")
        .select("facility:facilities!shifts_facility_id_fkey(id, official_name, timezone)")
        .lt("starts_at", to.toISOString())
        .gt("ends_at", from.toISOString())
        .neq("status", "cancelada")
        .order("id")
        .range(start, end) as unknown as PromiseLike<{ data: ShiftFacilityRow[] | null; error: { message: string } | null }>,
  );
  return mergeFacilityOptions(rows.map((r) => r.facility));
}

/** Une listas de sedes sin duplicados, ordenadas por nombre. */
export function mergeFacilityOptions(...lists: Array<Array<BoardFacilityOption | null> | BoardFacilityOption | null>): BoardFacilityOption[] {
  const byId = new Map<string, BoardFacilityOption>();
  for (const list of lists) {
    for (const f of Array.isArray(list) ? list : [list]) {
      if (f && !byId.has(f.id)) byId.set(f.id, { id: f.id, official_name: f.official_name, timezone: f.timezone });
    }
  }
  return [...byId.values()].sort((a, b) => a.official_name.localeCompare(b.official_name, "es"));
}
