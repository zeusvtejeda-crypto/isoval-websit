/**
 * Content-Security-Policy de las páginas. La arma src/proxy.ts en cada solicitud.
 *
 * - Páginas dinámicas: script-src con un nonce por solicitud y 'strict-dynamic'
 *   (Next 16 lo lee del encabezado de la solicitud y lo pone en sus scripts; ver
 *   node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 *   'strict-dynamic' permite los fragmentos que cargan esos scripts (Leaflet,
 *   next/script) e ignora 'self' y las listas de orígenes en navegadores con CSP 3.
 * - /offline y /sin-acceso (STATIC_ROUTES del proxy): sin datos ni entradas del
 *   usuario; conservan 'unsafe-inline' en script-src para seguir funcionando si
 *   se prerenderizan (un HTML generado al compilar no puede llevar nonce).
 *   Las demás páginas no se prerenderizan: app/not-found.tsx llama a connection().
 *
 * style-src conserva 'unsafe-inline': Leaflet y React ponen atributos style, que
 * un nonce no cubre.
 */

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export type CspEnv = {
  isDev: boolean;
  supabaseUrl?: string;
  tileUrl?: string;
  siteUrl?: string;
  turnstileSiteKey?: string;
};

/** Origen permitido para un servidor externo a partir de una URL o plantilla de teselas. */
export function originOf(template: string | undefined): string | null {
  if (!template) return null;
  try {
    const url = new URL(template.replace(/\{s\}\./, "subdominio.").replace(/\{[^}]+\}/g, "0"));
    const host = template.includes("{s}.") ? url.host.replace(/^subdominio\./, "*.") : url.host;
    return `${url.protocol}//${host}`;
  } catch {
    return null;
  }
}

/** Nonce aleatorio de 128 bits en base64 (formato que acepta Next 16). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Variables de entorno (NEXT_PUBLIC_* se incorporan al compilar el proxy). */
export function cspEnvFromProcess(): CspEnv {
  return {
    isDev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    tileUrl: process.env.NEXT_PUBLIC_MAP_TILE_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  };
}

/** Política completa. Con `nonce` = null se genera la de las páginas prerenderizadas. */
export function buildContentSecurityPolicy(nonce: string | null, env: CspEnv = cspEnvFromProcess()): string {
  const tileOrigin = originOf(env.tileUrl) ?? originOf(DEFAULT_TILE_URL);
  const supabaseOrigin = originOf(env.supabaseUrl);
  const turnstile = Boolean(env.turnstileSiteKey);
  const siteIsHttps = (env.siteUrl ?? "").startsWith("https://");

  const scriptSrc = [
    "'self'",
    ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : ["'unsafe-inline'"]),
    // React usa eval en desarrollo para reconstruir pilas de errores del servidor.
    ...(env.isDev ? ["'unsafe-eval'"] : []),
    ...(turnstile ? [TURNSTILE_ORIGIN] : []),
  ];
  const connectSrc = ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : []), ...(turnstile ? [TURNSTILE_ORIGIN] : [])];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${tileOrigin}`,
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    ...(turnstile ? [`frame-src 'self' ${TURNSTILE_ORIGIN}`] : []),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(siteIsHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
