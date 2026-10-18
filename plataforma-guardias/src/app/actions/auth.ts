"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { homePathFor, type AppRole } from "@/lib/auth";
import { safeNextPath } from "@/lib/security/safe-next";
import { clientIp, loginKeys } from "@/lib/security/rate-limit";
import { isAuthServiceError, recordLoginFailure, recordLoginSuccess, refundLoginAttempt, reserveLoginAttempt } from "@/lib/security/shared-limits";

export type LoginState = { ok: boolean; message?: string };

export async function login(_prev: LoginState | null, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { ok: false, message: "Escribe tu correo y contraseña." };
  }
  // Un correo no supera 254 caracteres: así nadie usa claves enormes para llenar la memoria.
  if (email.length > 254 || password.length > 1024) {
    return { ok: false, message: "Correo o contraseña incorrectos." };
  }
  const keys = loginKeys(clientIp(await headers()), email);
  const wait = await reserveLoginAttempt(keys);
  if (wait > 0) {
    return { ok: false, message: `Demasiados intentos fallidos. Espera ${Math.ceil(wait / 60_000)} min e inténtalo de nuevo.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (isAuthServiceError(error)) {
    // No se llegó a verificar la contraseña: el intento no cuenta.
    await refundLoginAttempt(keys);
    return error?.status === 429
      ? { ok: false, message: "El servicio de acceso recibió demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo." }
      : { ok: false, message: "No se pudo conectar con el servicio de acceso. Inténtalo de nuevo en unos minutos." };
  }
  if (error || !data.user) {
    await recordLoginFailure(keys);
    return { ok: false, message: "Correo o contraseña incorrectos." };
  }
  await recordLoginSuccess(keys);
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
