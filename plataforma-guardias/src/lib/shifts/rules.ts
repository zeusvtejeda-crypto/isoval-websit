/**
 * Reglas de la base de datos que la interfaz anticipa (puras).
 * La fuente de verdad es la BD (migración 20261017000700_endurecimiento.sql):
 * aquí solo se reflejan para ocultar o explicar acciones que serían rechazadas
 * y para validar en el servidor antes de escribir.
 */
import { formatDateTime, utcToLocalInput } from "@/lib/time";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Horas capturadas a mano: dentro de la guardia ±12 h (app.assert_within_shift). */
export const CAPTURE_WINDOW_HOURS = 12;

/** Aviso en la interfaz cuando la asignación es de la propia cuenta. */
export const OWN_RECORD_NOTICE = "No puedes corregir tu propia asistencia; pide a otra persona de coordinación o a administración.";
/** Mensaje de app.assert_not_own_record; el servidor lo devuelve igual al validar antes de escribir. */
export const OWN_RECORD_DB_MESSAGE =
  "No puedes corregir, anular ni revisar tu propia asistencia. Pide a otra persona de coordinación o a administración.";
/** Entrada abierta más allá de término + margen: check_out la rechaza para todos. */
export const STALE_OPEN_NOTICE = "La entrada quedó sin salida. Usa «Corregir registro» con la hora real.";
export const SCHEDULE_LOCKED_NOTICE = "El horario solo lo cambia administración porque ya hay registros de asistencia.";
export const FACILITY_LOCKED_NOTICE =
  "No se puede cambiar la sede de una guardia que ya tiene asignaciones. Crea una guardia nueva en la otra sede.";
export const OUTSIDE_WINDOW_MESSAGE = "Las horas deben estar dentro del horario de la guardia (máximo 12 h antes del inicio o después del término)";
export const FUTURE_TIME_MESSAGE = "No se pueden registrar horas futuras.";

type DateLike = Date | string;
const toMs = (value: DateLike) => (value instanceof Date ? value.getTime() : Date.parse(value));

export type Viewer = { isAdmin: boolean; workerId: string | null };

/**
 * ¿La asignación es de la propia cuenta? Salvo administración, nadie corrige,
 * agrega, anula, cambia el estado ni justifica incidencias de su propia asistencia.
 */
export function isOwnRecordLocked(viewer: Viewer, workerId: string | null | undefined): boolean {
  return !viewer.isAdmin && !!viewer.workerId && !!workerId && viewer.workerId === workerId;
}

/**
 * ¿La entrada abierta ya pasó el término + margen? Entonces nadie (tampoco
 * coordinación) registra la salida con la hora actual: se corrige con la hora real.
 */
export function isOpenSessionStale(input: { hasOpenSession: boolean; shiftEndsAt: DateLike; now: Date; graceMinutes: number }): boolean {
  if (!input.hasOpenSession) return false;
  return input.now.getTime() > toMs(input.shiftEndsAt) + Math.max(0, input.graceMinutes) * MINUTE_MS;
}

/** ¿El horario de la guardia está bloqueado para esta cuenta? (hay asistencia vigente y no es administración) */
export function isScheduleLocked(viewer: { isAdmin: boolean }, validSessions: number): boolean {
  return !viewer.isAdmin && validSessions > 0;
}

/** Ventana permitida para horas capturadas a mano: [inicio − 12 h, término + 12 h]. */
export function captureWindow(shift: { starts_at: DateLike; ends_at: DateLike }): { min: Date; max: Date } {
  return {
    min: new Date(toMs(shift.starts_at) - CAPTURE_WINDOW_HOURS * HOUR_MS),
    max: new Date(toMs(shift.ends_at) + CAPTURE_WINDOW_HOURS * HOUR_MS),
  };
}

/** Límites min/max para <input type="datetime-local"> en la zona de la sede (nunca en el futuro). */
export function captureInputBounds(shift: { starts_at: DateLike; ends_at: DateLike }, now: Date, tz: string): { min: string; max: string } {
  const { min, max } = captureWindow(shift);
  const upper = Math.max(min.getTime(), Math.min(max.getTime(), now.getTime()));
  return { min: utcToLocalInput(min, tz), max: utcToLocalInput(upper, tz) };
}

/** Texto del rango permitido: "17/10/2026 10:00 y 18/10/2026 18:00". */
export function describeCaptureWindow(shift: { starts_at: DateLike; ends_at: DateLike }, tz: string): string {
  const { min, max } = captureWindow(shift);
  return `${formatDateTime(min, tz)} y ${formatDateTime(max, tz)}`;
}

/**
 * Validación previa (servidor) de horas capturadas para correcciones y
 * registros manuales: no futuras y dentro de la guardia ±12 h.
 */
export function validateCapturedTimes(
  shift: { starts_at: DateLike; ends_at: DateLike },
  checkIn: Date,
  checkOut: Date | null,
  opts: { now: Date; tz: string },
): { message: string; fieldErrors: Record<string, string> } | null {
  const now = opts.now.getTime();
  const future: Record<string, string> = {};
  if (checkIn.getTime() > now) future.check_in = "No puede ser una hora futura.";
  if (checkOut && checkOut.getTime() > now) future.check_out = "No puede ser una hora futura.";
  if (Object.keys(future).length) return { message: FUTURE_TIME_MESSAGE, fieldErrors: future };

  const { min, max } = captureWindow(shift);
  const outside = (d: Date) => d.getTime() < min.getTime() || d.getTime() > max.getTime();
  const errors: Record<string, string> = {};
  const range = describeCaptureWindow(shift, opts.tz);
  if (outside(checkIn)) errors.check_in = `Debe estar entre ${range}.`;
  if (checkOut && outside(checkOut)) errors.check_out = `Debe estar entre ${range}.`;
  if (Object.keys(errors).length) return { message: `${OUTSIDE_WINDOW_MESSAGE}: entre ${range}.`, fieldErrors: errors };
  return null;
}
