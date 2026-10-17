import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";

export const DEFAULT_TIMEZONE = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || "America/Mazatlan";

type DateLike = Date | string | number;

function toDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function safeTz(tz?: string | null): string {
  return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** 17/10/2026 22:05 */
export function formatDateTime(value: DateLike, tz?: string | null): string {
  return formatInTimeZone(toDate(value), safeTz(tz), "dd/MM/yyyy HH:mm", { locale: es });
}

/** 22:05 */
export function formatTime(value: DateLike, tz?: string | null): string {
  return formatInTimeZone(toDate(value), safeTz(tz), "HH:mm", { locale: es });
}

/** sáb 17 oct 2026 */
export function formatDate(value: DateLike, tz?: string | null): string {
  return formatInTimeZone(toDate(value), safeTz(tz), "EEE d MMM yyyy", { locale: es });
}

/** sábado 17 de octubre de 2026 */
export function formatLongDate(value: DateLike, tz?: string | null): string {
  return formatInTimeZone(toDate(value), safeTz(tz), "EEEE d 'de' MMMM 'de' yyyy", { locale: es });
}

/** Desfase legible, p. ej. "GMT-7". */
export function formatOffset(value: DateLike, tz?: string | null): string {
  return formatInTimeZone(toDate(value), safeTz(tz), "zzz", { locale: es });
}

/** Rango horario de una guardia; indica si termina otro día ("+1 día"). */
export function formatShiftRange(startsAt: DateLike, endsAt: DateLike, tz?: string | null): string {
  const zone = safeTz(tz);
  const startDay = formatInTimeZone(toDate(startsAt), zone, "yyyy-MM-dd");
  const endDay = formatInTimeZone(toDate(endsAt), zone, "yyyy-MM-dd");
  const base = `${formatDate(startsAt, zone)}, ${formatTime(startsAt, zone)} – ${formatTime(endsAt, zone)}`;
  if (startDay === endDay) return base;
  const days = Math.round(
    (Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / 86_400_000,
  );
  return `${base} (+${days} día${days === 1 ? "" : "s"})`;
}

/** Convierte "2026-10-17T22:00" capturado en la zona de la sede a UTC. */
export function localInputToUtc(local: string, tz?: string | null): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local)) {
    throw new Error("Fecha y hora inválidas");
  }
  return fromZonedTime(local, safeTz(tz));
}

/** Valor para <input type="datetime-local"> en la zona de la sede. */
export function utcToLocalInput(value: DateLike, tz?: string | null): string {
  return formatInTimeZone(toDate(value), safeTz(tz), "yyyy-MM-dd'T'HH:mm");
}

/** Fecha de hoy (yyyy-MM-dd) en la zona indicada. */
export function todayInTz(tz?: string | null, now: Date = new Date()): string {
  return formatInTimeZone(now, safeTz(tz), "yyyy-MM-dd");
}

/** Inicio y fin (UTC) de un día local en la zona indicada. */
export function dayRangeUtc(day: string, tz?: string | null): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Fecha inválida");
  const zone = safeTz(tz);
  const start = fromZonedTime(`${day}T00:00:00`, zone);
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const end = fromZonedTime(`${next}T00:00:00`, zone);
  return { start, end };
}

/** "3 h 25 min", "45 min", "0 min". Valores negativos con signo. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  const sign = minutes < 0 ? "−" : "";
  const abs = Math.abs(Math.trunc(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m} min`;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${m} min`;
}

/** Horas decimales con 2 decimales (para exportaciones). */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}
