/**
 * Instalaciones y categorías: validación (zod), normalización, zonas horarias
 * de México, filtros de la lista y utilidades puras. Se usan en Server Actions,
 * en la importación, en formularios del navegador y en pruebas unitarias.
 *
 * No importa nada exclusivo del servidor.
 */
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import type { Tone } from "@/lib/attendance/labels";

// ---------------------------------------------------------------------------
// Límites (alineados con las restricciones de la base de datos)
// ---------------------------------------------------------------------------

export const OFFICIAL_NAME_MIN = 3;
export const OFFICIAL_NAME_MAX = 300;
export const UNIT_KEY_MAX = 60;
export const DESCRIPTION_MAX = 2000;
export const ADDRESS_MAX = 500;
export const PHONE_MAX = 100;
export const SCHEDULE_MAX = 500;
export const SOURCE_MAX = 300;
export const URL_MAX = 1000;
export const NOTES_MAX = 2000;
export const SERVICE_MAX = 200;
export const SERVICES_MAX_ITEMS = 60;
export const TOLERANCE_MIN = 0;
export const TOLERANCE_MAX = 240;
export const TOLERANCE_DEFAULT = 10;
export const REASON_MIN = 5;
export const REASON_MAX = 500;
/** Nayarit (clave INEGI 18): entidad con cobertura inicial. */
export const DEFAULT_FACILITY_STATE_ID = 18;
export const FALLBACK_TIMEZONE = "America/Mazatlan";

/** Rango aproximado del territorio mexicano para validar coordenadas. */
export const MEXICO_BOUNDS = { latMin: 14, latMax: 33, lngMin: -119, lngMax: -86 } as const;

export const OFFICIAL_SOURCES_NOTICE =
  "Usa solo fuentes oficiales y conserva su procedencia. Valida nombres oficiales y categorías antes de cargar datos reales.";

// ---------------------------------------------------------------------------
// Zonas horarias de México (IANA)
// ---------------------------------------------------------------------------

export const MEXICO_TIMEZONES = [
  { value: "America/Mexico_City", label: "Centro (Ciudad de México y la mayor parte del país)" },
  { value: "America/Monterrey", label: "Centro — Monterrey (Nuevo León, Coahuila, Durango)" },
  { value: "America/Merida", label: "Centro — Mérida (Yucatán, Campeche)" },
  { value: "America/Bahia_Banderas", label: "Centro — Bahía de Banderas (Nayarit)" },
  { value: "America/Chihuahua", label: "Centro — Chihuahua" },
  { value: "America/Matamoros", label: "Centro con horario de verano — frontera de Tamaulipas" },
  { value: "America/Ojinaga", label: "Centro con horario de verano — Ojinaga (Chihuahua)" },
  { value: "America/Cancun", label: "Sureste (Quintana Roo)" },
  { value: "America/Mazatlan", label: "Pacífico (Nayarit, Sinaloa, Baja California Sur)" },
  { value: "America/Hermosillo", label: "Pacífico sin horario de verano (Sonora)" },
  { value: "America/Ciudad_Juarez", label: "Montaña con horario de verano — Ciudad Juárez (Chihuahua)" },
  { value: "America/Tijuana", label: "Noroeste (Baja California)" },
] as const;

export type MexicoTimezone = (typeof MEXICO_TIMEZONES)[number]["value"];

const MEXICO_TZ_VALUES: readonly string[] = MEXICO_TIMEZONES.map((t) => t.value);

export function isMexicoTimezone(value: string | null | undefined): value is MexicoTimezone {
  return typeof value === "string" && MEXICO_TZ_VALUES.includes(value);
}

/** Zona horaria escrita sin distinguir mayúsculas ni espacios/guiones bajos. */
export function matchMexicoTimezone(value: string | null | undefined): MexicoTimezone | null {
  const v = (value ?? "").trim().replace(/\s+/g, "_").toLowerCase();
  if (!v) return null;
  const found = MEXICO_TIMEZONES.find((t) => t.value.toLowerCase() === v);
  return found ? found.value : null;
}

export function timezoneLabel(value: string | null | undefined): string {
  return MEXICO_TIMEZONES.find((t) => t.value === value)?.label ?? value ?? "—";
}

/**
 * Zona horaria por omisión: la del municipio si difiere de la del estado; si no,
 * la del estado; y si ninguna es válida, la de respaldo.
 */
export function defaultTimezoneFor(stateTimezone: string | null | undefined, municipalityTimezone?: string | null): MexicoTimezone {
  if (isMexicoTimezone(municipalityTimezone)) return municipalityTimezone;
  if (isMexicoTimezone(stateTimezone)) return stateTimezone;
  return FALLBACK_TIMEZONE;
}

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

/** Clave de comparación de la clave de unidad (igual que el índice único: upper(btrim())). */
export function unitKeyKey(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t.toUpperCase() : null;
}

/** Clave nombre + lugar (igual que el índice facilities_name_place_uq). */
export function namePlaceKey(name: string, stateId: number, municipalityId: number | null): string {
  return `${normalizeText(name)}|${stateId}|${municipalityId ?? 0}`;
}

/**
 * Dos instalaciones con el mismo nombre y lugar solo son la misma si alguna no
 * tiene clave de unidad o si sus claves coinciden: en catálogos oficiales (CLUES)
 * hay unidades distintas co-ubicadas con el mismo nombre y su propia clave.
 * Regla común del formulario y de la importación.
 */
export function compatibleUnitKeys(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = unitKeyKey(a);
  const kb = unitKeyKey(b);
  return !ka || !kb || ka === kb;
}

/** Slug para categorías: minúsculas, sin acentos, guiones. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Servicios capturados uno por línea (en archivos también se aceptan «;» o «|»).
 * Se recortan, se quitan vacíos y repetidos (sin distinguir acentos).
 */
export function parseServices(value: string | null | undefined, opts: { allowInlineSeparators?: boolean } = {}): string[] {
  if (!value) return [];
  const separator = opts.allowInlineSeparators ? /\r?\n|;|\|/ : /\r?\n/;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(separator)) {
    const item = collapseSpaces(part.trim().replace(/^[-*•·]\s*/, ""));
    if (!item) continue;
    const key = normalizeText(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function servicesToText(services: string[] | null | undefined): string {
  return (services ?? []).join("\n");
}

/** Igualdad de listas de servicios (mismo orden y texto). */
export function sameServices(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** Número decimal tolerante a coma decimal; null si está vacío o no es número. */
export function parseDecimalText(value: string | null | undefined): number | null {
  const t = (value ?? "").trim();
  if (!t) return null;
  if (!/^[-+−]?\d+([.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace("−", "-").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export type CoordinateCheck = { ok: true; latitude: number | null; longitude: number | null } | { ok: false; field: "latitude" | "longitude"; message: string };

/**
 * Latitud y longitud van juntas (o ninguna) y dentro de México
 * (latitud 14 a 33, longitud −119 a −86).
 */
export function checkCoordinates(latitude: number | null, longitude: number | null): CoordinateCheck {
  if (latitude === null && longitude === null) return { ok: true, latitude: null, longitude: null };
  if (latitude === null) return { ok: false, field: "latitude", message: "Captura latitud y longitud juntas, o ninguna." };
  if (longitude === null) return { ok: false, field: "longitude", message: "Captura latitud y longitud juntas, o ninguna." };
  const { latMin, latMax, lngMin, lngMax } = MEXICO_BOUNDS;
  const latOk = latitude >= latMin && latitude <= latMax;
  const lngOk = longitude >= lngMin && longitude <= lngMax;
  if (!latOk && !lngOk && longitude >= latMin && longitude <= latMax && latitude >= lngMin && latitude <= lngMax) {
    return { ok: false, field: "latitude", message: "Latitud y longitud parecen estar invertidas: la latitud va de 14 a 33 y la longitud de −119 a −86." };
  }
  if (!latOk) return { ok: false, field: "latitude", message: `La latitud debe estar dentro de México (entre ${latMin} y ${latMax}).` };
  if (!lngOk) return { ok: false, field: "longitude", message: `La longitud debe estar dentro de México (entre ${lngMin} y ${lngMax}; es negativa).` };
  return { ok: true, latitude, longitude };
}

/** ¿Es una fecha real en formato yyyy-MM-dd? */
export function isValidYmd(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Fecha escrita como yyyy-MM-dd, dd/MM/yyyy (o con guiones) o fecha ISO con hora
 * (como la entrega Excel). Devuelve yyyy-MM-dd o null si no se reconoce.
 */
export function parseDateText(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  if (!t) return null;
  let ymd: string | null = null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
  if (m) ymd = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (!ymd) {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
    if (m) ymd = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return ymd && isValidYmd(ymd) ? ymd : null;
}

/**
 * Fecha de hoy (yyyy-MM-dd). Por omisión usa la zona más oriental de México
 * (Quintana Roo), es decir, la fecha más avanzada del país: así ninguna sede
 * ve rechazada su fecha de hoy como «futura».
 */
export function todayYmd(now: Date = new Date(), timeZone = "America/Cancun"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Separador para varias URLs de fuente en un solo campo («url1 | url2»). */
export const SOURCE_URL_SEPARATOR = " | ";

/** Divide un campo de URL(s) de fuente en URLs individuales. */
export function splitSourceUrls(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\s+\|\s+|\s*\n\s*/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Una o varias URLs http(s) separadas por « | ». */
export function isHttpUrlList(value: string): boolean {
  const parts = splitSourceUrls(value);
  return parts.length > 0 && parts.every((part) => isHttpUrl(part));
}

export function isHttpUrl(value: string): boolean {
  if (value.length > URL_MAX) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Fecha yyyy-MM-dd para mostrar: 17/10/2026. */
export function formatYmd(value: string | null | undefined): string {
  if (!value || !isValidYmd(value.slice(0, 10))) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export type VerificationStatus = "verificado" | "pendiente";

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  verificado: "Verificada",
  pendiente: "Pendiente de verificación",
};

export const VERIFICATION_TONE: Record<VerificationStatus, Tone> = {
  verificado: "success",
  pendiente: "warning",
};

// ---------------------------------------------------------------------------
// Formularios (lectura de FormData)
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

const optionalText = (max: number, label: string) => z.string().max(max, { error: `${label}: máximo ${max} caracteres.` }).optional();

const reasonSchema = z
  .string({ error: `Indica el motivo (mínimo ${REASON_MIN} caracteres).` })
  .min(REASON_MIN, { error: `Indica el motivo (mínimo ${REASON_MIN} caracteres).` })
  .max(REASON_MAX, { error: `Máximo ${REASON_MAX} caracteres.` });

// ---------------------------------------------------------------------------
// Instalación: alta y edición
// ---------------------------------------------------------------------------

export const FACILITY_FORM_FIELDS = [
  "id",
  "official_name",
  "unit_key",
  "category_id",
  "description",
  "state_id",
  "municipality_id",
  "address",
  "latitude",
  "longitude",
  "phone",
  "schedule",
  "services",
  "source",
  "source_url",
  "last_verified_at",
  "verification_status",
  "notes",
  "timezone",
  "arrival_tolerance_minutes",
  "change_reason",
] as const;

export type FacilityFormRaw = Record<(typeof FACILITY_FORM_FIELDS)[number], string | undefined> & {
  services_verified: boolean;
  is_public: boolean;
  active: boolean;
  is_demo: boolean;
};

/** Convierte el FormData del formulario en la entrada del esquema. */
export function readFacilityForm(formData: FormData): FacilityFormRaw {
  // Los servicios conservan los saltos de línea.
  const fields = readFields(formData, FACILITY_FORM_FIELDS);
  const servicesRaw = formData.get("services");
  return {
    ...fields,
    services: typeof servicesRaw === "string" && servicesRaw.trim() ? servicesRaw : undefined,
    services_verified: readCheckbox(formData, "services_verified"),
    is_public: readCheckbox(formData, "is_public"),
    active: readCheckbox(formData, "active"),
    is_demo: readCheckbox(formData, "is_demo"),
  };
}

const coordinate = (label: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return null;
      const n = parseDecimalText(v);
      if (n === null) {
        ctx.addIssue({ code: "custom", message: `${label}: escribe un número decimal (por ejemplo, ${label === "Latitud" ? "21.5039" : "-104.8946"}).` });
        return z.NEVER;
      }
      return n;
    });

/**
 * Esquema del formulario de instalación. `today` (yyyy-MM-dd) impide fechas de
 * verificación futuras.
 */
export function facilityFormSchema(today: string = todayYmd()) {
  return z
    .object({
      id: z.guid({ error: "Instalación inválida." }).optional(),
      official_name: z
        .string({ error: "Escribe el nombre oficial." })
        .transform(collapseSpaces)
        .pipe(
          z
            .string()
            .min(OFFICIAL_NAME_MIN, { error: `El nombre oficial debe tener al menos ${OFFICIAL_NAME_MIN} caracteres.` })
            .max(OFFICIAL_NAME_MAX, { error: `El nombre oficial admite máximo ${OFFICIAL_NAME_MAX} caracteres.` }),
        ),
      unit_key: z
        .string()
        .transform(collapseSpaces)
        .pipe(z.string().max(UNIT_KEY_MAX, { error: `La clave de unidad admite máximo ${UNIT_KEY_MAX} caracteres.` }))
        .optional(),
      category_id: z.coerce
        .number({ error: "Elige la categoría." })
        .int({ error: "Elige la categoría." })
        .positive({ error: "Elige la categoría." }),
      description: optionalText(DESCRIPTION_MAX, "Descripción"),
      state_id: z.coerce
        .number({ error: "Elige el estado." })
        .int({ error: "Elige el estado." })
        .min(1, { error: "Elige el estado." })
        .max(99, { error: "Elige el estado." }),
      // Obligatorio: el directorio se organiza por estado → municipio → sede.
      municipality_id: z.coerce
        .number({ error: "Elige el municipio." })
        .int({ error: "Elige un municipio de la lista." })
        .positive({ error: "Elige el municipio." }),
      address: optionalText(ADDRESS_MAX, "Dirección"),
      latitude: coordinate("Latitud"),
      longitude: coordinate("Longitud"),
      phone: optionalText(PHONE_MAX, "Teléfono"),
      schedule: optionalText(SCHEDULE_MAX, "Horario"),
      services: z
        .string()
        .optional()
        .transform((v) => parseServices(v))
        .pipe(
          z
            .array(z.string().max(SERVICE_MAX, { error: `Cada servicio admite máximo ${SERVICE_MAX} caracteres.` }))
            .max(SERVICES_MAX_ITEMS, { error: `Máximo ${SERVICES_MAX_ITEMS} servicios.` }),
        ),
      services_verified: z.boolean(),
      source: z
        .string({ error: "Indica la fuente de información." })
        .transform(collapseSpaces)
        .pipe(
          z
            .string()
            .min(2, { error: "Indica la fuente de información." })
            .max(SOURCE_MAX, { error: `La fuente admite máximo ${SOURCE_MAX} caracteres.` }),
        ),
      source_url: z
        .string()
        .refine(isHttpUrlList, { error: "Escribe direcciones web completas que empiecen con https:// o http:// (varias, separadas por « | »)." })
        .optional(),
      last_verified_at: z
        .string()
        .refine(isValidYmd, { error: "Fecha inválida." })
        .refine((v) => v <= today, { error: "La fecha de verificación no puede ser futura." })
        .optional(),
      verification_status: z.enum(["verificado", "pendiente"], { error: "Elige el estado de verificación." }),
      notes: optionalText(NOTES_MAX, "Observaciones"),
      timezone: z
        .string()
        .refine(isMexicoTimezone, { error: "Elige una zona horaria de México de la lista." })
        .optional(),
      arrival_tolerance_minutes: z.coerce
        .number({ error: `La tolerancia debe ser un número entero de ${TOLERANCE_MIN} a ${TOLERANCE_MAX}.` })
        .int({ error: `La tolerancia debe ser un número entero de ${TOLERANCE_MIN} a ${TOLERANCE_MAX}.` })
        .min(TOLERANCE_MIN, { error: `La tolerancia debe estar entre ${TOLERANCE_MIN} y ${TOLERANCE_MAX} minutos.` })
        .max(TOLERANCE_MAX, { error: `La tolerancia debe estar entre ${TOLERANCE_MIN} y ${TOLERANCE_MAX} minutos.` })
        .optional(),
      is_public: z.boolean(),
      active: z.boolean(),
      is_demo: z.boolean(),
      change_reason: optionalText(REASON_MAX, "Motivo"),
    })
    .superRefine((v, ctx) => {
      const coords = checkCoordinates(v.latitude, v.longitude);
      if (!coords.ok) ctx.addIssue({ code: "custom", path: [coords.field], message: coords.message });
      if (v.verification_status === "verificado" && !v.last_verified_at) {
        ctx.addIssue({ code: "custom", path: ["last_verified_at"], message: "Para marcar como verificada indica la fecha de verificación." });
      }
      if (v.services_verified && v.services.length === 0) {
        ctx.addIssue({ code: "custom", path: ["services"], message: "Para marcar los servicios como verificados captura al menos uno." });
      }
      if (v.id && (!v.change_reason || v.change_reason.length < REASON_MIN)) {
        ctx.addIssue({ code: "custom", path: ["change_reason"], message: `Indica el motivo del cambio (mínimo ${REASON_MIN} caracteres).` });
      }
    });
}

export type FacilityFormInput = z.infer<ReturnType<typeof facilityFormSchema>>;

/**
 * Campos que cambian entre lo registrado y lo que se va a guardar. Los arreglos
 * (servicios) se comparan elemento por elemento; null y undefined son iguales.
 */
export function changedFields<T extends Record<string, unknown>>(current: Partial<Record<keyof T, unknown>>, next: T): (keyof T)[] {
  const out: (keyof T)[] = [];
  for (const key of Object.keys(next) as (keyof T)[]) {
    const a = current[key] ?? null;
    const b = next[key] ?? null;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (!sameServices(a.map(String), b.map(String))) out.push(key);
    } else if (a !== b) {
      out.push(key);
    }
  }
  return out;
}

/**
 * El trigger app.touch_row() borra change_reason cuando el valor nuevo es igual
 * al guardado (para no arrastrar el motivo anterior). Si se repite el mismo
 * motivo, primero hay que limpiar el guardado o la bitácora queda sin motivo.
 */
export function needsReasonReset(storedReason: string | null | undefined, newReason: string | null | undefined): boolean {
  return Boolean(newReason) && storedReason === newReason;
}

export const facilityActiveSchema = z.object({
  facility_id: z.guid({ error: "Instalación inválida." }),
  active: z.enum(["1", "0"], { error: "Acción inválida." }),
  reason: reasonSchema,
});

export const facilityDeleteSchema = z.object({
  facility_id: z.guid({ error: "Instalación inválida." }),
  reason: reasonSchema,
  confirm: z.literal("ELIMINAR", { error: "Escribe ELIMINAR para confirmar." }),
});

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------

export const CATEGORY_ICONS = [
  { value: "building", label: "Edificio" },
  { value: "hospital", label: "Hospital" },
  { value: "stethoscope", label: "Consultorio (estetoscopio)" },
  { value: "cross", label: "Unidad médica (corazón con pulso)" },
  { value: "ambulance", label: "Ambulancia / urgencias" },
  { value: "pill", label: "Farmacia" },
  { value: "flask", label: "Laboratorio" },
  { value: "baby", label: "Guardería" },
  { value: "landmark", label: "Oficina de representación" },
  { value: "briefcase", label: "Oficina administrativa" },
  { value: "users", label: "Centro social o comunitario" },
  { value: "school", label: "Capacitación" },
  { value: "warehouse", label: "Almacén" },
  { value: "map-pin", label: "Punto genérico" },
] as const;

export type CategoryIcon = (typeof CATEGORY_ICONS)[number]["value"];
const CATEGORY_ICON_VALUES = CATEGORY_ICONS.map((i) => i.value) as [CategoryIcon, ...CategoryIcon[]];

export function categoryIconLabel(value: string | null | undefined): string {
  return CATEGORY_ICONS.find((i) => i.value === value)?.label ?? value ?? "—";
}

export const CATEGORY_NAME_MIN = 2;
export const CATEGORY_NAME_MAX = 120;
export const CATEGORY_SLUG_MAX = 60;
export const CATEGORY_DESCRIPTION_MAX = 500;
export const CATEGORY_ORDER_MAX = 10000;
export const CATEGORY_DEFAULT_COLOR = "#166534";

/** Valores iniciales del formulario de categoría (como texto). */
export type CategoryFormDefaults = {
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  sort_order: string;
  active: boolean;
};

export const EMPTY_CATEGORY_FORM: CategoryFormDefaults = {
  name: "",
  slug: "",
  description: "",
  icon: "building",
  color: CATEGORY_DEFAULT_COLOR,
  sort_order: "100",
  active: true,
};

export const CATEGORY_FORM_FIELDS = ["id", "name", "slug", "description", "icon", "color", "sort_order", "reason"] as const;

export function readCategoryForm(formData: FormData) {
  return { ...readFields(formData, CATEGORY_FORM_FIELDS), active: readCheckbox(formData, "active") };
}

export const categoryFormSchema = z
  .object({
    id: z.coerce.number({ error: "Categoría inválida." }).int({ error: "Categoría inválida." }).positive({ error: "Categoría inválida." }).optional(),
    name: z
      .string({ error: "Escribe el nombre." })
      .transform(collapseSpaces)
      .pipe(
        z
          .string()
          .min(CATEGORY_NAME_MIN, { error: `El nombre debe tener al menos ${CATEGORY_NAME_MIN} caracteres.` })
          .max(CATEGORY_NAME_MAX, { error: `El nombre admite máximo ${CATEGORY_NAME_MAX} caracteres.` }),
      ),
    slug: z
      .string()
      .transform((v) => v.trim().toLowerCase())
      .pipe(
        z
          .string()
          .max(CATEGORY_SLUG_MAX, { error: `El identificador admite máximo ${CATEGORY_SLUG_MAX} caracteres.` })
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: "Usa solo minúsculas sin acentos, números y guiones (por ejemplo, unidades-medicas)." }),
      )
      .optional(),
    description: optionalText(CATEGORY_DESCRIPTION_MAX, "Descripción"),
    icon: z.enum(CATEGORY_ICON_VALUES, { error: "Elige un icono de la lista." }),
    color: z
      .string({ error: "Elige un color." })
      .regex(/^#[0-9a-fA-F]{6}$/, { error: "Color inválido: usa el selector de color (formato #RRGGBB)." })
      .transform((v) => v.toLowerCase()),
    sort_order: z.coerce
      .number({ error: `El orden debe ser un número entero de 0 a ${CATEGORY_ORDER_MAX}.` })
      .int({ error: `El orden debe ser un número entero de 0 a ${CATEGORY_ORDER_MAX}.` })
      .min(0, { error: `El orden debe ser un número entero de 0 a ${CATEGORY_ORDER_MAX}.` })
      .max(CATEGORY_ORDER_MAX, { error: `El orden debe ser un número entero de 0 a ${CATEGORY_ORDER_MAX}.` })
      .optional(),
    active: z.boolean(),
    // Obligatorio al editar (queda en la bitácora); en un alta se registra «Alta de categoría».
    reason: optionalText(REASON_MAX, "Motivo"),
  })
  .transform((v, ctx) => {
    const slug = v.slug || slugify(v.name);
    if (!slug) ctx.addIssue({ code: "custom", path: ["slug"], message: "Escribe un identificador con letras o números." });
    const missingReason = Boolean(v.id) && (!v.reason || v.reason.length < REASON_MIN);
    if (missingReason) ctx.addIssue({ code: "custom", path: ["reason"], message: `Indica el motivo del cambio (mínimo ${REASON_MIN} caracteres).` });
    if (!slug || missingReason) return z.NEVER;
    return { ...v, slug, sort_order: v.sort_order ?? 100, reason: v.reason ?? "Alta de categoría" };
  });

export type CategoryFormInput = z.infer<typeof categoryFormSchema>;

export const categoryIdSchema = z.object({
  category_id: z.coerce.number({ error: "Categoría inválida." }).int({ error: "Categoría inválida." }).positive({ error: "Categoría inválida." }),
});

export const categoryActiveSchema = categoryIdSchema.extend({
  active: z.enum(["1", "0"], { error: "Acción inválida." }),
  reason: reasonSchema,
});

export const categoryDeleteSchema = categoryIdSchema.extend({
  confirm: z.literal("ELIMINAR", { error: "Escribe ELIMINAR para confirmar." }),
  reason: reasonSchema,
});

// ---------------------------------------------------------------------------
// Filtros de la lista de instalaciones (GET)
// ---------------------------------------------------------------------------

export const FACILITIES_PAGE_SIZE = 25;
export const SEARCH_MAX = 100;
export const FACILITIES_BASE_PATH = "/administracion/instalaciones";

export type RawSearchParams = Record<string, string | string[] | undefined>;
export type VerificationFilter = "" | VerificationStatus;
export type DataKindFilter = "" | "demo" | "produccion";
export type ActiveFilter = "activas" | "inactivas" | "todas";

export type FacilityListFilters = {
  q: string;
  categoryId: number | null;
  stateId: number | null;
  municipalityId: number | null;
  verification: VerificationFilter;
  dataKind: DataKindFilter;
  active: ActiveFilter;
  page: number;
};

export const DEFAULT_FACILITY_FILTERS: FacilityListFilters = {
  q: "",
  categoryId: null,
  stateId: null,
  municipalityId: null,
  verification: "",
  dataKind: "",
  active: "activas",
  page: 1,
};

export const VERIFICATION_FILTER_OPTIONS: { value: VerificationFilter; label: string }[] = [
  { value: "", label: "Verificadas y pendientes" },
  { value: "verificado", label: "Verificadas" },
  { value: "pendiente", label: "Pendientes de verificación" },
];

export const DATA_KIND_OPTIONS: { value: DataKindFilter; label: string }[] = [
  { value: "", label: "Demostración y producción" },
  { value: "produccion", label: "Solo producción" },
  { value: "demo", label: "Solo demostración" },
];

export const ACTIVE_FILTER_OPTIONS: { value: ActiveFilter; label: string }[] = [
  { value: "activas", label: "Activas" },
  { value: "inactivas", label: "Inactivas" },
  { value: "todas", label: "Activas e inactivas" },
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

/** Lee los filtros de la URL. Valores desconocidos se ignoran. */
export function parseFacilityFilters(sp: RawSearchParams): FacilityListFilters {
  const q = collapseSpaces(firstParam(sp.q) ?? "").slice(0, SEARCH_MAX);
  const categoryId = positiveInt(firstParam(sp.categoria), 32767);
  const stateId = positiveInt(firstParam(sp.estado), 99);
  const municipalityId = stateId ? positiveInt(firstParam(sp.municipio), 999_999_999) : null;
  const rawVer = firstParam(sp.verificacion);
  const verification: VerificationFilter = rawVer === "verificado" || rawVer === "pendiente" ? rawVer : "";
  const rawKind = firstParam(sp.datos);
  const dataKind: DataKindFilter = rawKind === "demo" || rawKind === "produccion" ? rawKind : "";
  const rawActive = firstParam(sp.activa);
  const active: ActiveFilter = rawActive === "inactivas" || rawActive === "todas" ? rawActive : "activas";
  const page = positiveInt(firstParam(sp.pagina), 100_000) ?? 1;
  return { q, categoryId, stateId, municipalityId, verification, dataKind, active, page };
}

/** URL de la lista con los filtros (omite los valores por omisión). */
export function facilitiesHref(filters: FacilityListFilters, overrides: Partial<FacilityListFilters> = {}): string {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.categoryId) params.set("categoria", String(f.categoryId));
  if (f.stateId) params.set("estado", String(f.stateId));
  if (f.stateId && f.municipalityId) params.set("municipio", String(f.municipalityId));
  if (f.verification) params.set("verificacion", f.verification);
  if (f.dataKind) params.set("datos", f.dataKind);
  if (f.active !== "activas") params.set("activa", f.active);
  if (f.page > 1) params.set("pagina", String(f.page));
  const qs = params.toString();
  return qs ? `${FACILITIES_BASE_PATH}?${qs}` : FACILITIES_BASE_PATH;
}

export function hasActiveFilters(f: FacilityListFilters): boolean {
  return Boolean(f.q || f.categoryId || f.stateId || f.verification || f.dataKind || f.active !== "activas");
}

/**
 * Patrón ILIKE para buscar por nombre normalizado, clave de unidad o
 * identificador interno. Cada palabra debe aparecer en orden: «umf tepic» →
 * «%umf%tepic%». Solo quedan letras, números y guiones (seguro para .or()).
 */
export function buildSearchPattern(q: string): string | null {
  const tokens = normalizeText(q)
    .replace(/[^a-z0-9\- ]+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return `%${tokens.join("%")}%`;
}

export function totalPages(total: number, pageSize = FACILITIES_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/** Rango [from, to] (inclusive) para .range() de PostgREST. */
export function pageRange(page: number, pageSize = FACILITIES_PAGE_SIZE): { from: number; to: number } {
  const p = Math.max(1, Math.trunc(page));
  return { from: (p - 1) * pageSize, to: p * pageSize - 1 };
}

/** Enlace a OpenStreetMap para revisar coordenadas. */
export function osmLink(latitude: number, longitude: number): string {
  const lat = latitude.toFixed(6);
  const lng = longitude.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}
