/**
 * Filtros de la vista /guardias leídos de la URL (GET; funcionan sin JavaScript).
 * Funciones puras: no consultan la base de datos.
 */
import type { ShiftStatus } from "@/lib/attendance/calc";
import { addDays, daysBetween, isValidDay, localDay, startOfWeek } from "./dates";

export type ShiftView = "lista" | "calendario";
export type StatusFilter = "" | ShiftStatus | "todas";

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "", label: "Todas excepto canceladas" },
  { value: "programada", label: "Programadas" },
  { value: "en_curso", label: "En curso" },
  { value: "finalizada", label: "Finalizadas" },
  { value: "cancelada", label: "Canceladas" },
  { value: "todas", label: "Todas (incluye canceladas)" },
];

const STATUS_VALUES = new Set<string>(STATUS_FILTER_OPTIONS.map((o) => o.value));

/** Máximo de días que se cargan a la vez en la lista. */
export const MAX_RANGE_DAYS = 62;

export type ShiftListFilters = {
  view: ShiftView;
  facilityId: string | null;
  /** Fecha local de inicio (inclusive). */
  from: string;
  /** Fecha local de término (inclusive). */
  to: string;
  status: StatusFilter;
  onlyInsufficient: boolean;
  /** Avisos de filtros corregidos (se muestran al usuario). */
  notices: string[];
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: string | null | undefined): value is string {
  return !!value && GUID_RE.test(value);
}

/**
 * Interpreta los parámetros de la URL.
 * @param today Fecha local de hoy (yyyy-MM-dd).
 * @param allowedFacilityIds Sedes visibles para el usuario.
 */
export function parseShiftFilters(sp: RawSearchParams, today: string, allowedFacilityIds: string[]): ShiftListFilters {
  const notices: string[] = [];
  const view: ShiftView = firstParam(sp.vista) === "calendario" ? "calendario" : "lista";

  const rawFacility = firstParam(sp.sede)?.trim() || null;
  let facilityId: string | null = null;
  if (rawFacility) {
    if (isGuid(rawFacility) && allowedFacilityIds.includes(rawFacility)) {
      facilityId = rawFacility;
    } else {
      notices.push("La sede indicada no está disponible para tu cuenta; se muestran todas tus sedes.");
    }
  }

  const rawFrom = firstParam(sp.desde)?.trim();
  const rawTo = firstParam(sp.hasta)?.trim();
  if ((rawFrom && !isValidDay(rawFrom)) || (rawTo && !isValidDay(rawTo))) {
    notices.push("Alguna fecha no es válida; se usó la semana actual.");
  }
  const validFrom = isValidDay(rawFrom) ? rawFrom : null;
  const validTo = isValidDay(rawTo) ? rawTo : null;

  let from: string;
  let to: string;
  if (view === "calendario") {
    from = startOfWeek(validFrom ?? today);
    to = addDays(from, 6);
  } else {
    from = validFrom ?? (validTo ? addDays(validTo, -6) : startOfWeek(today));
    to = validTo ?? addDays(from, 6);
    if (daysBetween(from, to) < 0) {
      [from, to] = [to, from];
      notices.push("La fecha «desde» era posterior a «hasta»; se invirtió el rango.");
    }
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
      to = addDays(from, MAX_RANGE_DAYS - 1);
      notices.push(`El rango se limitó a ${MAX_RANGE_DAYS} días para mantener la vista ágil.`);
    }
  }

  const rawStatus = firstParam(sp.estado) ?? "";
  const status = (STATUS_VALUES.has(rawStatus) ? rawStatus : "") as StatusFilter;
  const onlyInsufficient = firstParam(sp.cobertura) === "1";

  return { view, facilityId, from, to, status, onlyInsufficient, notices };
}

/** ¿Hay que pedir también las guardias canceladas? */
export function includeCancelledFor(status: StatusFilter): boolean {
  return status === "cancelada" || status === "todas";
}

/** Coincidencia del estado efectivo con el filtro. */
export function matchesStatus(effective: ShiftStatus, status: StatusFilter): boolean {
  if (status === "todas") return true;
  if (status === "") return effective !== "cancelada";
  return effective === status;
}

export type FilterableShift = {
  effectiveStatus: ShiftStatus;
  coverage: { insufficient: boolean };
  shift: { starts_at: string };
  facility: { timezone: string } | null;
};

/** Día local de inicio de la guardia en la zona de su sede. */
export function shiftStartDay(item: FilterableShift, fallbackTz?: string | null): string {
  return localDay(item.shift.starts_at, item.facility?.timezone ?? fallbackTz);
}

/**
 * Aplica los filtros que no resuelve la consulta: día local de inicio dentro
 * del rango, estado efectivo y cobertura insuficiente.
 */
export function applyShiftFilters<T extends FilterableShift>(
  items: T[],
  filters: Pick<ShiftListFilters, "from" | "to" | "status" | "onlyInsufficient">,
  fallbackTz?: string | null,
): T[] {
  return items.filter((item) => {
    const day = shiftStartDay(item, fallbackTz);
    if (day < filters.from || day > filters.to) return false;
    if (!matchesStatus(item.effectiveStatus, filters.status)) return false;
    if (filters.onlyInsufficient && !item.coverage.insufficient) return false;
    return true;
  });
}

/** Agrupa por día local de inicio (una guardia que cruza medianoche queda en su día de inicio). */
export function groupByStartDay<T extends FilterableShift>(items: T[], days: string[], fallbackTz?: string | null): Map<string, T[]> {
  const map = new Map<string, T[]>(days.map((d) => [d, []]));
  for (const item of items) {
    const day = shiftStartDay(item, fallbackTz);
    const list = map.get(day);
    if (list) list.push(item);
  }
  return map;
}

/**
 * Construye la URL de /guardias con los filtros actuales y cambios puntuales.
 * Omite los valores por omisión para que la URL quede corta.
 */
export function guardiasHref(filters: ShiftListFilters, overrides: Partial<Omit<ShiftListFilters, "notices">> = {}): string {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (f.view === "calendario") params.set("vista", "calendario");
  if (f.facilityId) params.set("sede", f.facilityId);
  params.set("desde", f.from);
  if (f.view !== "calendario") params.set("hasta", f.to);
  if (f.status) params.set("estado", f.status);
  if (f.onlyInsufficient) params.set("cobertura", "1");
  const qs = params.toString();
  return qs ? `/guardias?${qs}` : "/guardias";
}

/** Rango desplazado por semanas (navegación anterior/siguiente). */
export function shiftRangeByWeeks(filters: Pick<ShiftListFilters, "from" | "to">, weeks: number): { from: string; to: string } {
  return { from: addDays(filters.from, weeks * 7), to: addDays(filters.to, weeks * 7) };
}

/** Semana actual (lunes a domingo). */
export function currentWeek(today: string): { from: string; to: string } {
  const from = startOfWeek(today);
  return { from, to: addDays(from, 6) };
}
