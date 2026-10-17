import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";
import { publicEnv } from "@/lib/env";

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers.
 * Usa la sesión del usuario: todas las consultas pasan por RLS.
 * Crea uno nuevo por solicitud; nunca lo compartas entre solicitudes.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
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
