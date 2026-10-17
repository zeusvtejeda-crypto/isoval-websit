import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TIMEZONE, dayRangeUtc, isValidTimezone } from "@/lib/time";

/**
 * Turnos por hora LOCAL de inicio de la guardia (zona de la sede):
 * matutino 06–14, vespertino 14–22, nocturno 22–06.
 */
export const SHIFT_PERIOD_FILTERS = ["todos", "matutino", "vespertino", "nocturno"] as const;
export type ShiftPeriodFilter = (typeof SHIFT_PERIOD_FILTERS)[number];
export type ShiftPeriod = Exclude<ShiftPeriodFilter, "todos">;

export const SHIFT_PERIOD_LABELS: Record<ShiftPeriodFilter, string> = {
  todos: "Todos los turnos",
  matutino: "Matutino (06:00–14:00)",
  vespertino: "Vespertino (14:00–22:00)",
  nocturno: "Nocturno (22:00–06:00)",
};

type DateLike = Date | string | number;

function zone(tz?: string | null): string {
  return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** Hora local (0–23) en la zona indicada. */
export function localHour(value: DateLike, tz?: string | null): number {
  const date = value instanceof Date ? value : new Date(value);
  return Number(formatInTimeZone(date, zone(tz), "H"));
}

export function shiftPeriodOf(startsAt: DateLike, tz?: string | null): ShiftPeriod {
  const h = localHour(startsAt, tz);
  if (h >= 6 && h < 14) return "matutino";
  if (h >= 14 && h < 22) return "vespertino";
  return "nocturno";
}

export function parseShiftPeriod(value: unknown): ShiftPeriodFilter {
  return typeof value === "string" && (SHIFT_PERIOD_FILTERS as readonly string[]).includes(value)
    ? (value as ShiftPeriodFilter)
    : "todos";
}

/** ¿El intervalo [startsAt, endsAt) se traslapa con el día local `day` (yyyy-MM-dd) de la zona? */
export function overlapsLocalDay(startsAt: DateLike, endsAt: DateLike, day: string, tz?: string | null): boolean {
  const { start, end } = dayRangeUtc(day, zone(tz));
  const s = new Date(startsAt).getTime();
  const e = new Date(endsAt).getTime();
  return s < end.getTime() && e > start.getTime();
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
