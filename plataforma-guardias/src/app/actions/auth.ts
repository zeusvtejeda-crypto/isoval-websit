"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { homePathFor, type AppRole } from "@/lib/auth";
import { safeNextPath } from "@/lib/security/safe-next";
import { clientIp, loginKeys } from "@/lib/security/rate-limit";
import { isAuthServiceError, recordLoginFailure, recordLoginSuccess, refundLoginAttempt, reserveLoginAttempt } from "@/lib/security/shared-limits";
import { TRUSTED_DEVICE_COOKIE, TRUSTED_DEVICE_MAX_AGE, isTrustedDevice, trustedDeviceToken } from "@/lib/security/trusted-device";
import { captchaTokenFrom } from "@/lib/security/captcha";

export type LoginState = { ok: boolean; message?: string };

/** Tiempo mínimo de una respuesta fallida: no revela si el correo tiene cuenta. */
const MIN_FAILURE_MS = 450;

async function atLeast<T>(started: number, value: T): Promise<T> {
  const left = MIN_FAILURE_MS - (Date.now() - started);
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
  return value;
}

export async function login(_prev: LoginState | null, formData: FormData): Promise<LoginState> {
  const started = Date.now();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { ok: false, message: "Escribe tu correo y contraseña." };
  }
  // Un correo no supera 254 caracteres: así nadie usa claves enormes para llenar la memoria.
  if (email.length > 254 || password.length > 1024) {
    return atLeast(started, { ok: false, message: "Correo o contraseña incorrectos." });
  }
  const cookieStore = await cookies();
  const trustedDevice = isTrustedDevice(cookieStore.get(TRUSTED_DEVICE_COOKIE)?.value, email);
  const keys = loginKeys(clientIp(await headers()), email);
  const wait = await reserveLoginAttempt(keys, trustedDevice);
  if (wait > 0) {
    return atLeast(started, { ok: false, message: `Demasiados intentos fallidos. Espera ${Math.ceil(wait / 60_000)} min e inténtalo de nuevo.` });
  }

  const supabase = await createClient();
  const captchaToken = captchaTokenFrom(formData);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : undefined });
  if (error?.code === "captcha_failed") {
    await refundLoginAttempt(keys, trustedDevice);
    return atLeast(started, { ok: false, message: "Completa la verificación anti-robots e inténtalo de nuevo." });
  }
  if (isAuthServiceError(error)) {
    // No se llegó a verificar la contraseña: el intento no cuenta.
    await refundLoginAttempt(keys, trustedDevice);
    return error?.status === 429
      ? { ok: false, message: "El servicio de acceso recibió demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo." }
      : { ok: false, message: "No se pudo conectar con el servicio de acceso. Inténtalo de nuevo en unos minutos." };
  }
  if (error || !data.user) {
    await recordLoginFailure(keys);
    return atLeast(started, { ok: false, message: "Correo o contraseña incorrectos." });
  }
  await recordLoginSuccess(keys);
  const deviceToken = trustedDeviceToken(email);
  if (deviceToken) {
    cookieStore.set(TRUSTED_DEVICE_COOKIE, deviceToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: TRUSTED_DEVICE_MAX_AGE,
    });
  }
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
