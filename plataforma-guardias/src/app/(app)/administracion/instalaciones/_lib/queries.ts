import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import { buildSearchPattern, pageRange, type FacilityListFilters } from "@/lib/validation/facility";

export type FacilityRow = Database["public"]["Tables"]["facilities"]["Row"];

type FacilityListBase = Pick<
  FacilityRow,
  | "id"
  | "internal_code"
  | "official_name"
  | "unit_key"
  | "category_id"
  | "state_id"
  | "municipality_id"
  | "verification_status"
  | "last_verified_at"
  | "is_demo"
  | "is_public"
  | "active"
  | "latitude"
  | "longitude"
  | "source"
  | "updated_at"
>;

export type FacilityListItem = FacilityListBase & {
  category: { id: number; name: string; color: string } | null;
  state: { id: number; name: string; abbreviation: string } | null;
  municipality: { id: number; name: string } | null;
};

function oneOrNull<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

const LIST_SELECT =
  "id, internal_code, official_name, unit_key, category_id, state_id, municipality_id, verification_status, last_verified_at, is_demo, is_public, active, latitude, longitude, source, updated_at, category:facility_categories!facilities_category_id_fkey(id, name, color), state:states!facilities_state_id_fkey(id, name, abbreviation), municipality:municipalities!facilities_municipality_state_fk(id, name)";

/**
 * Lista paginada de instalaciones con conteo. Administración ve todas (RLS).
 * Busca por nombre normalizado, clave de unidad o identificador interno.
 */
export async function listFacilities(
  supabase: ServerSupabase,
  filters: FacilityListFilters,
): Promise<{ items: FacilityListItem[]; total: number; outOfRange: boolean }> {
  const pattern = buildSearchPattern(filters.q);
  if (filters.q && !pattern) return { items: [], total: 0, outOfRange: false };

  const build = (head: boolean) => {
    let q = supabase.from("facilities").select(LIST_SELECT, { count: "exact", head });
    if (filters.categoryId) q = q.eq("category_id", filters.categoryId);
    if (filters.stateId) q = q.eq("state_id", filters.stateId);
    if (filters.stateId && filters.municipalityId) q = q.eq("municipality_id", filters.municipalityId);
    if (filters.verification) q = q.eq("verification_status", filters.verification);
    if (filters.dataKind === "demo") q = q.eq("is_demo", true);
    else if (filters.dataKind === "produccion") q = q.eq("is_demo", false);
    if (filters.active === "activas") q = q.eq("active", true);
    else if (filters.active === "inactivas") q = q.eq("active", false);
    if (pattern) {
      // El patrón solo contiene letras, números, guiones y «%» (seguro en .or()).
      q = q.or(`normalized_name.ilike.${pattern},unit_key.ilike.${pattern},internal_code.ilike.${pattern}`);
    }
    return q;
  };

  const { from, to } = pageRange(filters.page);
  const { data, error, count } = await build(false).order("normalized_name").order("id").range(from, to);
  if (error) {
    // PostgREST responde PGRST103 si la página pedida no existe.
    if (error.code === "PGRST103") {
      const { count: total, error: countError } = await build(true);
      if (countError) throw new Error(countError.message);
      return { items: [], total: total ?? 0, outOfRange: true };
    }
    throw new Error(error.message);
  }
  type Embedded = FacilityListBase & {
    category: FacilityListItem["category"] | FacilityListItem["category"][];
    state: FacilityListItem["state"] | FacilityListItem["state"][];
    municipality: FacilityListItem["municipality"] | FacilityListItem["municipality"][];
  };
  const items: FacilityListItem[] = ((data ?? []) as unknown as Embedded[]).map((r) => ({
    ...r,
    category: oneOrNull(r.category),
    state: oneOrNull(r.state),
    municipality: oneOrNull(r.municipality),
  }));
  const total = count ?? items.length;
  return { items, total, outOfRange: items.length === 0 && total > 0 && filters.page > 1 };
}

/** Instalación completa (administración); null si no existe. */
export async function getFacility(supabase: ServerSupabase, id: string): Promise<FacilityRow | null> {
  const { data, error } = await supabase.from("facilities").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export type FacilityRelations = {
  workers: number;
  shifts: number;
  attendance: number;
  corrections: number;
  incidentNotes: number;
  scopes: number;
};

type RelatedTable = "workers" | "shifts" | "attendance_sessions" | "correction_requests" | "incident_notes" | "user_facility_scopes";

/** Cuenta los registros relacionados con la instalación (todo lo que impide borrarla). */
export async function countFacilityRelations(supabase: ServerSupabase, facilityId: string): Promise<FacilityRelations> {
  const countOf = async (table: RelatedTable) => {
    // facility_id es legible en todas estas tablas (algunas ya tienen permisos por columna).
    const { count, error } = await supabase.from(table).select("facility_id", { count: "exact", head: true }).eq("facility_id", facilityId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const [workers, shifts, attendance, corrections, incidentNotes, scopes] = await Promise.all([
    countOf("workers"),
    countOf("shifts"),
    countOf("attendance_sessions"),
    countOf("correction_requests"),
    countOf("incident_notes"),
    countOf("user_facility_scopes"),
  ]);
  return { workers, shifts, attendance, corrections, incidentNotes, scopes };
}

/** Descripción legible de las relaciones (vacía si no hay ninguna). */
export function describeRelations(r: FacilityRelations): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    r.workers ? plural(r.workers, "trabajador adscrito", "trabajadores adscritos") : "",
    r.shifts ? plural(r.shifts, "guardia", "guardias") : "",
    r.attendance ? plural(r.attendance, "registro de asistencia", "registros de asistencia") : "",
    r.corrections ? plural(r.corrections, "solicitud de corrección", "solicitudes de corrección") : "",
    r.incidentNotes ? plural(r.incidentNotes, "nota de incidencia", "notas de incidencias") : "",
    r.scopes ? plural(r.scopes, "cuenta con esta sede asignada", "cuentas con esta sede asignada") : "",
  ].filter(Boolean);
}
