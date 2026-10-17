/**
 * Vigencia y renovación del código QR (lógica pura).
 *
 * La vigencia se calcula con las horas del SERVIDOR (expires_at − server_time)
 * y se ancla al reloj local en el momento en que se envió la solicitud, así
 * un reloj del dispositivo adelantado o atrasado no altera la cuenta regresiva.
 * Anclar al envío (y no a la respuesta) da una estimación conservadora.
 */
import type { QrIssueErrorKind } from "./core";

/** Margen deseado para renovar antes de caducar (p. ej. TTL 120 s → renueva a los 90 s). */
export const RENEW_MARGIN_SECONDS = 30;
/** Nunca se programa una renovación a menos de este tiempo (evita ciclos). */
export const MIN_RENEW_DELAY_MS = 1_000;

export type IssuedTiming = { expiresAt: string; serverTime: string; ttlSeconds: number };

/** Milisegundos de vigencia según el servidor; si las fechas no sirven, usa el TTL. */
export function validityMs(t: IssuedTiming): number {
  const diff = Date.parse(t.expiresAt) - Date.parse(t.serverTime);
  if (Number.isFinite(diff) && diff > 0) return diff;
  return Math.max(0, t.ttlSeconds) * 1000;
}

/** Instante (reloj local, ms) en que caduca el código. */
export function localExpiry(t: IssuedTiming, sentAtMs: number): number {
  return sentAtMs + validityMs(t);
}

/**
 * Margen de renovación para un TTL dado: 30 s, o la mitad del TTL si es corto
 * (mínimo 5 s). El servidor limita el TTL a 30–600 s.
 */
export function renewMarginSeconds(ttlSeconds: number): number {
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 0;
  return Math.max(5, Math.min(RENEW_MARGIN_SECONDS, Math.floor(ttl / 2)));
}

/** Instante (reloj local, ms) en que conviene pedir un código nuevo. */
export function renewAt(expiresLocalMs: number, ttlSeconds: number): number {
  return expiresLocalMs - renewMarginSeconds(ttlSeconds) * 1000;
}

/** Espera hasta la siguiente renovación (mínimo MIN_RENEW_DELAY_MS). */
export function msUntilRenewal(expiresLocalMs: number, ttlSeconds: number, nowMs: number): number {
  return Math.max(MIN_RENEW_DELAY_MS, renewAt(expiresLocalMs, ttlSeconds) - nowMs);
}

/** ¿Ya toca renovar? (por ejemplo, al volver a la pestaña). */
export function isDueForRenewal(expiresLocalMs: number, ttlSeconds: number, nowMs: number): boolean {
  return nowMs >= renewAt(expiresLocalMs, ttlSeconds);
}

/** Segundos enteros que le quedan al código (0 si ya caducó). */
export function secondsLeft(expiresLocalMs: number, nowMs: number): number {
  const ms = expiresLocalMs - nowMs;
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/**
 * Reintento automático tras un error al pedir el código.
 * null = no se reintenta solo (guardia cancelada, sin permiso, inexistente).
 */
export function retryDelayMs(kind: QrIssueErrorKind): number | null {
  switch (kind) {
    case "offline":
      return 10_000;
    case "unknown":
      return 15_000;
    case "window":
      // Fuera de la ventana: se vuelve a intentar cada minuto por si ya abrió.
      return 60_000;
    default:
      return null;
  }
}
