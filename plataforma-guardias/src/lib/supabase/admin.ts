import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { publicEnv } from "@/lib/env";

/**
 * Cliente con llave de servicio. SOLO SERVIDOR. Omite RLS, así que únicamente
 * se usa para operaciones de Auth (crear o desactivar cuentas) DESPUÉS de
 * verificar en el servidor que quien lo solicita es administrador.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.");
  }
  return createClient<Database>(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
