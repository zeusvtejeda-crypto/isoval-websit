"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions";

const schema = z
  .object({
    current: z.string().min(1, "Escribe tu contraseña actual."),
    password: z.string().min(12, "La nueva contraseña debe tener al menos 12 caracteres.").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Las contraseñas no coinciden.", path: ["confirm"] })
  .refine((v) => v.password !== v.current, { message: "La nueva contraseña debe ser distinta de la actual.", path: ["password"] });

export async function changePassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    current: formData.get("current") ?? "",
    password: formData.get("password") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors };
  }
  if (!user.email) return { ok: false, message: "Tu cuenta no tiene correo asociado. Contacta a administración." };

  const supabase = await createClient();
  // Confirma la contraseña actual antes de cambiarla.
  const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: parsed.data.current });
  if (authError) return { ok: false, message: "La contraseña actual no es correcta.", fieldErrors: { current: "Contraseña incorrecta." } };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: "No se pudo cambiar la contraseña. Inténtalo de nuevo." };
  return { ok: true, message: "Contraseña actualizada." };
}
