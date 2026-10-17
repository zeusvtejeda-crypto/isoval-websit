import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import { canManageFacility, type AppRole, type SessionUser } from "@/lib/auth";
import { getFacilityOptions, getMunicipalities, labelRepeatedMunicipalities, getStates, type FacilityOption, type Municipality, type State } from "@/lib/data/catalogs";
import {
  NO_FACILITY,
  buildSearchPattern,
  canSeeWorkerAccount,
  employeeNumberPattern,
  escapeLike,
  pageRange,
  type WorkerListFilters,
} from "@/lib/validation/worker";

type WorkerRow = Database["public"]["Tables"]["workers"]["Row"];

export type WorkerListItem = {
  id: string;
  internal_code: string;
  full_name: string;
  area: string | null;
  position: string | null;
  usual_shift: string | null;
  active: boolean;
  is_demo: boolean;
  /** Sede de adscripción (puede existir aunque RLS no deje ver sus datos). */
  facilityId: string | null;
  facility: { id: string; official_name: string } | null;
  account: { role: AppRole; active: boolean } | null;
  /**
   * false cuando RLS no deja ver la cuenta: coordinación y auditoría solo ven
   * los perfiles del personal adscrito a sus sedes (no el de otra sede que
   * aparece por una asignación). Entonces no se afirma «Sin cuenta».
   */
  accountVisible: boolean;
};

type AccountEmbed = { role: AppRole; active: boolean };

function oneOrNull<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

const LIST_SELECT =
  "id, internal_code, full_name, area, position, usual_shift, active, is_demo, facility_id, facility:facilities!workers_facility_id_fkey(id, official_name), profiles!profiles_worker_id_fkey(role, active)";

/** Sedes para filtros (consulta): administración = todas; resto = su alcance. */
export function getVisibleFacilityOptions(supabase: ServerSupabase, user: SessionUser): Promise<FacilityOption[]> {
  return getFacilityOptions(supabase, user.isAdmin ? null : user.facilityIds);
}

/** Sedes activas donde el usuario puede dar de alta o mover trabajadores. */
export async function getManageableFacilityOptions(supabase: ServerSupabase, user: SessionUser): Promise<FacilityOption[]> {
  if (!user.canManage) return [];
  const options = await getFacilityOptions(supabase, user.isAdmin ? null : user.facilityIds);
  return options.filter((f) => canManageFacility(user, f.id));
}

/**
 * Lista paginada con conteo. RLS limita lo visible. La búsqueda por número de
 * trabajador solo se usa si la cuenta puede gestionar (worker_private).
 * El filtro con/sin cuenta se limita a las sedes donde la cuenta ve perfiles
 * (si no, quien no tiene perfil visible aparecería como «sin cuenta»).
 */
export async function listWorkers(
  supabase: ServerSupabase,
  filters: WorkerListFilters,
  opts: { searchPrivate: boolean; user: Pick<SessionUser, "isAdmin" | "facilityIds"> },
): Promise<{ items: WorkerListItem[]; total: number; outOfRange: boolean }> {
  const profileScope = opts.user.isAdmin ? null : opts.user.facilityIds;
  if (filters.account && profileScope && profileScope.length === 0) return { items: [], total: 0, outOfRange: false };
  const pattern = buildSearchPattern(filters.q);
  let privateIds: string[] = [];
  if (filters.q && opts.searchPrivate) {
    const numberPattern = employeeNumberPattern(filters.q);
    if (numberPattern) {
      const { data, error } = await supabase.from("worker_private").select("worker_id").ilike("employee_number", numberPattern).limit(100);
      if (error) throw new Error(error.message);
      privateIds = (data ?? []).map((r) => r.worker_id);
    }
  }
  if (filters.q && !pattern && privateIds.length === 0) return { items: [], total: 0, outOfRange: false };

  const build = (head: boolean) => {
    let q = supabase.from("workers").select(LIST_SELECT, { count: "exact", head });
    if (filters.stateId) q = q.eq("state_id", filters.stateId);
    if (filters.stateId && filters.municipalityId) q = q.eq("municipality_id", filters.municipalityId);
    if (filters.facility === NO_FACILITY) q = q.is("facility_id", null);
    else if (filters.facility) q = q.eq("facility_id", filters.facility);
    if (filters.area) q = q.ilike("area", `%${escapeLike(filters.area)}%`);
    if (filters.status === "activos") q = q.eq("active", true);
    else if (filters.status === "inactivos") q = q.eq("active", false);
    if (filters.account && profileScope) q = q.in("facility_id", profileScope);
    if (filters.account === "con") q = q.not("profiles", "is", null);
    else if (filters.account === "sin") q = q.is("profiles", null);
    if (filters.q) {
      const ors: string[] = [];
      if (pattern) ors.push(`normalized_name.ilike.${pattern}`, `internal_code.ilike.${pattern}`);
      if (privateIds.length) ors.push(`id.in.(${privateIds.join(",")})`);
      q = q.or(ors.join(","));
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

  const items: WorkerListItem[] = (data ?? []).map((r) => ({
    id: r.id,
    internal_code: r.internal_code,
    full_name: r.full_name,
    area: r.area,
    position: r.position,
    usual_shift: r.usual_shift,
    active: r.active,
    is_demo: r.is_demo,
    facilityId: r.facility_id,
    facility: oneOrNull(r.facility),
    account: oneOrNull(r.profiles as AccountEmbed | AccountEmbed[] | null),
    accountVisible: canSeeWorkerAccount(opts.user, r.facility_id),
  }));
  const total = count ?? items.length;
  return { items, total, outOfRange: items.length === 0 && total > 0 && filters.page > 1 };
}

/** Áreas registradas (sugerencias del filtro). Se limita a una página. */
export async function getAreaSuggestions(supabase: ServerSupabase): Promise<string[]> {
  const { data, error } = await supabase.from("workers").select("area").not("area", "is", null).order("area").range(0, 999);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => r.area?.trim()).filter((a): a is string => !!a))];
}

export type WorkerDetail = WorkerRow & {
  facility: {
    id: string;
    official_name: string;
    internal_code: string;
    unit_key: string | null;
    timezone: string;
    active: boolean;
    state_id: number;
    municipality_id: number | null;
    is_demo: boolean;
  } | null;
  state: { id: number; name: string } | null;
  municipality: { id: number; name: string } | null;
};

const DETAIL_SELECT =
  "*, facility:facilities!workers_facility_id_fkey(id, official_name, internal_code, unit_key, timezone, active, state_id, municipality_id, is_demo), state:states!workers_state_id_fkey(id, name), municipality:municipalities!workers_municipality_state_fk(id, name)";

/** Trabajador visible para la cuenta (RLS); null si no existe o no hay acceso. */
export async function getWorkerDetail(supabase: ServerSupabase, id: string): Promise<WorkerDetail | null> {
  const { data, error } = await supabase.from("workers").select(DETAIL_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    ...data,
    facility: oneOrNull(data.facility),
    state: oneOrNull(data.state),
    municipality: oneOrNull(data.municipality),
  } as WorkerDetail;
}

export type WorkerPrivate = { employee_number: string | null; phone: string | null; updated_at: string };

/** Datos privados: RLS solo devuelve la fila a administración y coordinación de la sede. */
export async function getWorkerPrivate(supabase: ServerSupabase, workerId: string): Promise<WorkerPrivate | null> {
  const { data, error } = await supabase
    .from("worker_private")
    .select("employee_number, phone, updated_at")
    .eq("worker_id", workerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export type WorkerAccount = { role: AppRole; active: boolean; display_name: string | null };

export async function getWorkerAccount(supabase: ServerSupabase, workerId: string): Promise<WorkerAccount | null> {
  const { data, error } = await supabase.from("profiles").select("role, active, display_name").eq("worker_id", workerId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export type WorkerFormCatalogs = {
  states: State[];
  municipalities: Municipality[];
  facilities: FacilityOption[];
};

/**
 * Catálogos del formulario: todas las entidades, sus municipios y las sedes
 * gestionables (más la sede actual del trabajador si está inactiva).
 */
export async function getWorkerFormCatalogs(
  supabase: ServerSupabase,
  user: SessionUser,
  currentFacility?: FacilityOption | null,
): Promise<WorkerFormCatalogs> {
  const [states, municipalities, facilities] = await Promise.all([
    getStates(supabase),
    getMunicipalities(supabase).then(labelRepeatedMunicipalities),
    getManageableFacilityOptions(supabase, user),
  ]);
  if (currentFacility && !facilities.some((f) => f.id === currentFacility.id) && canManageFacility(user, currentFacility.id)) {
    facilities.unshift(currentFacility);
  }
  return { states, municipalities, facilities };
}
