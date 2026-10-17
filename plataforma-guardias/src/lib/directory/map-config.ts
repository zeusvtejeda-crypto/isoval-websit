import { publicEnv } from "@/lib/env";

export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">Colaboradores de OpenStreetMap</a>';

/**
 * La atribución de OpenStreetMap es obligatoria: si la configuración la omite,
 * se agrega al final.
 */
export function ensureOsmAttribution(attribution: string | null | undefined): string {
  const value = attribution?.trim();
  if (!value) return OSM_ATTRIBUTION;
  return /openstreetmap/i.test(value) ? value : `${value} | ${OSM_ATTRIBUTION}`;
}

export type MapViewConfig = { tileUrl: string; attribution: string; center: [number, number]; zoom: number };

/** Configuración del mapa desde publicEnv.map, con valores seguros por omisión. */
export function mapViewConfig(env: typeof publicEnv.map = publicEnv.map): MapViewConfig {
  const lat = Number.isFinite(env.centerLat) && Math.abs(env.centerLat) <= 90 ? env.centerLat : 23.6;
  const lng = Number.isFinite(env.centerLng) && Math.abs(env.centerLng) <= 180 ? env.centerLng : -102.5;
  const zoom = Number.isFinite(env.zoom) && env.zoom >= 1 && env.zoom <= 19 ? env.zoom : 5;
  const tileUrl = env.tileUrl?.trim() || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  return { tileUrl, attribution: ensureOsmAttribution(env.attribution), center: [lat, lng], zoom };
}
