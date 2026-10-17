/**
 * Cuentas de acceso y permisos (lógica pura: validación, combinación de
 * perfiles con Auth, filtros y cálculo de cambios).
 */
import { z } from "zod";
import type { AppRole } from "@/lib/auth";
import type { Tone } from "@/lib/attendance/labels";
import { readAll, readRaw, readText } from "./form";
import { TEMP_PASSWORD_MAX, TEMP_PASSWORD_MIN, temporaryPasswordIssue } from "./password";

export const USERS_BASE_PATH = "/administracion/usuarios";

export const APP_ROLES = ["admin", "coordinador", "auditor", "trabajador"] as const satisfies readonly AppRole[];

/** Roles que trabajan con sedes asignadas (user_facility_scopes). */
export const SCOPED_ROLES: readonly AppRole[] = ["coordinador", "auditor"];

export function roleUsesFacilityScopes(role: AppRole): boolean {
  return SCOPED_ROLES.includes(role);
}

export const ROLE_HINTS: Record<AppRole, string> = {
  admin: "Acceso total: instalaciones, cuentas, configuración y bitácora completa.",
  coordinador: "Gestiona guardias y registros solo en las sedes asignadas.",
  auditor: "Consulta de solo lectura en las sedes asignadas. No ve teléfonos ni números de trabajador.",
  trabajador: "Solo ve y registra sus propias guardias. Vincula la cuenta con su registro de trabajador.",
};

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const REASON_MIN = 5;
export const REASON_MAX = 500;
export const ACCOUNT_SEARCH_MAX = 100;

export const PASSWORD_MODES = ["generar", "manual"] as const;
export type PasswordMode = (typeof PASSWORD_MODES)[number];

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

const guid = (message: string) => z.guid({ error: message });

const displayNameSchema = z
  .string({ error: "Escribe el nombre visible." })
  .min(DISPLAY_NAME_MIN, { error: `El nombre visible debe tener al menos ${DISPLAY_NAME_MIN} caracteres.` })
  .max(DISPLAY_NAME_MAX, { error: `El nombre visible admite hasta ${DISPLAY_NAME_MAX} caracteres.` });

const roleSchema = z.enum(APP_ROLES, { error: "Elige un rol de la lista." });

const facilityIdsSchema = z
  .array(guid("Alguna sede seleccionada no es válida."))
  .max(500, { error: "Selecciona como máximo 500 sedes." })
  .transform((ids) => [...new Set(ids)]);

const reasonSchema = z
  .string({ error: "Indica el motivo." })
  .min(REASON_MIN, { error: `El motivo debe tener al menos ${REASON_MIN} caracteres.` })
  .max(REASON_MAX, { error: `El motivo admite hasta ${REASON_MAX} caracteres.` });

const passwordModeSchema = z.enum(PASSWORD_MODES, { error: "Elige cómo definir la contraseña." });

function checkPassword(
  value: { password_mode: PasswordMode; password?: string | undefined },
  ctx: z.RefinementCtx,
) {
  if (value.password_mode !== "manual") return;
  const issue = temporaryPasswordIssue(value.password);
  if (issue) ctx.addIssue({ code: "custom", path: ["password"], message: issue });
}

function checkScopes(value: { role: AppRole; facility_ids: string[] }, ctx: z.RefinementCtx) {
  if (roleUsesFacilityScopes(value.role) && value.facility_ids.length === 0) {
    ctx.addIssue({ code: "custom", path: ["facility_ids"], message: "Asigna al menos una sede para coordinación o auditoría." });
  }
}

/** Administración y trabajadores no usan sedes asignadas: se descartan. */
function normalizeScopes<T extends { role: AppRole; facility_ids: string[] }>(value: T): T {
  return roleUsesFacilityScopes(value.role) ? value : { ...value, facility_ids: [] };
}

export const createAccountSchema = z
  .object({
    email: z
      .email({ error: "Escribe un correo válido." })
      .max(EMAIL_MAX, { error: `El correo admite hasta ${EMAIL_MAX} caracteres.` }),
    display_name: displayNameSchema,
    role: roleSchema,
    worker_id: guid("Elige un trabajador de la lista.").optional(),
    facility_ids: facilityIdsSchema,
    password_mode: passwordModeSchema,
    password: z.string().max(TEMP_PASSWORD_MAX * 4).optional(),
  })
  .superRefine((v, ctx) => {
    checkPassword(v, ctx);
    checkScopes(v, ctx);
  })
  .transform(normalizeScopes);
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z
  .object({
    user_id: guid("La cuenta no es válida."),
    display_name: displayNameSchema,
    role: roleSchema,
    worker_id: guid("Elige un trabajador de la lista.").optional(),
    facility_ids: facilityIdsSchema,
    reason: reasonSchema.optional(),
  })
  .superRefine(checkScopes)
  .transform(normalizeScopes);
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const accountStatusSchema = z.object({
  user_id: guid("La cuenta no es válida."),
  active: z.enum(["1", "0"], { error: "Estado inválido." }).transform((v) => v === "1"),
  reason: reasonSchema,
});

export const resetPasswordSchema = z
  .object({
    user_id: guid("La cuenta no es válida."),
    password_mode: passwordModeSchema,
    password: z.string().max(TEMP_PASSWORD_MAX * 4).optional(),
  })
  .superRefine(checkPassword);

/** Lee el formulario de alta. El correo se normaliza a minúsculas. */
export function readCreateAccountForm(formData: FormData) {
  return {
    email: readText(formData, "email")?.toLowerCase(),
    display_name: readText(formData, "display_name"),
    role: readText(formData, "role"),
    worker_id: readText(formData, "worker_id"),
    facility_ids: readAll(formData, "facility_ids"),
    password_mode: readText(formData, "password_mode") ?? "generar",
    password: readRaw(formData, "password"),
  };
}

export function readUpdateAccountForm(formData: FormData) {
  return {
    user_id: readText(formData, "user_id"),
    display_name: readText(formData, "display_name"),
    role: readText(formData, "role"),
    worker_id: readText(formData, "worker_id"),
    facility_ids: readAll(formData, "facility_ids"),
    reason: readText(formData, "reason"),
  };
}

export function readAccountStatusForm(formData: FormData) {
  return { user_id: readText(formData, "user_id"), active: readText(formData, "active"), reason: readText(formData, "reason") };
}

export function readResetPasswordForm(formData: FormData) {
  return {
    user_id: readText(formData, "user_id"),
    password_mode: readText(formData, "password_mode") ?? "generar",
    password: readRaw(formData, "password"),
  };
}

// ---------------------------------------------------------------------------
// Reglas de cambio
// ---------------------------------------------------------------------------

/** El motivo es obligatorio cuando cambia el rol o el estado de la cuenta. */
export function reasonRequired(current: { role: AppRole; active: boolean }, next: { role: AppRole; active: boolean }): boolean {
  return current.role !== next.role || current.active !== next.active;
}

export function scopeChanges(current: readonly string[], next: readonly string[]): { add: string[]; remove: string[] } {
  const cur = new Set(current);
  const nxt = new Set(next);
  return {
    add: [...nxt].filter((id) => !cur.has(id)),
    remove: [...cur].filter((id) => !nxt.has(id)),
  };
}

type EditableAccount = { display_name: string | null; role: AppRole; worker_id: string | null; facility_ids: readonly string[] };

/** Nombres (en español) de los datos que cambian; vacío si no hay cambios. */
export function changedAccountFields(before: EditableAccount, after: EditableAccount): string[] {
  const out: string[] = [];
  if ((before.display_name ?? "") !== (after.display_name ?? "")) out.push("nombre visible");
  if (before.role !== after.role) out.push("rol");
  if ((before.worker_id ?? null) !== (after.worker_id ?? null)) out.push("trabajador vinculado");
  const { add, remove } = scopeChanges(before.facility_ids, after.facility_ids);
  if (add.length || remove.length) out.push("sedes asignadas");
  return out;
}

/** Une «a», «a y b», «a, b y c». */
export function joinSpanish(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Lista de cuentas
// ---------------------------------------------------------------------------

export type ProfileInput = {
  id: string;
  role: AppRole;
  display_name: string | null;
  active: boolean;
  worker_id: string | null;
  created_at: string;
};
export type AuthUserInput = { id: string; email: string | null; banned_until: string | null; last_sign_in_at: string | null };
export type ScopeInput = { user_id: string; facility_id: string };
export type WorkerInput = { id: string; full_name: string; internal_code: string };

export type AccountRow = {
  id: string;
  email: string | null;
  displayName: string | null;
  role: AppRole;
  active: boolean;
  workerId: string | null;
  /** null si no hay vínculo o RLS no permite leerlo. */
  worker: { id: string; fullName: string; internalCode: string } | null;
  facilities: { id: string; name: string }[];
  bannedUntil: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  /** Perfil sin usuario en Auth (no debería ocurrir) o Auth no disponible. */
  authMissing: boolean;
};

export function sortableName(row: Pick<AccountRow, "displayName" | "email">): string {
  return (row.displayName ?? row.email ?? "").trim();
}

export function buildAccountRows(input: {
  profiles: readonly ProfileInput[];
  authUsers: readonly AuthUserInput[] | null;
  scopes: readonly ScopeInput[];
  workers: readonly WorkerInput[];
  facilityNames: Readonly<Record<string, string>>;
}): AccountRow[] {
  const authById = new Map((input.authUsers ?? []).map((u) => [u.id, u]));
  const workerById = new Map(input.workers.map((w) => [w.id, w]));
  const scopesByUser = new Map<string, string[]>();
  for (const s of input.scopes) {
    const list = scopesByUser.get(s.user_id) ?? [];
    list.push(s.facility_id);
    scopesByUser.set(s.user_id, list);
  }

  const rows = input.profiles.map((p): AccountRow => {
    const auth = authById.get(p.id);
    const worker = p.worker_id ? workerById.get(p.worker_id) : undefined;
    const facilities = (scopesByUser.get(p.id) ?? [])
      .map((id) => ({ id, name: input.facilityNames[id] ?? `Sede ${shortId(id)}` }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    return {
      id: p.id,
      email: auth?.email ?? null,
      displayName: p.display_name,
      role: p.role,
      active: p.active,
      workerId: p.worker_id,
      worker: worker ? { id: worker.id, fullName: worker.full_name, internalCode: worker.internal_code } : null,
      facilities,
      bannedUntil: auth?.banned_until ?? null,
      lastSignInAt: auth?.last_sign_in_at ?? null,
      createdAt: p.created_at,
      authMissing: input.authUsers !== null && !auth,
    };
  });
  return rows.sort((a, b) => sortableName(a).localeCompare(sortableName(b), "es", { sensitivity: "base" }));
}

export function shortId(id: string | null | undefined): string {
  return (id ?? "").replace(/-/g, "").slice(0, 8);
}

/** ¿El inicio de sesión está bloqueado en Auth en este momento? */
export function isBanned(bannedUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!bannedUntil) return false;
  const t = Date.parse(bannedUntil);
  return Number.isFinite(t) && t > now.getTime();
}

export type AccountStatus = { label: string; tone: Tone; hint?: string };

export function accountStatus(row: Pick<AccountRow, "active" | "bannedUntil">, now: Date = new Date()): AccountStatus {
  const banned = isBanned(row.bannedUntil, now);
  if (!row.active) {
    return banned
      ? { label: "Inactiva", tone: "muted" }
      : { label: "Inactiva", tone: "muted", hint: "El inicio de sesión no está bloqueado en el sistema de acceso; vuelve a desactivarla para bloquearlo." };
  }
  if (banned) return { label: "Activa con acceso bloqueado", tone: "warning", hint: "Reactívala para desbloquear el inicio de sesión." };
  return { label: "Activa", tone: "success" };
}

export type AccountStatusFilter = "todas" | "activas" | "inactivas";
export type AccountFilters = { q: string; role: AppRole | ""; status: AccountStatusFilter };
export const DEFAULT_ACCOUNT_FILTERS: AccountFilters = { q: "", role: "", status: "todas" };

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseAccountFilters(sp: RawParams): AccountFilters {
  const q = (first(sp.q) ?? "").replace(/\s+/g, " ").trim().slice(0, ACCOUNT_SEARCH_MAX);
  const rawRole = first(sp.rol) ?? "";
  const role = (APP_ROLES as readonly string[]).includes(rawRole) ? (rawRole as AppRole) : "";
  const rawStatus = first(sp.estado);
  const status: AccountStatusFilter = rawStatus === "activas" || rawStatus === "inactivas" ? rawStatus : "todas";
  return { q, role, status };
}

export function accountsHref(filters: AccountFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.role) params.set("rol", filters.role);
  if (filters.status !== "todas") params.set("estado", filters.status);
  const qs = params.toString();
  return qs ? `${USERS_BASE_PATH}?${qs}` : USERS_BASE_PATH;
}

export function hasAccountFilters(filters: AccountFilters): boolean {
  return Boolean(filters.q || filters.role || filters.status !== "todas");
}

/** Minúsculas sin acentos ni espacios repetidos. */
export function normalizeSearch(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function filterAccounts(rows: readonly AccountRow[], filters: AccountFilters): AccountRow[] {
  const needle = normalizeSearch(filters.q);
  return rows.filter((r) => {
    if (filters.role && r.role !== filters.role) return false;
    if (filters.status === "activas" && !r.active) return false;
    if (filters.status === "inactivas" && r.active) return false;
    if (!needle) return true;
    const haystack = normalizeSearch([r.email, r.displayName, r.worker?.fullName, r.worker?.internalCode].filter(Boolean).join(" "));
    return haystack.includes(needle);
  });
}

// ---------------------------------------------------------------------------
// Opciones de formulario
// ---------------------------------------------------------------------------

export type WorkerOption = {
  id: string;
  fullName: string;
  internalCode: string;
  facilityName: string | null;
  active: boolean;
};

export function workerOptionLabel(w: WorkerOption): string {
  const parts = [w.fullName, w.internalCode];
  if (w.facilityName) parts.push(w.facilityName);
  return parts.join(" · ") + (w.active ? "" : " (inactivo)");
}

/**
 * Trabajadores que se pueden vincular: activos y sin cuenta, más el que ya
 * está vinculado a la cuenta que se edita.
 */
export function linkableWorkers<W extends { id: string; active: boolean }>(
  workers: readonly W[],
  linkedWorkerIds: Iterable<string>,
  keepWorkerId?: string | null,
): W[] {
  const linked = new Set(linkedWorkerIds);
  return workers.filter((w) => w.id === keepWorkerId || (w.active && !linked.has(w.id)));
}

export type FacilityChoice = { id: string; name: string; active: boolean; isDemo: boolean };

export function facilityChoiceLabel(f: FacilityChoice): string {
  return f.name + (f.active ? "" : " (inactiva)");
}

/** Resumen de sedes para la lista («A, B, C y 4 más»). */
export function facilitiesSummary(names: readonly string[], max = 3): string {
  if (names.length === 0) return "";
  if (names.length <= max) return joinSpanish(names);
  return `${names.slice(0, max).join(", ")} y ${names.length - max} más`;
}

export const TEMP_PASSWORD_HINT = `Mínimo ${TEMP_PASSWORD_MIN} caracteres. Compártela solo con la persona titular y por un medio seguro.`;
