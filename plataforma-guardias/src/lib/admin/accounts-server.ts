import "server-only";
import { ROLE_LABELS, type AppRole, type SessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServerSupabase } from "@/lib/supabase/server";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import {
  APP_ROLES,
  buildAccountRows,
  linkableWorkers,
  type AccountRow,
  type AuthUserInput,
  type FacilityChoice,
  type ProfileInput,
  type ScopeInput,
  type WorkerInput,
  type WorkerOption,
} from "./accounts";
import { SERVICE_KEY_MISSING_MESSAGE, friendlyAuthError } from "./form";

export type AuthAdminApi = ReturnType<typeof createAdminClient>["auth"]["admin"];

/**
 * API de administración de Auth (llave de servicio). Solo para quien ya pasó
 * requireAdmin(); se vuelve a comprobar aquí como defensa en profundidad.
 */
export function getAuthAdmin(actor: SessionUser): { ok: true; api: AuthAdminApi } | { ok: false; message: string } {
  if (!actor.isAdmin) return { ok: false, message: "Solo administración puede administrar cuentas de acceso." };
  try {
    return { ok: true, api: createAdminClient().auth.admin };
  } catch {
    return { ok: false, message: SERVICE_KEY_MISSING_MESSAGE };
  }
}

function toAuthInput(u: { id: string; email?: string; banned_until?: string; last_sign_in_at?: string }): AuthUserInput {
  return { id: u.id, email: u.email ?? null, banned_until: u.banned_until ?? null, last_sign_in_at: u.last_sign_in_at ?? null };
}

/** Todas las cuentas de Auth (paginado). */
export async function listAllAuthUsers(api: AuthAdminApi): Promise<AuthUserInput[]> {
  const perPage = 1000;
  const out: AuthUserInput[] = [];
  for (let page = 1; page <= 200; page++) {
    const res = await api.listUsers({ page, perPage });
    if (res.error) throw new Error(friendlyAuthError(res.error, "No se pudo leer la lista de cuentas del sistema de acceso."));
    out.push(...res.data.users.map(toAuthInput));
    if (res.data.users.length < perPage || res.data.nextPage == null) return out;
  }
  return out;
}

const PROFILE_SELECT = "id, role, display_name, active, worker_id, created_at";

export type FacilityRecord = { id: string; official_name: string; active: boolean; is_demo: boolean };

export async function loadAllFacilities(supabase: ServerSupabase): Promise<FacilityRecord[]> {
  return fetchAll<FacilityRecord>((from, to) =>
    supabase.from("facilities").select("id, official_name, active, is_demo").order("official_name").order("id").range(from, to),
  );
}

export function facilityNameMap(facilities: readonly FacilityRecord[]): Record<string, string> {
  return Object.fromEntries(facilities.map((f) => [f.id, f.official_name]));
}

/** Sedes que se pueden asignar: activas, más las ya asignadas aunque estén inactivas. */
export function facilityChoices(facilities: readonly FacilityRecord[], keepIds: readonly string[] = []): FacilityChoice[] {
  const keep = new Set(keepIds);
  return facilities
    .filter((f) => f.active || keep.has(f.id))
    .map((f) => ({ id: f.id, name: f.official_name, active: f.active, isDemo: f.is_demo }));
}

async function loadWorkersByIds(supabase: ServerSupabase, ids: readonly string[]): Promise<WorkerInput[]> {
  const out: WorkerInput[] = [];
  for (const part of chunk([...new Set(ids)])) {
    const { data, error } = await supabase.from("workers").select("id, full_name, internal_code").in("id", part);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

/** Lista completa de cuentas: perfiles (RLS) + correo y bloqueo desde Auth. */
export async function loadAccountsOverview(
  supabase: ServerSupabase,
  actor: SessionUser,
): Promise<{ rows: AccountRow[]; authError: string | null }> {
  const [profiles, scopes, facilities] = await Promise.all([
    fetchAll<ProfileInput>((from, to) => supabase.from("profiles").select(PROFILE_SELECT).order("created_at").order("id").range(from, to)),
    fetchAll<ScopeInput>((from, to) =>
      supabase.from("user_facility_scopes").select("user_id, facility_id").order("user_id").order("facility_id").range(from, to),
    ),
    loadAllFacilities(supabase),
  ]);
  const workers = await loadWorkersByIds(
    supabase,
    profiles.map((p) => p.worker_id).filter((id): id is string => Boolean(id)),
  );

  let authUsers: AuthUserInput[] | null = null;
  let authError: string | null = null;
  const admin = getAuthAdmin(actor);
  if (!admin.ok) {
    authError = admin.message;
  } else {
    try {
      authUsers = await listAllAuthUsers(admin.api);
    } catch (e) {
      authError = e instanceof Error ? e.message : "No se pudo leer la lista de cuentas del sistema de acceso.";
    }
  }

  return { rows: buildAccountRows({ profiles, authUsers, scopes, workers, facilityNames: facilityNameMap(facilities) }), authError };
}

/** Una cuenta con su correo (Auth), sedes y trabajador vinculado. */
export async function loadAccountDetail(
  supabase: ServerSupabase,
  actor: SessionUser,
  userId: string,
): Promise<{ row: AccountRow; facilityIds: string[]; facilities: FacilityRecord[]; authError: string | null } | null> {
  const { data: profile, error } = await supabase.from("profiles").select(PROFILE_SELECT).eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) return null;

  const [scopesRes, facilities, workers] = await Promise.all([
    supabase.from("user_facility_scopes").select("user_id, facility_id").eq("user_id", userId),
    loadAllFacilities(supabase),
    profile.worker_id ? loadWorkersByIds(supabase, [profile.worker_id]) : Promise.resolve([]),
  ]);
  if (scopesRes.error) throw new Error(scopesRes.error.message);
  const scopes = scopesRes.data ?? [];

  let authUsers: AuthUserInput[] | null = null;
  let authError: string | null = null;
  const admin = getAuthAdmin(actor);
  if (!admin.ok) {
    authError = admin.message;
  } else {
    const res = await admin.api.getUserById(userId);
    if (res.error || !res.data.user) {
      authError = friendlyAuthError(res.error, "No se pudo leer la cuenta en el sistema de acceso.");
      authUsers = res.error?.status === 404 ? [] : null;
    } else {
      authUsers = [toAuthInput(res.data.user)];
    }
  }

  const [row] = buildAccountRows({ profiles: [profile], authUsers, scopes, workers, facilityNames: facilityNameMap(facilities) });
  return { row, facilityIds: scopes.map((s) => s.facility_id), facilities, authError };
}

/**
 * Trabajadores que se pueden vincular (activos y sin cuenta) más el vinculado
 * actualmente a la cuenta que se edita.
 */
export async function loadWorkerOptions(
  supabase: ServerSupabase,
  facilityNames: Readonly<Record<string, string>>,
  keepWorkerId?: string | null,
): Promise<WorkerOption[]> {
  type Row = { id: string; full_name: string; internal_code: string; facility_id: string | null; active: boolean };
  const [workers, linked] = await Promise.all([
    fetchAll<Row>((from, to) =>
      supabase
        .from("workers")
        .select("id, full_name, internal_code, facility_id, active")
        .eq("active", true)
        .order("full_name")
        .order("id")
        .range(from, to),
    ),
    fetchAll<{ worker_id: string | null }>((from, to) =>
      supabase.from("profiles").select("worker_id").not("worker_id", "is", null).order("id").range(from, to),
    ),
  ]);
  if (keepWorkerId && !workers.some((w) => w.id === keepWorkerId)) {
    const { data } = await supabase.from("workers").select("id, full_name, internal_code, facility_id, active").eq("id", keepWorkerId).maybeSingle();
    if (data) workers.unshift(data);
  }
  const linkedIds = linked.map((l) => l.worker_id).filter((id): id is string => Boolean(id));
  return linkableWorkers(workers, linkedIds, keepWorkerId).map((w) => ({
    id: w.id,
    fullName: w.full_name,
    internalCode: w.internal_code,
    facilityName: w.facility_id ? (facilityNames[w.facility_id] ?? null) : null,
    active: w.active,
  }));
}

/** Opciones de rol para formularios (etiquetas de ROLE_LABELS). */
export function roleOptions(): { value: AppRole; label: string }[] {
  return APP_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }));
}
