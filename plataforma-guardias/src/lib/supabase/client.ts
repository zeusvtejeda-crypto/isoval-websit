"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";
import { publicEnv } from "@/lib/env";

/** Cliente para el navegador (solo llave pública; RLS protege los datos). */
export function createClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
