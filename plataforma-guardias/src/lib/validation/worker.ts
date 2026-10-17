/**
 * Directorio privado de trabajadores: validación (zod), normalización y
 * filtros de la lista. Funciones puras: se usan en Server Actions, en la
 * importación y en pruebas unitarias.
 *
 * Los trabajadores se organizan por entidad federativa («trabajadores
 * estatales» = organizados por estado). No se asume régimen ni empleador y no
 * se recopilan CURP, datos médicos, biométricos ni otros datos innecesarios.
 */
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";

/** Nayarit (clave INEGI 18): entidad por omisión. */
export const DEFAULT_STATE_ID = 18;

export const USUAL_SHIFT_OPTIONS = ["Matutino", "Vespertino", "Nocturno", "Jornada acumulada", "Mixto", "Otro"] as const;
export type UsualShift = (typeof USUAL_SHIFT_OPTIONS)[number];

/** Igual que la restricción de worker_private.phone. */
export const PHONE_RE = /^[0-9 +()\-]{7,20}$/;
export const NAME_MIN = 3;
export const NAME_MAX = 200;
export const TEXT_MAX = 120;
export const EMPLOYEE_NUMBER_MAX = 40;
export const REASON_MIN = 5;
export const REASON_MAX = 500;

export const PRIVACY_NOTE =
  "Captura solo lo necesario para organizar las guardias. No registres CURP, datos médicos, biométricos ni otros datos personales innecesarios.";
export const PRIVATE_DATA_NOTE =
  "El número de trabajador y el teléfono son opcionales y privados: solo los ven administración y la coordinación de la sede. Auditoría no los ve.";
export const PHONE_ERROR = "Teléfono inválido: de 7 a 20 caracteres con dígitos, espacios, +, paréntesis o guiones.";

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

const ACCENT_FROM = "ÁÉÍÓÚÜÑÀÈÌÒÙáéíóúüñàèìòù";
const ACCENT_TO = "AEIOUUNAEIOUaeiouunaeiou";
const ACCENT_MAP = new Map<string, string>([...ACCENT_FROM].map((ch, i) => [ch, ACCENT_TO[i]]));

/**
 * Espejo de app.normalize_text() de la base de datos: sin acentos, minúsculas
 * y espacios simples. Se usa para detectar duplicados por nombre.
 */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  let out = "";
  for (const ch of value) out += ACCENT_MAP.get(ch) ?? ch;
  return out.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Recorta y deja un solo espacio entre palabras. */
export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Clave de comparación del número de trabajador (igual que el índice único: upper(btrim())). */
export function employeeNumberKey(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t.toUpperCase() : null;
}

const SHIFT_ALIASES: Record<string, UsualShift> = {
  matutino: "Matutino",
  manana: "Matutino",
  vespertino: "Vespertino",
  tarde: "Vespertino",
  nocturno: "Nocturno",
  noche: "Nocturno",
  "jornada acumulada": "Jornada acumulada",
  acumulada: "Jornada acumulada",
  "jornada_acumulada": "Jornada acumulada",
  mixto: "Mixto",
  mixta: "Mixto",
  otro: "Otro",
  otra: "Otro",
};

/** Turno habitual reconocido (acepta variantes sin acentos o mayúsculas); null si no coincide. */
export function matchUsualShift(value: string | null | undefined): UsualShift | null {
  const n = normalizeText(value);
  if (!n) return null;
  return USUAL_SHIFT_OPTIONS.find((o) => normalizeText(o) === n) ?? SHIFT_ALIASES[n] ?? null;
}

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------

/** Primer mensaje por campo. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function invalidResult(error: z.ZodError): Extract<ActionResult, { ok: false }> {
  return { ok: false, message: "Revisa los campos marcados.", fieldErrors: fieldErrorsFrom(error) };
}

/** Lee campos de texto: recorta y convierte vacíos en undefined. */
export function readFields<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string | undefined> {
  const out = {} as Record<K, string | undefined>;
  for (const key of keys) {
    const value = formData.get(key);
    const trimmed = typeof value === "string" ? value.trim() : "";
    out[key] = trimmed.length ? trimmed : undefined;
  }
  return out;
}

/** Casilla marcada (valor "on", "1", "true" o "si"). */
export function readCheckbox(formData: FormData, key: string): boolean {
  const v = formData.get(key);
  return typeof v === "string" && ["on", "1", "true", "si"].includes(v.trim().toLowerCase());
}

const optionalText = (max: number, label: string) =>
  z.string().max(max, { error: `${label}: máximo ${max} caracteres.` }).optional();

export const WORKER_FORM_FIELDS = [
  "id",
  "full_name",
  "state_id",
  "municipality_id",
  "facility_id",
  "area",
  "position",
  "usual_shift",
  "employee_number",
  "phone",
  "change_reason",
] as const;

export const workerFormSchema = z
  .object({
    id: z.guid({ error: "Trabajador inválido." }).optional(),
    full_name: z
      .string({ error: "Escribe el nombre completo." })
      .transform(collapseSpaces)
      .pipe(
        z
          .string()
          .min(NAME_MIN, { error: `El nombre debe tener al menos ${NAME_MIN} caracteres.` })
          .max(NAME_MAX, { error: `El nombre admite máximo ${NAME_MAX} caracteres.` }),
      ),
    state_id: z.coerce
      .number({ error: "Elige el estado." })
      .int({ error: "Elige el estado." })
      .min(1, { error: "Elige el estado." })
      .max(99, { error: "Elige el estado." }),
    municipality_id: z.coerce
      .number({ error: "Elige un municipio de la lista." })
      .int({ error: "Elige un municipio de la lista." })
      .positive({ error: "Elige un municipio de la lista." })
      .optional(),
    facility_id: z.guid({ error: "Elige una instalación de la lista." }).optional(),
    area: optionalText(TEXT_MAX, "Área"),
    position: optionalText(TEXT_MAX, "Puesto"),
    usual_shift: z.enum(USUAL_SHIFT_OPTIONS, { error: "Elige un turno de la lista." }).optional(),
    active: z.boolean(),
    employee_number: optionalText(EMPLOYEE_NUMBER_MAX, "Número de trabajador"),
    phone: z.string().regex(PHONE_RE, { error: PHONE_ERROR }).optional(),
    change_reason: optionalText(REASON_MAX, "Motivo"),
  })
  .superRefine((v, ctx) => {
    if (v.id && (!v.change_reason || v.change_reason.length < REASON_MIN)) {
      ctx.addIssue({
        code: "custom",
        path: ["change_reason"],
        message: `Indica el motivo del cambio (mínimo ${REASON_MIN} caracteres).`,
      });
    }
  });
export type WorkerFormInput = z.infer<typeof workerFormSchema>;

/** Convierte el FormData del formulario en la entrada del esquema. */
export function readWorkerForm(formData: FormData) {
  return { ...readFields(formData, WORKER_FORM_FIELDS), active: readCheckbox(formData, "active") };
}

const reasonSchema = z
  .string({ error: `Indica el motivo (mínimo ${REASON_MIN} caracteres).` })
  .min(REASON_MIN, { error: `Indica el motivo (mínimo ${REASON_MIN} caracteres).` })
  .max(REASON_MAX, { error: `Máximo ${REASON_MAX} caracteres.` });

export const workerActiveSchema = z.object({
  worker_id: z.guid({ error: "Trabajador inválido." }),
  active: z.enum(["1", "0"], { error: "Acción inválida." }),
  reason: reasonSchema,
});

export const workerDeleteSchema = z.object({
  worker_id: z.guid({ error: "Trabajador inválido." }),
  reason: reasonSchema,
  confirm: z.literal("ELIMINAR", { error: "Escribe ELIMINAR para confirmar." }),
});

// ---------------------------------------------------------------------------
// Filtros de la lista (GET)
// ---------------------------------------------------------------------------

export const WORKERS_PAGE_SIZE = 25;
/** Valor del filtro de sede para trabajadores sin instalación de adscripción. */
export const NO_FACILITY = "ninguna";
export const SEARCH_MAX = 100;

export type WorkerStatusFilter = "activos" | "inactivos" | "todos";
export type WorkerAccountFilter = "" | "con" | "sin";
export type RawSearchParams = Record<string, string | string[] | undefined>;

export type WorkerListFilters = {
  q: string;
  stateId: number | null;
  municipalityId: number | null;
  /** uuid de la sede, NO_FACILITY o null (todas). */
  facility: string | null;
  area: string;
  status: WorkerStatusFilter;
  account: WorkerAccountFilter;
  page: number;
};

export const STATUS_FILTER_OPTIONS: { value: WorkerStatusFilter; label: string }[] = [
  { value: "activos", label: "Activos" },
  { value: "inactivos", label: "Inactivos" },
  { value: "todos", label: "Activos e inactivos" },
];

export const ACCOUNT_FILTER_OPTIONS: { value: WorkerAccountFilter; label: string }[] = [
  { value: "", label: "Con o sin cuenta" },
  { value: "con", label: "Con cuenta de acceso" },
  { value: "sin", label: "Sin cuenta de acceso" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInt(value: string | undefined, max: number): number | null {
  if (!value || !/^\d{1,9}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= 1 && n <= max ? n : null;
}

export const DEFAULT_WORKER_FILTERS: WorkerListFilters = {
  q: "",
  stateId: null,
  municipalityId: null,
  facility: null,
  area: "",
  status: "activos",
  account: "",
  page: 1,
};

/**
 * Lee los filtros de la URL. Valores desconocidos se ignoran.
 * @param facilityIds sedes permitidas en el filtro (null = cualquiera).
 * @param allowNoFacility permite filtrar «sin instalación» (administración).
 */
export function parseWorkerFilters(
  sp: RawSearchParams,
  opts: { facilityIds: string[] | null; allowNoFacility: boolean },
): WorkerListFilters {
  const q = collapseSpaces(firstParam(sp.q) ?? "").slice(0, SEARCH_MAX);
  const stateId = positiveInt(firstParam(sp.estado), 99);
  const municipalityId = stateId ? positiveInt(firstParam(sp.municipio), 999_999_999) : null;

  const rawFacility = firstParam(sp.sede)?.trim() ?? "";
  let facility: string | null = null;
  if (rawFacility === NO_FACILITY && opts.allowNoFacility) facility = NO_FACILITY;
  else if (isUuid(rawFacility) && (!opts.facilityIds || opts.facilityIds.includes(rawFacility))) facility = rawFacility.toLowerCase();

  const area = collapseSpaces(firstParam(sp.area) ?? "").slice(0, TEXT_MAX);
  const rawStatus = firstParam(sp.activo);
  const status: WorkerStatusFilter = rawStatus === "inactivos" || rawStatus === "todos" ? rawStatus : "activos";
  const rawAccount = firstParam(sp.cuenta);
  const account: WorkerAccountFilter = rawAccount === "con" || rawAccount === "sin" ? rawAccount : "";
  const page = positiveInt(firstParam(sp.pagina), 100_000) ?? 1;

  return { q, stateId, municipalityId, facility, area, status, account, page };
}

/** URL de la lista con los filtros (omite los valores por omisión). */
export function workersHref(filters: WorkerListFilters, overrides: Partial<WorkerListFilters> = {}): string {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.stateId) params.set("estado", String(f.stateId));
  if (f.stateId && f.municipalityId) params.set("municipio", String(f.municipalityId));
  if (f.facility) params.set("sede", f.facility);
  if (f.area) params.set("area", f.area);
  if (f.status !== "activos") params.set("activo", f.status);
  if (f.account) params.set("cuenta", f.account);
  if (f.page > 1) params.set("pagina", String(f.page));
  const qs = params.toString();
  return qs ? `/trabajadores?${qs}` : "/trabajadores";
}

export function hasActiveFilters(f: WorkerListFilters): boolean {
  return Boolean(f.q || f.stateId || f.facility || f.area || f.status !== "activos" || f.account);
}

/**
 * Patrón ILIKE para buscar por nombre normalizado o identificador interno.
 * Cada palabra debe aparecer en orden: «ana ruiz» → «%ana%ruiz%».
 * Se eliminan caracteres reservados de PostgREST y comodines.
 */
export function buildSearchPattern(q: string): string | null {
  const tokens = normalizeText(q)
    .replace(/[^a-z0-9\- ]+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return `%${tokens.join("%")}%`;
}

/** Escapa comodines de LIKE (%, _ y \) y elimina «*» (comodín de PostgREST). */
export function escapeLike(value: string): string {
  return value.replace(/\*/g, "").replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Patrón para buscar número de trabajador (parcial, sin distinguir mayúsculas). */
export function employeeNumberPattern(q: string): string | null {
  const t = q.replace(/[^A-Za-z0-9\- /.]+/g, "").trim();
  if (t.length < 2) return null;
  return `%${escapeLike(t)}%`;
}

/**
 * ¿Puede la cuenta ver el perfil (cuenta de acceso) del trabajador? Espejo de
 * la política profiles_read: administración, o sede de adscripción dentro de su
 * alcance. Si no, la falta de perfil no significa «Sin cuenta».
 */
export function canSeeWorkerAccount(scope: { isAdmin: boolean; facilityIds: string[] }, facilityId: string | null | undefined): boolean {
  return scope.isAdmin || (!!facilityId && scope.facilityIds.includes(facilityId));
}

export function totalPages(total: number, pageSize = WORKERS_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/** Rango [from, to] (inclusive) para .range() de PostgREST. */
export function pageRange(page: number, pageSize = WORKERS_PAGE_SIZE): { from: number; to: number } {
  const p = Math.max(1, Math.trunc(page));
  return { from: (p - 1) * pageSize, to: p * pageSize - 1 };
}
