/**
 * Variables públicas (disponibles en el navegador). Nunca agregues aquí claves secretas.
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  defaultTimezone: process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE ?? "America/Mazatlan",
  demoMode: (process.env.NEXT_PUBLIC_DEMO_MODE ?? "false") === "true",
  map: {
    tileUrl: process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
      '&copy; <a href="https://www.openstreetmap.org/copyright">Colaboradores de OpenStreetMap</a>',
    centerLat: Number(process.env.NEXT_PUBLIC_MAP_CENTER_LAT ?? "21.75"),
    centerLng: Number(process.env.NEXT_PUBLIC_MAP_CENTER_LNG ?? "-104.85"),
    zoom: Number(process.env.NEXT_PUBLIC_MAP_ZOOM ?? "8"),
  },
} as const;

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}
