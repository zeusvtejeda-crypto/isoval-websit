/**
 * Utilidades puras de fechas para guardias (sin dependencias de servidor).
 * Las fechas "día" se manejan como texto yyyy-MM-dd (fecha local de la sede)
 * y la aritmética se hace en UTC para no depender de la zona del equipo.
 */
import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";
import { isValidTimezone, localInputToUtc, todayInTz } from "@/lib/time";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const DAY_MS = 86_400_000;

/** ¿Es una fecha de calendario real con formato yyyy-MM-dd? */
export function isValidDay(day: string | null | undefined): day is string {
  if (!day || !DATE_RE.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === day;
}

/** ¿Es una hora HH:mm válida (00:00 a 23:59)? */
export function isValidTime(value: string | null | undefined): value is string {
  return !!value && TIME_RE.test(value);
}

export function addDays(day: string, n: number): string {
  if (!isValidDay(day)) throw new Error("Fecha inválida");
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Días de diferencia (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Lunes de la semana que contiene el día indicado (semana de lunes a domingo). */
export function startOfWeek(day: string): string {
  if (!isValidDay(day)) throw new Error("Fecha inválida");
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
}

/** Los 7 días (lunes a domingo) a partir del lunes indicado. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Lista de días entre dos fechas (inclusive). */
export function daysInRange(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

function noonUtc(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/** "sábado 17 de octubre" */
export function formatDayLong(day: string): string {
  return formatInTimeZone(noonUtc(day), "UTC", "EEEE d 'de' MMMM", { locale: es });
}

/** "sáb 17 oct" */
export function formatDayShort(day: string): string {
  return formatInTimeZone(noonUtc(day), "UTC", "EEE d MMM", { locale: es });
}

/** "12 – 18 oct 2026" o "28 sep – 4 oct 2026" */
export function formatRangeLabel(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const left = formatInTimeZone(noonUtc(from), "UTC", sameMonth ? "d" : sameYear ? "d MMM" : "d MMM yyyy", { locale: es });
  const right = formatInTimeZone(noonUtc(to), "UTC", "d MMM yyyy", { locale: es });
  return `${left} – ${right}`;
}

/** Minutos desde la medianoche para una hora HH:mm. */
export function timeToMinutes(value: string): number {
  if (!isValidTime(value)) throw new Error("Hora inválida");
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Lectura "de reloj" de un horario: si la hora de término es menor o igual a
 * la de inicio, la guardia termina al día siguiente (igual = 24 h).
 */
export function describeShiftClock(startTime: string, endTime: string): { crossesMidnight: boolean; durationMinutes: number } | null {
  if (!isValidTime(startTime) || !isValidTime(endTime)) return null;
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  const crossesMidnight = e <= s;
  return { crossesMidnight, durationMinutes: crossesMidnight ? e + 1440 - s : e - s };
}

export type ShiftTimes = {
  startsAt: Date;
  endsAt: Date;
  /** Fecha local (yyyy-MM-dd) en que termina. */
  endDate: string;
  crossesMidnight: boolean;
  /** Duración real (puede diferir de la de reloj si hay cambio de horario). */
  durationMinutes: number;
};

/**
 * Convierte fecha + horas capturadas en la zona de la sede a instantes UTC.
 * Si la hora de término es menor o igual a la de inicio, termina al día
 * siguiente (término igual a inicio = 24 horas).
 */
export function buildShiftTimes(date: string, startTime: string, endTime: string, tz: string): ShiftTimes {
  if (!isValidDay(date)) throw new Error("Fecha inválida");
  if (!isValidTime(startTime)) throw new Error("Hora de inicio inválida");
  if (!isValidTime(endTime)) throw new Error("Hora de término inválida");
  if (!tz || !isValidTimezone(tz)) throw new Error("Zona horaria inválida");
  const clock = describeShiftClock(startTime, endTime);
  const crossesMidnight = clock?.crossesMidnight ?? false;
  const endDate = crossesMidnight ? addDays(date, 1) : date;
  const startsAt = localInputToUtc(`${date}T${startTime}`, tz);
  const endsAt = localInputToUtc(`${endDate}T${endTime}`, tz);
  return {
    startsAt,
    endsAt,
    endDate,
    crossesMidnight,
    durationMinutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
  };
}

/**
 * Operación inversa (para precargar el formulario de edición): fecha y horas
 * locales de una guardia. `representable` es false si la guardia dura más de
 * 24 h o no puede reconstruirse exactamente con fecha + horas.
 */
export function splitShiftTimes(
  startsAt: Date | string,
  endsAt: Date | string,
  tz: string,
): { date: string; startTime: string; endTime: string; durationMinutes: number; representable: boolean } {
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  const end = endsAt instanceof Date ? endsAt : new Date(endsAt);
  const date = formatInTimeZone(start, tz, "yyyy-MM-dd");
  const startTime = formatInTimeZone(start, tz, "HH:mm");
  const endTime = formatInTimeZone(end, tz, "HH:mm");
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  let representable = durationMinutes > 0 && durationMinutes <= 1440;
  if (representable) {
    const rebuilt = buildShiftTimes(date, startTime, endTime, tz);
    representable = rebuilt.startsAt.getTime() === start.getTime() && rebuilt.endsAt.getTime() === end.getTime();
  }
  return { date, startTime, endTime, durationMinutes, representable };
}

/** Día local (yyyy-MM-dd) de un instante en la zona indicada. */
export function localDay(value: Date | string, tz: string | null | undefined): string {
  return todayInTz(tz, value instanceof Date ? value : new Date(value));
}

/** ¿Ya llegó la hora de inicio? */
export function hasStarted(startsAt: Date | string, now: Date = new Date()): boolean {
  const t = startsAt instanceof Date ? startsAt.getTime() : Date.parse(startsAt);
  return t <= now.getTime();
}
