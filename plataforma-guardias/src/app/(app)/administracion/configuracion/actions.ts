"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { failure, fieldFailure, friendlyAdminError, invalidResult } from "@/lib/admin/form";
import {
  SETTINGS_PATH,
  SETTING_KEYS,
  attendanceSettingsFormSchema,
  describeAppliedRetention,
  describeDemoCounts,
  isConfirmed,
  parseDemoPurgeResult,
  parseRetentionImpact,
  privacyNoticeFormSchema,
  readAttendanceSettingsForm,
  readPrivacyNoticeForm,
  readRetentionForm,
  retentionFormSchema,
  splitReason,
  type DemoCounts,
  type RetentionImpact,
} from "@/lib/admin/settings";
import { saveSettingValue } from "@/lib/admin/settings-server";

/** (a) Aviso de privacidad. */
export async function savePrivacyNotice(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = privacyNoticeFormSchema.safeParse(readPrivacyNoticeForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const { reason, value } = splitReason(parsed.data);
  const supabase = await createClient();
  const error = await saveSettingValue(supabase, SETTING_KEYS.privacy, value, reason);
  if (error) return failure(friendlyAdminError(error, "No se pudo guardar el aviso de privacidad."));
  revalidatePath(SETTINGS_PATH);
  revalidatePath("/aviso-de-privacidad");
  return {
    ok: true,
    message:
      parsed.data.legal_review_status === "aprobado"
        ? "Aviso de privacidad guardado y marcado como aprobado por revisión jurídica."
        : "Aviso de privacidad guardado. Sigue marcado como pendiente de revisión jurídica.",
  };
}

/** (b) Periodos de conservación (meses). */
export async function saveRetention(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = retentionFormSchema.safeParse(readRetentionForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const { reason, value } = splitReason(parsed.data);
  const supabase = await createClient();
  const error = await saveSettingValue(supabase, SETTING_KEYS.retention, value, reason);
  if (error) return failure(friendlyAdminError(error, "No se pudieron guardar los periodos de conservación."));
  revalidatePath(SETTINGS_PATH);
  return { ok: true, message: "Periodos de conservación guardados. No se eliminó nada: usa «Calcular impacto» y «Aplicar ahora»." };
}

/** Cálculo sin eliminar (apply_retention_policy con p_execute = false). */
export async function previewRetention(): Promise<ActionResult<RetentionImpact>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_retention_policy", { p_execute: false });
  if (error) return failure(friendlyDbError(error, "No se pudo calcular el impacto."));
  const impact = parseRetentionImpact(data);
  if (!impact) return failure("La respuesta del cálculo no es válida.");
  return { ok: true, message: "Cálculo realizado. No se eliminó ningún dato.", data: impact };
}

/** Aplicación definitiva (p_execute = true). Requiere confirmación explícita. */
export async function applyRetention(_prev: ActionResult<RetentionImpact> | null, formData: FormData): Promise<ActionResult<RetentionImpact>> {
  await requireAdmin();
  if (!isConfirmed(formData)) {
    return fieldFailure("confirm", "Marca la casilla para confirmar que entiendes que la eliminación es irreversible.");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_retention_policy", { p_execute: true });
  if (error) return failure(friendlyDbError(error, "No se pudo aplicar la política de conservación."));
  const impact = parseRetentionImpact(data);
  if (!impact) return failure("La respuesta de la operación no es válida; revisa la bitácora.");
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: describeAppliedRetention(impact),
    data: impact,
  };
}

/** (c) Ventana de registro y margen para entradas abiertas. */
export async function saveAttendanceSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = attendanceSettingsFormSchema.safeParse(readAttendanceSettingsForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const { reason, value } = splitReason(parsed.data);
  const supabase = await createClient();
  const error = await saveSettingValue(supabase, SETTING_KEYS.attendance, value, reason);
  if (error) return failure(friendlyAdminError(error, "No se pudo guardar la configuración de registro."));
  revalidatePath("/", "layout");
  return { ok: true, message: "Configuración de registro de asistencia guardada. Aplica a los siguientes registros." };
}

/** (d) Eliminación de datos de demostración (is_demo = true). */
export async function purgeDemoData(_prev: ActionResult<DemoCounts> | null, formData: FormData): Promise<ActionResult<DemoCounts>> {
  await requireAdmin();
  if (!isConfirmed(formData)) {
    return fieldFailure("confirm", "Marca la casilla para confirmar que quieres eliminar los datos de demostración.");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purge_demo_data");
  if (error) return failure(friendlyDbError(error, "No se pudieron eliminar los datos de demostración."));
  const result = parseDemoPurgeResult(data);
  revalidatePath("/", "layout");
  return { ok: true, message: `Datos de demostración eliminados: ${describeDemoCounts(result)}.`, data: result };
}
