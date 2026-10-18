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

/**
 * ¿Es el Supabase local de desarrollo? Se decide por la llave (la JWT de
 * demostración de la CLI, emisor «supabase-demo») y por el host exacto, no por
 * un texto en la URL.
 */
export function isLocalSupabase(): boolean {
  loadEnv();
  let host = "";
  try {
    host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return false;
  }
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) return false;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8")) as { iss?: string };
    return payload.iss === "supabase-demo";
  } catch {
    return false;
  }
}

export function adminClient() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Crea una cuenta con rol en app_metadata y la vincula a un trabajador.
 * Si ya existe: con `existing: "update"` (solo datos de demostración) la
 * actualiza; con "promote" cambia también su contraseña y su rol; si no, falla
 * (así nadie convierte en administración una cuenta ajena por un error al teclear).
 */
export async function upsertAccount(opts: {
  email: string;
  password: string;
  role: "admin" | "coordinador" | "trabajador" | "auditor";
  displayName: string;
  workerId?: string | null;
  facilityIds?: string[];
  existing?: "fail" | "update" | "promote";
}) {
  const sb = adminClient();
  const { data: list, error: listError } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  let user = list.users.find((u) => u.email?.toLowerCase() === opts.email.toLowerCase());
  const existing = opts.existing ?? "fail";
  if (user && existing === "fail") {
    throw new Error(`Ya existe una cuenta con el correo ${opts.email}. No se modificó.`);
  }
  if (user && existing === "promote") {
    const { error } = await sb.auth.admin.updateUserById(user.id, { password: opts.password, app_metadata: { role: opts.role } });
    if (error) throw error;
    const { error: profileError } = await sb.from("profiles").update({ role: opts.role, active: true }).eq("id", user.id);
    if (profileError) throw profileError;
    return user.id;
  }
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
