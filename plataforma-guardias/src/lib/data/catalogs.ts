import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import { fetchAll } from "./fetch-all";

export type State = Pick<Database["public"]["Tables"]["states"]["Row"], "id" | "name" | "abbreviation" | "default_timezone" | "enabled">;
export type Municipality = Pick<Database["public"]["Tables"]["municipalities"]["Row"], "id" | "state_id" | "name" | "inegi_code" | "timezone">;
export type Category = Database["public"]["Tables"]["facility_categories"]["Row"];
export type FacilityOption = { id: string; official_name: string; timezone: string; state_id: number; municipality_id: number | null; is_demo: boolean };

export async function getStates(supabase: ServerSupabase, onlyEnabled = false): Promise<State[]> {
  let q = supabase.from("states").select("id, name, abbreviation, default_timezone, enabled").order("name");
  if (onlyEnabled) q = q.eq("enabled", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getMunicipalities(supabase: ServerSupabase, stateId?: number): Promise<Municipality[]> {
  return fetchAll((from, to) => {
    let q = supabase.from("municipalities").select("id, state_id, name, inegi_code, timezone").order("name").range(from, to);
    if (stateId) q = q.eq("state_id", stateId);
    return q;
  });
}

export async function getCategories(supabase: ServerSupabase, onlyActive = false): Promise<Category[]> {
  let q = supabase.from("facility_categories").select("*").order("sort_order").order("name");
  if (onlyActive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Instalaciones que el usuario puede gestionar o consultar en vistas privadas.
 * Si se pasan facilityIds (alcance del coordinador) se limita a ellas; RLS
 * aplica de todos modos.
 */
export async function getFacilityOptions(supabase: ServerSupabase, facilityIds?: string[] | null): Promise<FacilityOption[]> {
  if (facilityIds && facilityIds.length === 0) return [];
  return fetchAll((from, to) => {
    let q = supabase
      .from("facilities")
      .select("id, official_name, timezone, state_id, municipality_id, is_demo")
      .eq("active", true)
      .order("official_name")
      .range(from, to);
    if (facilityIds) q = q.in("id", facilityIds);
    return q;
  });
}

/** Lee un valor numérico de app_settings con valor por omisión. */
export async function getSettingNumber(supabase: ServerSupabase, key: string, field: string, fallback: number): Promise<number> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  const value = (data?.value as Record<string, unknown> | null)?.[field];
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Para mostrar en selectores: agrega la clave INEGI a los municipios cuyo nombre
 * se repite dentro de la misma entidad (p. ej. dos «San Juan Mixtepec» en Oaxaca).
 * No usar para comparar nombres (los importadores usan el nombre oficial).
 */
export function labelRepeatedMunicipalities<T extends { state_id: number; name: string; inegi_code: string }>(rows: T[]): T[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(`${r.state_id}|${r.name}`, (count.get(`${r.state_id}|${r.name}`) ?? 0) + 1);
  return rows.map((r) => ((count.get(`${r.state_id}|${r.name}`) ?? 0) > 1 ? { ...r, name: `${r.name} (clave INEGI ${r.inegi_code})` } : r));
}
