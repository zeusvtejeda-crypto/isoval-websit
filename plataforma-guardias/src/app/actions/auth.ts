"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homePathFor, type AppRole } from "@/lib/auth";

export type LoginState = { ok: boolean; message?: string };

function safeNext(next: FormDataEntryValue | null): string | null {
  const value = typeof next === "string" ? next : "";
  // Solo rutas internas (evita redirecciones abiertas).
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : null;
}

export async function login(_prev: LoginState | null, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { ok: false, message: "Escribe tu correo y contraseña." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { ok: false, message: "Correo o contraseña incorrectos." };
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
  redirect(safeNext(formData.get("next")) ?? homePathFor(profile.role as AppRole));
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
