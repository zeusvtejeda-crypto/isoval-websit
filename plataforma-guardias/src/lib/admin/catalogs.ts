/**
 * Catálogos geográficos (entidades federativas y municipios del INEGI):
 * validación de formularios, filtros por URL y utilidades de presentación.
 * Lógica pura (se usa en Server Actions, en componentes y en pruebas).
 */
import { z } from "zod";
import { friendlyDbError } from "@/lib/actions";
import { isValidTimezone } from "@/lib/time";
import { MEXICO_TIMEZONES, isMexicoTimezone, matchMexicoTimezone } from "@/lib/validation/facility";
import { normalizeSearch } from "./accounts";
import { readText } from "./form";

export const CATALOGS_PATH = "/administracion/catalogos";

/** Clave de entidad (INEGI): 1–32 hoy; la base admite 1–99. */
export const STATE_ID_MIN = 1;
export const STATE_ID_MAX = 99;
export const MUNICIPALITY_NAME_MIN = 2;
export const MUNICIPALITY_NAME_MAX = 150;
export const MUNICIPALITY_SEARCH_MAX = 100;

export const TIMEZONE_CHOICES = MEXICO_TIMEZONES;

export const MUNICIPALITY_NOT_FOUND_MESSAGE = "El municipio no existe en esa entidad o no tienes permiso para modificarlo.";

// ---------------------------------------------------------------------------
// Clave INEGI de municipio
// ---------------------------------------------------------------------------

/** «001» a «999». «000» no es una clave municipal válida. */
export function isValidInegiCode(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\d{3}$/.test(value) && value !== "000";
}

/**
 * Normaliza la clave capturada: quita espacios y completa con ceros a la
 * izquierda («7» → «007»). Devuelve null si no son de 1 a 3 dígitos.
 */
export function normalizeInegiCode(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, "");
  if (!/^\d{1,3}$/.test(v)) return null;
  return v.padStart(3, "0");
}

export function inegiCodeIssue(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return "Escribe la clave INEGI del municipio (3 dígitos).";
  const code = normalizeInegiCode(value);
  if (!code) return "La clave INEGI son 3 dígitos, p. ej. 001.";
  if (!isValidInegiCode(code)) return "La clave 000 no es válida; las claves municipales empiezan en 001.";
  return null;
}

// ---------------------------------------------------------------------------
// Zona horaria
// ---------------------------------------------------------------------------

/**
 * Valida una zona horaria IANA para catálogos. Además de existir
 * (isValidTimezone), debe ser una de las zonas de México de la lista: los
 * formularios de instalaciones solo usan esas como sugerencia.
 */
export function timezoneIssue(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return "Elige la zona horaria.";
  const v = value.trim();
  if (!isValidTimezone(v)) return `«${v}» no es una zona horaria válida.`;
  if (!isMexicoTimezone(v)) {
    return matchMexicoTimezone(v)
      ? `Escribe la zona exactamente como aparece en la lista (${matchMexicoTimezone(v)}).`
      : "Elige una zona horaria de México de la lista.";
  }
  return null;
}

export function timezoneChoiceLabel(value: string | null | undefined): string {
  const found = MEXICO_TIMEZONES.find((t) => t.value === value);
  return found ? `${found.label} — ${found.value}` : (value ?? "—");
}

// ---------------------------------------------------------------------------
// Esquemas de formularios
// ---------------------------------------------------------------------------

const stateIdSchema = z.coerce
  .number({ error: "La entidad no es válida." })
  .int({ error: "La entidad no es válida." })
  .min(STATE_ID_MIN, { error: "La entidad no es válida." })
  .max(STATE_ID_MAX, { error: "La entidad no es válida." });

const requiredTimezone = z
  .string({ error: "Elige la zona horaria." })
  .superRefine((value, ctx) => {
    const issue = timezoneIssue(value);
    if (issue) ctx.addIssue({ code: "custom", message: issue });
  });

/** Vacío = «igual que la entidad» (null). */
const optionalTimezone = z
  .string()
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    const issue = timezoneIssue(value);
    if (issue) ctx.addIssue({ code: "custom", message: issue });
  })
  .transform((value) => value ?? null);

export const stateCoverageSchema = z.object({
  state_id: stateIdSchema,
  enabled: z.enum(["1", "0"], { error: "Valor de cobertura inválido." }).transform((v) => v === "1"),
});

export const stateTimezoneSchema = z.object({
  state_id: stateIdSchema,
  default_timezone: requiredTimezone,
});

export const municipalityTimezoneSchema = z.object({
  state_id: stateIdSchema,
  municipality_id: z.coerce
    .number({ error: "El municipio no es válido." })
    .int({ error: "El municipio no es válido." })
    .positive({ error: "El municipio no es válido." }),
  timezone: optionalTimezone,
});

export const newMunicipalitySchema = z.object({
  state_id: stateIdSchema,
  inegi_code: z
    .string({ error: "Escribe la clave INEGI del municipio (3 dígitos)." })
    .superRefine((value, ctx) => {
      const issue = inegiCodeIssue(value);
      if (issue) ctx.addIssue({ code: "custom", message: issue });
    })
    .transform((value) => normalizeInegiCode(value) ?? value),
  name: z
    .string({ error: "Escribe el nombre oficial del municipio." })
    .min(MUNICIPALITY_NAME_MIN, { error: `El nombre debe tener al menos ${MUNICIPALITY_NAME_MIN} caracteres.` })
    .max(MUNICIPALITY_NAME_MAX, { error: `El nombre admite hasta ${MUNICIPALITY_NAME_MAX} caracteres.` }),
  timezone: optionalTimezone,
  allow_duplicate_name: z.boolean(),
});
export type NewMunicipalityInput = z.infer<typeof newMunicipalitySchema>;

/** Nombre con espacios simples (sin alterar acentos ni mayúsculas). */
export function cleanMunicipalityName(value: string | null | undefined): string | undefined {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  return v.length ? v : undefined;
}

function checked(formData: FormData, key: string): boolean {
  const v = formData.get(key);
  return v === "on" || v === "1" || v === "true";
}

export function readStateCoverageForm(formData: FormData) {
  return { state_id: readText(formData, "state_id"), enabled: readText(formData, "enabled") };
}

export function readStateTimezoneForm(formData: FormData) {
  return { state_id: readText(formData, "state_id"), default_timezone: readText(formData, "default_timezone") };
}

export function readMunicipalityTimezoneForm(formData: FormData) {
  return {
    state_id: readText(formData, "state_id"),
    municipality_id: readText(formData, "municipality_id"),
    timezone: readText(formData, "timezone"),
  };
}

export function readNewMunicipalityForm(formData: FormData) {
  return {
    state_id: readText(formData, "state_id"),
    inegi_code: readText(formData, "inegi_code"),
    name: cleanMunicipalityName(readText(formData, "name")),
    timezone: readText(formData, "timezone"),
    allow_duplicate_name: checked(formData, "allow_duplicate_name"),
  };
}

// ---------------------------------------------------------------------------
// Filtros por URL
// ---------------------------------------------------------------------------

export type CatalogFilters = { stateId: number | null; q: string };
export const DEFAULT_CATALOG_FILTERS: CatalogFilters = { stateId: null, q: "" };

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseCatalogFilters(sp: RawParams): CatalogFilters {
  const rawState = (first(sp.entidad) ?? "").trim();
  const n = /^\d{1,2}$/.test(rawState) ? Number(rawState) : NaN;
  const stateId = Number.isInteger(n) && n >= STATE_ID_MIN && n <= STATE_ID_MAX ? n : null;
  const q = stateId ? (first(sp.q) ?? "").replace(/\s+/g, " ").trim().slice(0, MUNICIPALITY_SEARCH_MAX) : "";
  return { stateId, q };
}

export function catalogsHref(filters: Partial<CatalogFilters> = {}): string {
  const params = new URLSearchParams();
  if (filters.stateId) params.set("entidad", String(filters.stateId));
  if (filters.stateId && filters.q) params.set("q", filters.q);
  const qs = params.toString();
  return qs ? `${CATALOGS_PATH}?${qs}` : CATALOGS_PATH;
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

export type StateRow = { id: number; name: string; abbreviation: string; default_timezone: string; enabled: boolean };
export type MunicipalityRow = { id: number; state_id: number; inegi_code: string; name: string; timezone: string | null };

/** Conteo por entidad a partir de filas con state_id. */
export function countByState(rows: readonly { state_id: number }[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of rows) out[r.state_id] = (out[r.state_id] ?? 0) + 1;
  return out;
}

/** Clave de entidad a dos dígitos («07»). */
export function stateCode(id: number): string {
  return String(id).padStart(2, "0");
}

/** Clave geoestadística completa del municipio («20208»). */
export function municipalityFullCode(stateId: number, inegiCode: string): string {
  return `${stateCode(stateId)}${inegiCode}`;
}

/** Nombres normalizados que se repiten dentro de la misma entidad. */
export function repeatedNames(rows: readonly Pick<MunicipalityRow, "state_id" | "name">[]): Set<string> {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.state_id}:${normalizeSearch(r.name)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

export function isRepeatedName(repeated: Set<string>, row: Pick<MunicipalityRow, "state_id" | "name">): boolean {
  return repeated.has(`${row.state_id}:${normalizeSearch(row.name)}`);
}

/**
 * Etiqueta para listas: agrega la clave INEGI cuando el nombre se repite en
 * la entidad (en Oaxaca hay municipios oficiales homónimos).
 */
export function municipalityLabel(row: Pick<MunicipalityRow, "state_id" | "name" | "inegi_code">, repeated: Set<string>): string {
  return isRepeatedName(repeated, row) ? `${row.name} (clave ${row.inegi_code})` : row.name;
}

/** Filtro por nombre (sin acentos) o por clave INEGI. */
export function filterMunicipalities<T extends Pick<MunicipalityRow, "name" | "inegi_code">>(rows: readonly T[], q: string): T[] {
  const needle = normalizeSearch(q);
  if (!needle) return [...rows];
  const digits = /^\d{1,3}$/.test(needle) ? needle : null;
  return rows.filter((r) => (digits ? r.inegi_code.includes(digits) : false) || normalizeSearch(r.name).includes(needle));
}

/** Municipios de la entidad con el mismo nombre (normalizado). */
export function sameNameMunicipalities<T extends Pick<MunicipalityRow, "name">>(rows: readonly T[], name: string): T[] {
  const key = normalizeSearch(name);
  return rows.filter((r) => normalizeSearch(r.name) === key);
}

/**
 * Resultado cuando el nombre ya existe en la entidad: marca el nombre y pide
 * confirmar (casilla allow_duplicate_name) que es un municipio distinto.
 */
export function duplicateNameFailure(
  sameName: readonly Pick<MunicipalityRow, "name" | "inegi_code">[],
  stateName: string,
): { ok: false; message: string; fieldErrors: Record<string, string> } {
  const list = sameName.map((m) => `«${m.name}» (clave ${m.inegi_code})`).join(", ");
  return {
    ok: false,
    message: "Revisa los campos marcados.",
    fieldErrors: {
      name: `Ya existe ${list} en ${stateName}.`,
      allow_duplicate_name: "Si es un municipio distinto con el mismo nombre oficial, marca la casilla para confirmarlo.",
    },
  };
}

/** Zona horaria efectiva y si viene de la entidad. */
export function effectiveTimezone(municipalityTz: string | null, stateTz: string): { value: string; inherited: boolean } {
  return municipalityTz ? { value: municipalityTz, inherited: false } : { value: stateTz, inherited: true };
}

export function pluralEs(n: number, one: string, many: string): string {
  return `${n.toLocaleString("es-MX")} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

type PgLikeError = { message?: string; code?: string; details?: string | null; hint?: string | null } | null | undefined;

/** Errores de la base en catálogos (duplicados con mensaje específico). */
export function friendlyCatalogError(error: PgLikeError, fallback = "No se pudo guardar el catálogo."): string {
  if (error?.code === "23505" && /municipalities_state_id_inegi_code_key|inegi_code/.test(`${error.message ?? ""} ${error.details ?? ""}`)) {
    return "Ya existe un municipio con esa clave INEGI en la entidad.";
  }
  if (error?.code === "23503" && /municipalit/.test(error.message ?? "")) {
    return "El municipio está en uso por instalaciones o trabajadores.";
  }
  return friendlyDbError(error, fallback);
}
