import type { NextConfig } from "next";

/**
 * Cache Components queda desactivado: casi todas las vistas dependen de la
 * sesión y muestran datos privados, que nunca deben cachearse entre usuarios.
 */
const siteIsHttps = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

/**
 * La Content-Security-Policy de las páginas la fija src/proxy.ts en cada
 * solicitud (nonce + 'strict-dynamic'; ver src/lib/csp.ts). Aquí solo queda la
 * del service worker, que el proxy no procesa: un worker usa la CSP con la que
 * se sirvió su script y este solo pide recursos del mismo origen.
 */
const serviceWorkerCsp = "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

const securityHeaders = [
  ...(siteIsHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Aísla la ventana de otras pestañas (window.opener) y evita que otros sitios
  // incrusten nuestros recursos.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
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
          { key: "Content-Security-Policy", value: serviceWorkerCsp },
        ],
      },
    ];
  },
};

export default nextConfig;
