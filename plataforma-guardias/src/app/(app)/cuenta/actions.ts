"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions";
import { isAuthServiceError, recordPasswordChangeSuccess, refundPasswordChange, reservePasswordChange } from "@/lib/security/shared-limits";

const schema = z
  .object({
    current: z.string().min(1, "Escribe tu contraseña actual."),
    password: z
      .string()
      .min(12, "La nueva contraseña debe tener al menos 12 caracteres.")
      .max(72, "La contraseña no puede superar 72 caracteres.")
      .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), "Incluye minúsculas, mayúsculas y al menos un número."),
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

  const wait = await reservePasswordChange(user.id);
  if (wait > 0) {
    return { ok: false, message: `Demasiados intentos con la contraseña actual. Espera ${Math.ceil(wait / 60_000)} min e inténtalo de nuevo.` };
  }

  const supabase = await createClient();
  // Confirma la contraseña actual antes de cambiarla.
  const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: parsed.data.current });
  if (isAuthServiceError(authError)) {
    await refundPasswordChange(user.id);
    return { ok: false, message: "No se pudo conectar con el servicio de acceso. Inténtalo de nuevo en unos minutos." };
  }
  if (authError) {
    // El intento ya quedó contado al reservarlo.
    return { ok: false, message: "La contraseña actual no es correcta.", fieldErrors: { current: "Contraseña incorrecta." } };
  }
  await recordPasswordChangeSuccess(user.id);

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error?.code === "weak_password") return { ok: false, message: "La contraseña no cumple la política de seguridad: usa al menos 12 caracteres con minúsculas, mayúsculas y números." };
  if (error) return { ok: false, message: "No se pudo cambiar la contraseña. Inténtalo de nuevo." };
  return { ok: true, message: "Contraseña actualizada." };
}
