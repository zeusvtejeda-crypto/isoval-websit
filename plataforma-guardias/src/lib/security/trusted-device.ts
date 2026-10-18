import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cookie de «dispositivo de confianza»: se entrega al iniciar sesión con éxito y
 * permite seguir intentando desde ese dispositivo aunque la cuenta haya llegado al
 * umbral por correo (que cualquiera podría provocar con intentos desde muchas IP).
 * Va firmada (HMAC) y solo guarda una huella del correo, nunca el correo.
 */
export const TRUSTED_DEVICE_COOKIE = "gd_dispositivo";
export const TRUSTED_DEVICE_MAX_AGE = 180 * 24 * 60 * 60; // segundos

function secret(): string | null {
  return process.env.DEVICE_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function emailHash(email: string, key: string): string {
  return sign(`correo:${email.trim().toLowerCase()}`, key).slice(0, 32);
}

/** Valor de la cookie para el correo (null si no hay secreto configurado). */
export function trustedDeviceToken(email: string, now = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const payload = `v1.${emailHash(email, key)}.${Math.floor(now / 1000)}`;
  return `${payload}.${sign(payload, key)}`;
}

/** ¿La cookie es válida, vigente y de ese correo? */
export function isTrustedDevice(value: string | undefined, email: string, now = Date.now()): boolean {
  const key = secret();
  if (!key || !value || value.length > 200) return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const [version, hash, issued, signature] = parts;
  const expected = Buffer.from(sign(`${version}.${hash}.${issued}`, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  const issuedAt = Number(issued) * 1000;
  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > TRUSTED_DEVICE_MAX_AGE * 1000) return false;
  return hash === emailHash(email, key);
}
