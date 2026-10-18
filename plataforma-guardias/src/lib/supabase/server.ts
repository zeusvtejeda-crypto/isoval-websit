import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";
import { publicEnv } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS, asBrowserSessionCookie } from "@/lib/supabase/cookies";

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers.
 * Usa la sesión del usuario: todas las consultas pasan por RLS.
 * Crea uno nuevo por solicitud; nunca lo compartas entre solicitudes.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      // Los encabezados anticaché que manda @supabase/ssr no se aplican aquí: las
      // respuestas de Server Actions y Route Handlers que fijan cookies no se cachean.
      setAll(cookiesToSet) {
        try {
          for (const cookie of cookiesToSet) {
            const { name, value, options } = asBrowserSessionCookie(cookie);
            cookieStore.set(name, value, options);
          }
        } catch {
          // Llamado desde un Server Component: el proxy renueva la sesión.
        }
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
