import type { CookieOptions } from "@supabase/ssr";

/**
 * Opciones de las cookies de sesión de Supabase (proxy y servidor).
 *
 * Los valores por omisión de @supabase/ssr son httpOnly: false, sin Secure y
 * maxAge de 400 días. Aquí la sesión solo la lee el servidor (no hay cliente de
 * Supabase en el navegador), así que el JavaScript de la página no necesita ver
 * los tokens. En producción solo viajan por HTTPS.
 */
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
} as const satisfies CookieOptions;

export type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Convierte la cookie en una cookie de sesión del navegador (sin maxAge ni
 * expires): se borra al cerrar el navegador. @supabase/ssr vuelve a poner
 * maxAge después de aplicar cookieOptions, por eso se quita aquí. La duración
 * real la imponen las sesiones de Supabase Auth (timebox e inactividad en
 * supabase/config.toml). Las eliminaciones (valor vacío) conservan su maxAge 0.
 */
export function asBrowserSessionCookie(cookie: CookieToSet): CookieToSet {
  if (!cookie.value) return cookie;
  const options = { ...cookie.options };
  delete options.maxAge;
  delete options.expires;
  return { ...cookie, options };
}
