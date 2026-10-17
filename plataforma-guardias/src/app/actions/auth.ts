"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { homePathFor, type AppRole } from "@/lib/auth";
import { safeNextPath } from "@/lib/security/safe-next";
import { clientIp, loginFailed, loginKeys, loginRetryAfter, loginSucceeded } from "@/lib/security/rate-limit";

export type LoginState = { ok: boolean; message?: string };

export async function login(_prev: LoginState | null, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { ok: false, message: "Escribe tu correo y contraseña." };
  }
  const keys = loginKeys(clientIp(await headers()), email);
  const wait = loginRetryAfter(keys);
  if (wait > 0) {
    return { ok: false, message: `Demasiados intentos fallidos. Espera ${Math.ceil(wait / 60_000)} min e inténtalo de nuevo.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error?.status === 429) {
    return { ok: false, message: "El servicio de acceso recibió demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo." };
  }
  if (error || !data.user) {
    loginFailed(keys);
    return { ok: false, message: "Correo o contraseña incorrectos." };
  }
  loginSucceeded(keys);
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    return { ok: false, message: "Tu cuenta no está activa. Contacta a administración." };
  }
  redirect(safeNextPath(formData.get("next")) ?? homePathFor(profile.role as AppRole));
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
