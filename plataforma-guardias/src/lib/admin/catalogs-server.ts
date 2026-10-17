import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/data/fetch-all";
import { countByState, type MunicipalityRow, type StateRow } from "./catalogs";

export type StateOverview = StateRow & { municipalities: number; facilities: number };

/** Entidades con conteo de municipios e instalaciones registradas (RLS de administración). */
export async function loadStatesOverview(supabase: ServerSupabase): Promise<StateOverview[]> {
  const [statesRes, municipalities, facilities] = await Promise.all([
    supabase.from("states").select("id, name, abbreviation, default_timezone, enabled").order("id"),
    fetchAll<{ state_id: number }>((from, to) => supabase.from("municipalities").select("state_id").order("id").range(from, to)),
    fetchAll<{ state_id: number }>((from, to) => supabase.from("facilities").select("state_id").order("id").range(from, to)),
  ]);
  if (statesRes.error) throw new Error(statesRes.error.message);
  const municipalityCount = countByState(municipalities);
  const facilityCount = countByState(facilities);
  return (statesRes.data ?? []).map((s) => ({
    ...s,
    municipalities: municipalityCount[s.id] ?? 0,
    facilities: facilityCount[s.id] ?? 0,
  }));
}

/** Municipios de una entidad, por clave INEGI. */
export async function loadStateMunicipalities(supabase: ServerSupabase, stateId: number): Promise<MunicipalityRow[]> {
  return fetchAll<MunicipalityRow>((from, to) =>
    supabase
      .from("municipalities")
      .select("id, state_id, inegi_code, name, timezone")
      .eq("state_id", stateId)
      .order("inegi_code")
      .order("id")
      .range(from, to),
  );
}
