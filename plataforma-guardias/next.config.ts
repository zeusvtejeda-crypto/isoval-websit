import type { NextConfig } from "next";

/**
 * Cache Components queda desactivado: casi todas las vistas dependen de la
 * sesión y muestran datos privados, que nunca deben cachearse entre usuarios.
 */
const isDev = process.env.NODE_ENV === "development";
const siteIsHttps = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

/** Origen permitido para un servidor externo a partir de una URL o plantilla de teselas. */
function originOf(template: string | undefined): string | null {
  if (!template) return null;
  try {
    const url = new URL(template.replace(/\{s\}\./, "subdominio.").replace(/\{[^}]+\}/g, "0"));
    const host = template.includes("{s}.") ? url.host.replace(/^subdominio\./, "*.") : url.host;
    return `${url.protocol}//${host}`;
  } catch {
    return null;
  }
}

const tileOrigin = originOf(process.env.NEXT_PUBLIC_MAP_TILE_URL) ?? "https://tile.openstreetmap.org";
const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);

/**
 * CSP sin nonces (ver docs de Next 16.4 «Without Nonces»): limita los orígenes de
 * scripts, conexiones e imágenes. Leaflet usa estilos en línea.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: ${tileOrigin}`,
  "font-src 'self'",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(siteIsHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  ...(siteIsHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    // Sin cámara, micrófono ni ubicación: la plataforma no los usa.
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  experimental: {
    // Importaciones CSV/Excel de hasta 5 MB.
    serverActions: { bodySizeLimit: "6mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
