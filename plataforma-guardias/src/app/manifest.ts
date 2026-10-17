import type { MetadataRoute } from "next";

/**
 * Manifiesto de la PWA (se sirve en /manifest.webmanifest y Next.js agrega el
 * <link rel="manifest"> automáticamente). Los íconos se generan con
 * `node scripts/generar-iconos.mjs` y el service worker (public/sw.js) los precarga.
 *
 * Plataforma independiente: no es una aplicación oficial del IMSS.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Guardias y Directorio de Instalaciones",
    short_name: "Guardias",
    description:
      "Directorio y mapa de instalaciones y control de guardias (registro de entradas y salidas). " +
      "Plataforma independiente: no es una aplicación oficial del IMSS.",
    lang: "es-MX",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#14532d",
    categories: ["productivity", "utilities"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Registrar entrada o salida",
        short_name: "Registrar",
        description: "Abre el registro de entrada o salida de tu guardia.",
        url: "/registro",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Directorio de instalaciones",
        short_name: "Directorio",
        description: "Consulta el mapa y la lista de instalaciones.",
        url: "/directorio",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
