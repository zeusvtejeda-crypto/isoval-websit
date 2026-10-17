import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

/** Carga .env.local si existe (los scripts se ejecutan fuera de Next.js). */
export function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}

export function adminClient() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Crea (o actualiza) una cuenta con rol en app_metadata y la vincula a un trabajador. */
export async function upsertAccount(opts: {
  email: string;
  password: string;
  role: "admin" | "coordinador" | "trabajador" | "auditor";
  displayName: string;
  workerId?: string | null;
  facilityIds?: string[];
}) {
  const sb = adminClient();
  const { data: list, error: listError } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  let user = list.users.find((u) => u.email?.toLowerCase() === opts.email.toLowerCase());
  if (!user) {
    const { data, error } = await sb.auth.admin.createUser({
      email: opts.email,
      password: opts.password,
      email_confirm: true,
      app_metadata: { role: opts.role, worker_id: opts.workerId ?? null },
      user_metadata: { display_name: opts.displayName },
    });
    if (error) throw error;
    user = data.user;
  }
  const { error: profileError } = await sb
    .from("profiles")
    .update({ role: opts.role, worker_id: opts.workerId ?? null, display_name: opts.displayName, active: true })
    .eq("id", user.id);
  if (profileError) throw profileError;
  if (opts.facilityIds?.length) {
    const { error } = await sb
      .from("user_facility_scopes")
      .upsert(opts.facilityIds.map((facility_id) => ({ user_id: user.id, facility_id })), { onConflict: "user_id,facility_id" });
    if (error) throw error;
  }
  return user.id;
}
