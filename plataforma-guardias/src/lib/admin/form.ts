/**
 * Utilidades de formularios y traducción de errores del módulo de
 * administración (lógica pura).
 */
import type { z } from "zod";
import { friendlyDbError, type ActionResult } from "@/lib/actions";

export type FailedResult = Extract<ActionResult, { ok: false }>;

/** Primer mensaje por campo. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function invalidResult(error: z.ZodError): FailedResult {
  return { ok: false, message: "Revisa los campos marcados.", fieldErrors: fieldErrorsFrom(error) };
}

export function fieldFailure(field: string, message: string): FailedResult {
  return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { [field]: message } };
}

export function failure(message: string): FailedResult {
  return { ok: false, message };
}

/** Texto recortado; vacío → undefined (para que zod aplique «opcional»). */
export function readText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/** Valor sin recortar (contraseñas); vacío → undefined. */
export function readRaw(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.length ? value : undefined;
}

/** Valores múltiples (casillas) sin repetir ni vacíos. */
export function readAll(formData: FormData, key: string): string[] {
  const out = new Set<string>();
  for (const v of formData.getAll(key)) {
    if (typeof v === "string" && v.trim()) out.add(v.trim());
  }
  return [...out];
}

type PgLikeError = { message?: string; code?: string; details?: string | null; hint?: string | null } | null | undefined;

export const LAST_ADMIN_MESSAGE =
  "Debe existir al menos una cuenta de administración activa. Asigna primero el rol de administración a otra cuenta activa.";

/** Errores de base de datos en cuentas y configuración (incluye el último administrador). */
export function friendlyAdminError(error: PgLikeError, fallback = "No se pudo completar la operación."): string {
  if (error && /al menos un administrador activo/i.test(error.message ?? "")) return LAST_ADMIN_MESSAGE;
  return friendlyDbError(error, fallback);
}

type AuthLikeError = { message?: string; code?: string; status?: number; name?: string } | null | undefined;

/** Traduce errores de Supabase Auth (administración de cuentas). */
export function friendlyAuthError(error: AuthLikeError, fallback = "No se pudo completar la operación en el sistema de acceso."): string {
  if (!error) return fallback;
  const code = error.code ?? "";
  const msg = error.message ?? "";
  if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered|already exists/i.test(msg)) {
    return "Ya existe una cuenta con ese correo.";
  }
  if (code === "weak_password" || (/password/i.test(msg) && /weak|short|characters/i.test(msg))) {
    return "El sistema de acceso rechazó la contraseña por insegura. Usa una más larga o genera una automáticamente.";
  }
  if (code === "email_address_invalid" || /invalid email|unable to validate email/i.test(msg)) return "El correo no es válido.";
  if (code === "user_not_found" || error.status === 404) return "La cuenta no existe en el sistema de acceso.";
  if (code === "over_request_rate_limit" || error.status === 429) return "Demasiadas solicitudes seguidas. Espera un momento e inténtalo de nuevo.";
  if (/database error/i.test(msg)) {
    return "El sistema de acceso no pudo crear el perfil. Verifica que el trabajador no tenga ya una cuenta e inténtalo de nuevo.";
  }
  if (/SUPABASE_SERVICE_ROLE_KEY/.test(msg)) return SERVICE_KEY_MISSING_MESSAGE;
  return fallback;
}

export const SERVICE_KEY_MISSING_MESSAGE =
  "El servidor no tiene configurada la llave de servicio de Supabase; no es posible administrar cuentas de acceso.";
