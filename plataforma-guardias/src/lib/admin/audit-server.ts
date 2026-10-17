import "server-only";
import type { SessionUser } from "@/lib/auth";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { AUDIT_PAGE_SIZE, auditTimeRange, pageBounds, type AuditFilters } from "./audit-filters";
import { shortId } from "./audit-diff";

export type AuditEventRow = Database["public"]["Tables"]["audit_log"]["Row"];

const AUDIT_SELECT = "id, occurred_at, actor_id, actor_role, table_name, record_id, action, old_data, new_data, changed_fields, reason, facility_id";

/**
 * Una página de la bitácora con los filtros. RLS limita el alcance:
 * administración ve todo; coordinación y auditoría solo eventos de sus sedes.
 */
export async function loadAuditPage(
  supabase: ServerSupabase,
  filters: AuditFilters,
  timeZone: string,
): Promise<{ events: AuditEventRow[]; total: number; outOfRange: boolean }> {
  const { gte, lt } = auditTimeRange(filters, timeZone);
  const { from, to } = pageBounds(filters.page, AUDIT_PAGE_SIZE);
  let q = supabase
    .from("audit_log")
    .select(AUDIT_SELECT, { count: "exact" })
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (filters.table) q = q.eq("table_name", filters.table);
  if (filters.action) q = q.eq("action", filters.action);
  if (gte) q = q.gte("occurred_at", gte);
  if (lt) q = q.lt("occurred_at", lt);
  if (filters.facilityId) q = q.eq("facility_id", filters.facilityId);
  if (filters.actorId) q = q.eq("actor_id", filters.actorId);

  const { data, count, error } = await q;
  if (error) {
    // Página fuera de rango (PostgREST 416): se informa sin romper la vista.
    if (error.code === "PGRST103") return { events: [], total: count ?? 0, outOfRange: true };
    throw new Error(error.message);
  }
  return { events: (data ?? []) as AuditEventRow[], total: count ?? 0, outOfRange: false };
}

export type AuditLookups = {
  /** Sedes para el filtro (todas para administración; las asignadas para los demás). */
  facilityOptions: { id: string; name: string }[];
  facilityNames: Record<string, string>;
  /** Zona horaria de cada sede conocida (para mostrar las fechas del detalle). */
  facilityTimezones: Record<string, string>;
  categoryNames: Record<string, string>;
  stateNames: Record<string, string>;
  /** Nombres de municipios referenciados en la página. */
  municipalityNames: Record<string, string>;
  /** Nombres visibles que RLS permite leer. */
  profileNames: Record<string, string>;
  /** Nombres de trabajadores referenciados en la página (solo los que RLS permite leer). */
  workerNames: Record<string, string>;
  authorOptions: { id: string; name: string; role: Database["public"]["Enums"]["app_role"] }[];
};

export async function loadAuditLookups(
  supabase: ServerSupabase,
  user: SessionUser,
  eventFacilityIds: readonly string[],
  eventWorkerIds: readonly string[] = [],
  eventMunicipalityIds: readonly string[] = [],
): Promise<AuditLookups> {
  type FacilityRow = { id: string; official_name: string; timezone: string };
  type ProfileRow = { id: string; display_name: string | null; role: Database["public"]["Enums"]["app_role"] };

  const facilitiesPromise: Promise<FacilityRow[]> = user.isAdmin
    ? fetchAll<FacilityRow>((from, to) =>
        supabase.from("facilities").select("id, official_name, timezone").order("official_name").order("id").range(from, to),
      )
    : user.facilityIds.length
      ? fetchAll<FacilityRow>((from, to) =>
          supabase
            .from("facilities")
            .select("id, official_name, timezone")
            .in("id", user.facilityIds)
            .order("official_name")
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([]);

  const [facilities, categoriesRes, statesRes, profiles] = await Promise.all([
    facilitiesPromise,
    supabase.from("facility_categories").select("id, name"),
    supabase.from("states").select("id, name"),
    fetchAll<ProfileRow>((from, to) => supabase.from("profiles").select("id, display_name, role").order("display_name").order("id").range(from, to)),
  ]);

  const facilityNames: Record<string, string> = Object.fromEntries(facilities.map((f) => [f.id, f.official_name]));
  const facilityTimezones: Record<string, string> = Object.fromEntries(facilities.map((f) => [f.id, f.timezone]));
  const missing = [...new Set(eventFacilityIds)].filter((id) => !(id in facilityNames));
  for (const part of chunk(missing)) {
    const { data } = await supabase.from("facilities").select("id, official_name, timezone").in("id", part);
    for (const f of data ?? []) {
      facilityNames[f.id] = f.official_name;
      facilityTimezones[f.id] = f.timezone;
    }
  }

  const workerNames: Record<string, string> = {};
  for (const part of chunk([...new Set(eventWorkerIds)])) {
    const { data } = await supabase.from("workers").select("id, full_name").in("id", part);
    for (const w of data ?? []) workerNames[w.id] = w.full_name;
  }

  const municipalityNames: Record<string, string> = {};
  const municipalityIds = [...new Set(eventMunicipalityIds)].map(Number).filter((n) => Number.isInteger(n) && n > 0);
  for (const part of chunk(municipalityIds)) {
    const { data } = await supabase.from("municipalities").select("id, name").in("id", part);
    for (const m of data ?? []) municipalityNames[String(m.id)] = m.name;
  }

  const profileNames: Record<string, string> = {};
  for (const p of profiles) if (p.display_name?.trim()) profileNames[p.id] = p.display_name.trim();

  return {
    facilityOptions: facilities.map((f) => ({ id: f.id, name: f.official_name })),
    facilityNames,
    facilityTimezones,
    categoryNames: Object.fromEntries((categoriesRes.data ?? []).map((c) => [String(c.id), c.name])),
    stateNames: Object.fromEntries((statesRes.data ?? []).map((s) => [String(s.id), s.name])),
    municipalityNames,
    profileNames,
    workerNames,
    authorOptions: profiles
      .map((p) => ({ id: p.id, name: p.display_name?.trim() || `Usuario ${shortId(p.id)}`, role: p.role }))
      .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
  };
}
