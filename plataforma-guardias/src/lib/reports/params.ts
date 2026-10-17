/**
 * Filtros de historial y parámetros de exportación (funciones puras).
 *
 * - En las páginas (`parseReportFilters`) los valores inválidos se corrigen y
 *   se avisa al usuario.
 * - En la exportación (`parseExportParams`) los valores inválidos devuelven un
 *   error 400 claro, y para el rol «trabajador» SIEMPRE se fuerza su propio
 *   registro de trabajador, sin importar lo que llegue en la URL.
 */
import type { AppRole } from "@/lib/auth";
import type { AttendanceStatus } from "@/lib/attendance/calc";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/attendance/labels";

/** Rango máximo (días naturales, inclusivo) de una exportación o consulta. */
export const MAX_RANGE_DAYS = 93;
/** Rango por omisión del historial general: últimos 7 días (incluye hoy). */
export const DEFAULT_RANGE_DAYS = 7;

const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  "pendiente",
  "en_servicio",
  "finalizada",
  "registro_incompleto",
  "ausencia_justificada",
  "inasistencia_confirmada",
  "cancelada",
];

/**
 * Filtro de estado de asistencia:
 * - "" = todos excepto cancelados (coincide con lo que suma `totalize`).
 * - "todas" = todos, incluidos cancelados.
 * - "revision" = pendientes de revisión (entrada abierta vencida o sin registros tras terminar).
 */
export type AttendanceFilter = "" | "todas" | "revision" | AttendanceStatus;

export const ATTENDANCE_FILTER_OPTIONS: { value: AttendanceFilter; label: string }[] = [
  { value: "", label: "Todos (sin cancelados)" },
  ...ATTENDANCE_STATUSES.map((s) => ({ value: s as AttendanceFilter, label: ATTENDANCE_STATUS_LABELS[s] })),
  { value: "revision", label: "Pendientes de revisión" },
  { value: "todas", label: "Todos (incluye cancelados)" },
];

const ATTENDANCE_VALUES = new Set<string>(ATTENDANCE_FILTER_OPTIONS.map((o) => o.value));

export function attendanceFilterLabel(value: AttendanceFilter): string {
  return ATTENDANCE_FILTER_OPTIONS.find((o) => o.value === value)?.label ?? "Todos (sin cancelados)";
}

export type ReportFilters = {
  /** Fecha local (yyyy-MM-dd) inicial, inclusive. */
  desde: string;
  /** Fecha local (yyyy-MM-dd) final, inclusive. */
  hasta: string;
  facilityId: string | null;
  /** Entidad federativa (clave INEGI). */
  stateId: number | null;
  workerId: string | null;
  attendance: AttendanceFilter;
};

export type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: unknown): value is string {
  return typeof value === "string" && GUID_RE.test(value);
}

/** Valida una fecha yyyy-MM-dd real (no acepta 2026-02-31). */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Suma días a una fecha yyyy-MM-dd. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Días naturales entre dos fechas, ambos extremos incluidos (2026-10-01 → 2026-10-01 = 1). */
export function daysInclusive(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1;
}

export function defaultRange(today: string, days = DEFAULT_RANGE_DAYS): { desde: string; hasta: string } {
  return { desde: addDays(today, -(days - 1)), hasta: today };
}

/** Primer valor (recortado) de un parámetro; cadena vacía = ausente. */
export function readParam(raw: RawParams, key: string): string | undefined {
  let value: string | null | undefined;
  if (raw instanceof URLSearchParams) {
    value = raw.get(key);
  } else {
    const v = raw[key];
    value = Array.isArray(v) ? v[0] : v;
  }
  const t = value?.trim();
  return t ? t : undefined;
}

function parseStateId(value: string | undefined): number | null | "invalid" {
  if (value === undefined) return null;
  if (!/^\d{1,2}$/.test(value)) return "invalid";
  const n = Number(value);
  return n >= 1 && n <= 99 ? n : "invalid";
}

function parseAttendance(value: string | undefined): AttendanceFilter | "invalid" {
  if (value === undefined) return "";
  return ATTENDANCE_VALUES.has(value) ? (value as AttendanceFilter) : "invalid";
}

export type ParsedPageFilters = { filters: ReportFilters; notices: string[]; page: number };

/**
 * Interpreta los filtros GET de una página. Nunca falla: corrige y avisa.
 * @param today Fecha local de hoy (yyyy-MM-dd) en la zona por omisión.
 */
export function parseReportFilters(raw: RawParams, today: string, options: { defaultDays?: number } = {}): ParsedPageFilters {
  const notices: string[] = [];
  const def = defaultRange(today, options.defaultDays ?? DEFAULT_RANGE_DAYS);

  const rawDesde = readParam(raw, "desde");
  const rawHasta = readParam(raw, "hasta");
  let desde = isIsoDay(rawDesde) ? rawDesde : def.desde;
  let hasta = isIsoDay(rawHasta) ? rawHasta : def.hasta;
  if ((rawDesde && !isIsoDay(rawDesde)) || (rawHasta && !isIsoDay(rawHasta))) {
    notices.push("Alguna fecha no era válida; se usó el valor por omisión.");
  }
  if (!rawDesde && rawHasta && isIsoDay(rawHasta)) desde = addDays(hasta, -((options.defaultDays ?? DEFAULT_RANGE_DAYS) - 1));
  if (hasta < desde) {
    [desde, hasta] = [hasta, desde];
    notices.push("La fecha final era anterior a la inicial; se intercambiaron.");
  }
  if (daysInclusive(desde, hasta) > MAX_RANGE_DAYS) {
    desde = addDays(hasta, -(MAX_RANGE_DAYS - 1));
    notices.push(`El periodo máximo es de ${MAX_RANGE_DAYS} días; se ajustó la fecha inicial.`);
  }

  const rawSede = readParam(raw, "sede");
  let facilityId: string | null = null;
  if (rawSede) {
    if (isGuid(rawSede)) facilityId = rawSede.toLowerCase();
    else notices.push("La sede indicada no es válida; se muestran todas.");
  }

  const state = parseStateId(readParam(raw, "estado"));
  if (state === "invalid") notices.push("El estado (entidad) indicado no es válido; se muestran todos.");

  const rawWorker = readParam(raw, "trabajador");
  let workerId: string | null = null;
  if (rawWorker) {
    if (isGuid(rawWorker)) workerId = rawWorker.toLowerCase();
    else notices.push("El trabajador indicado no es válido; se muestran todas las personas.");
  }

  const attendance = parseAttendance(readParam(raw, "asistencia"));
  if (attendance === "invalid") notices.push("El estado de asistencia indicado no es válido; se muestran todos.");

  const rawPage = readParam(raw, "pagina");
  const pageNumber = rawPage && /^\d{1,5}$/.test(rawPage) ? Number(rawPage) : 1;

  return {
    filters: {
      desde,
      hasta,
      facilityId,
      stateId: state === "invalid" ? null : state,
      workerId,
      attendance: attendance === "invalid" ? "" : attendance,
    },
    notices,
    page: Math.max(1, pageNumber),
  };
}

export type ExportFormat = "xlsx" | "pdf";

export type ExportRequester = { role: AppRole; workerId: string | null };

export type ExportParseResult =
  | {
      ok: true;
      format: ExportFormat;
      filters: ReportFilters;
      /** Se forzó el registro propio (rol trabajador). */
      forcedOwn: boolean;
    }
  | { ok: false; status: 400 | 403; message: string };

const NOT_LINKED = "Tu cuenta no está vinculada a un registro de trabajador. Contacta a administración.";

/**
 * Valida los parámetros de GET /api/exportar.
 * Parámetros: formato=xlsx|pdf, desde, hasta (yyyy-MM-dd), sede (uuid),
 * estado (entidad, 1–99), asistencia, trabajador (uuid o "yo").
 */
export function parseExportParams(raw: RawParams, requester: ExportRequester, today: string): ExportParseResult {
  const bad = (message: string): ExportParseResult => ({ ok: false, status: 400, message });

  const formato = readParam(raw, "formato")?.toLowerCase();
  if (formato !== "xlsx" && formato !== "pdf") {
    return bad("Indica el formato de exportación: «xlsx» (Excel) o «pdf».");
  }

  const rawDesde = readParam(raw, "desde");
  const rawHasta = readParam(raw, "hasta");
  if (rawDesde !== undefined && !isIsoDay(rawDesde)) return bad("La fecha «desde» no es válida. Usa el formato AAAA-MM-DD.");
  if (rawHasta !== undefined && !isIsoDay(rawHasta)) return bad("La fecha «hasta» no es válida. Usa el formato AAAA-MM-DD.");
  let desde: string;
  let hasta: string;
  if (rawDesde && rawHasta) {
    desde = rawDesde;
    hasta = rawHasta;
  } else if (rawDesde) {
    desde = rawDesde;
    hasta = rawDesde > today ? rawDesde : today;
  } else if (rawHasta) {
    hasta = rawHasta;
    desde = addDays(rawHasta, -(DEFAULT_RANGE_DAYS - 1));
  } else {
    ({ desde, hasta } = defaultRange(today));
  }
  if (hasta < desde) return bad("La fecha final no puede ser anterior a la fecha inicial.");
  const days = daysInclusive(desde, hasta);
  if (days > MAX_RANGE_DAYS) {
    return bad(`El rango máximo de exportación es de ${MAX_RANGE_DAYS} días y seleccionaste ${days}. Divide la exportación en periodos más cortos.`);
  }

  const rawSede = readParam(raw, "sede");
  if (rawSede !== undefined && !isGuid(rawSede)) return bad("La sede indicada no es válida.");

  const state = parseStateId(readParam(raw, "estado"));
  if (state === "invalid") return bad("El estado (entidad federativa) indicado no es válido.");

  const attendance = parseAttendance(readParam(raw, "asistencia"));
  if (attendance === "invalid") return bad("El estado de asistencia indicado no es válido.");

  let workerId: string | null = null;
  let forcedOwn = false;
  if (requester.role === "trabajador") {
    // Siempre sus propios registros: se ignora cualquier otro filtro de persona.
    if (!requester.workerId) return { ok: false, status: 403, message: NOT_LINKED };
    workerId = requester.workerId;
    forcedOwn = true;
  } else {
    const rawWorker = readParam(raw, "trabajador");
    if (rawWorker === undefined) {
      workerId = null;
    } else if (rawWorker.toLowerCase() === "yo") {
      if (!requester.workerId) return bad(`${NOT_LINKED} No se puede usar «yo».`);
      workerId = requester.workerId;
    } else if (isGuid(rawWorker)) {
      workerId = rawWorker.toLowerCase();
    } else {
      return bad("El trabajador indicado no es válido (usa un identificador o «yo»).");
    }
  }

  return {
    ok: true,
    format: formato,
    filters: {
      desde,
      hasta,
      facilityId: rawSede ? rawSede.toLowerCase() : null,
      stateId: state,
      workerId,
      attendance,
    },
    forcedOwn,
  };
}

/** Parámetros de URL de unos filtros (solo los que tienen valor). */
export function filtersToSearchParams(filters: Partial<ReportFilters>, extra: Record<string, string | number | null | undefined> = {}): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== "") sp.set(key, String(value));
  }
  if (filters.desde) sp.set("desde", filters.desde);
  if (filters.hasta) sp.set("hasta", filters.hasta);
  if (filters.facilityId) sp.set("sede", filters.facilityId);
  if (filters.stateId) sp.set("estado", String(filters.stateId));
  if (filters.workerId) sp.set("trabajador", filters.workerId);
  if (filters.attendance) sp.set("asistencia", filters.attendance);
  return sp;
}

/** Enlace de exportación con los mismos filtros. */
export function exportHref(filters: Partial<ReportFilters>, format: ExportFormat): string {
  return `/api/exportar?${filtersToSearchParams(filters, { formato: format }).toString()}`;
}
