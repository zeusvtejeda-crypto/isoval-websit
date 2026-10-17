"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, type SessionUser } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/actions";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import {
  USERS_BASE_PATH,
  accountStatusSchema,
  changedAccountFields,
  createAccountSchema,
  joinSpanish,
  readAccountStatusForm,
  readCreateAccountForm,
  readResetPasswordForm,
  readUpdateAccountForm,
  reasonRequired,
  resetPasswordSchema,
  roleUsesFacilityScopes,
  scopeChanges,
  updateAccountSchema,
} from "@/lib/admin/accounts";
import { getAuthAdmin } from "@/lib/admin/accounts-server";
import { failure, fieldFailure, friendlyAdminError, friendlyAuthError, invalidResult } from "@/lib/admin/form";
import { generateTemporaryPassword } from "@/lib/admin/password";

/** Duración del bloqueo en Auth al desactivar (≈ 100 años). */
const BAN_DURATION = "876000h";

export type CreatedAccount = { userId: string; email: string; generatedPassword: string | null };
export type PasswordResetResult = { generatedPassword: string | null };

function revalidateAccounts(userId?: string) {
  revalidatePath(USERS_BASE_PATH);
  if (userId) revalidatePath(`${USERS_BASE_PATH}/${userId}`);
}

/** El trabajador existe, está activo y no tiene otra cuenta. */
async function checkWorker(supabase: ServerSupabase, workerId: string, accountId?: string): Promise<string | null> {
  const { data: worker, error } = await supabase.from("workers").select("id, active").eq("id", workerId).maybeSingle();
  if (error) return friendlyDbError(error, "No se pudo comprobar el trabajador.");
  if (!worker) return "El trabajador no existe o no tienes acceso a él.";
  if (!worker.active) return "El trabajador está inactivo; reactívalo antes de vincularlo.";
  let q = supabase.from("profiles").select("id").eq("worker_id", workerId);
  if (accountId) q = q.neq("id", accountId);
  const { data: linked, error: linkedError } = await q.limit(1);
  if (linkedError) return friendlyDbError(linkedError, "No se pudo comprobar el trabajador.");
  if (linked && linked.length > 0) return "Ese trabajador ya tiene una cuenta de acceso.";
  return null;
}

async function checkFacilities(supabase: ServerSupabase, ids: readonly string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const { data, error } = await supabase.from("facilities").select("id").in("id", [...ids]);
  if (error) return friendlyDbError(error, "No se pudieron comprobar las sedes.");
  if ((data ?? []).length !== new Set(ids).size) return "Alguna sede seleccionada ya no existe. Recarga la página.";
  return null;
}

async function syncScopes(supabase: ServerSupabase, userId: string, next: readonly string[]): Promise<string | null> {
  const { data, error } = await supabase.from("user_facility_scopes").select("facility_id").eq("user_id", userId);
  if (error) return friendlyDbError(error, "No se pudieron leer las sedes asignadas.");
  const { add, remove } = scopeChanges((data ?? []).map((s) => s.facility_id), next);
  if (remove.length) {
    const { error: delError } = await supabase.from("user_facility_scopes").delete().eq("user_id", userId).in("facility_id", remove);
    if (delError) return friendlyDbError(delError, "No se pudieron quitar sedes asignadas.");
  }
  if (add.length) {
    const { error: insError } = await supabase.from("user_facility_scopes").insert(add.map((facility_id) => ({ user_id: userId, facility_id })));
    if (insError) return friendlyDbError(insError, "No se pudieron asignar las sedes.");
  }
  return null;
}

async function currentProfile(supabase: ServerSupabase, userId: string) {
  return supabase.from("profiles").select("id, role, active, display_name, worker_id").eq("id", userId).maybeSingle();
}

/**
 * Alta de cuenta: Auth crea el usuario (el trigger crea el perfil con el rol
 * de app_metadata) y después, con el cliente RLS de administración, se
 * ajustan el perfil y las sedes. Si algo falla, se elimina el usuario creado.
 */
export async function createAccount(_prev: ActionResult<CreatedAccount> | null, formData: FormData): Promise<ActionResult<CreatedAccount>> {
  const actor = await requireAdmin();
  const parsed = createAccountSchema.safeParse(readCreateAccountForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();

  if (v.worker_id) {
    const workerIssue = await checkWorker(supabase, v.worker_id);
    if (workerIssue) return fieldFailure("worker_id", workerIssue);
  }
  const facilityIssue = await checkFacilities(supabase, v.facility_ids);
  if (facilityIssue) return fieldFailure("facility_ids", facilityIssue);

  const admin = getAuthAdmin(actor);
  if (!admin.ok) return failure(admin.message);

  const password = v.password_mode === "generar" ? generateTemporaryPassword() : (v.password ?? "");
  const { data: created, error: createError } = await admin.api.createUser({
    email: v.email,
    password,
    email_confirm: true,
    app_metadata: { role: v.role, worker_id: v.worker_id ?? null },
    user_metadata: { display_name: v.display_name },
  });
  if (createError || !created?.user) {
    const message = friendlyAuthError(createError, "No se pudo crear la cuenta.");
    return message === "Ya existe una cuenta con ese correo." ? fieldFailure("email", message) : failure(message);
  }
  const userId = created.user.id;

  const rollback = async (message: string): Promise<ActionResult<CreatedAccount>> => {
    const { error } = await admin.api.deleteUser(userId);
    return failure(
      error
        ? `${message} La cuenta quedó creada de forma incompleta en el sistema de acceso; revísala en la lista y desactívala si es necesario.`
        : `${message} No se creó la cuenta.`,
    );
  };

  const { data: updated, error: profileError } = await supabase
    .from("profiles")
    .update({ role: v.role, display_name: v.display_name, worker_id: v.worker_id ?? null, change_reason: "Alta de cuenta de acceso" })
    .eq("id", userId)
    .select("id");
  if (profileError) return rollback(friendlyAdminError(profileError, "No se pudo registrar el perfil de la cuenta."));
  if (!updated || updated.length === 0) return rollback("No se encontró el perfil creado para la cuenta.");

  if (roleUsesFacilityScopes(v.role) && v.facility_ids.length) {
    const scopeIssue = await syncScopes(supabase, userId, v.facility_ids);
    if (scopeIssue) return rollback(scopeIssue);
  }

  revalidateAccounts();
  return {
    ok: true,
    message: `Cuenta creada para ${v.email}.`,
    data: { userId, email: v.email, generatedPassword: v.password_mode === "generar" ? password : null },
  };
}

/** Edición: nombre, rol, trabajador vinculado y sedes. Motivo obligatorio si cambia el rol. */
export async function updateAccount(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor: SessionUser = await requireAdmin();
  const parsed = updateAccountSchema.safeParse(readUpdateAccountForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();

  const { data: current, error: readError } = await currentProfile(supabase, v.user_id);
  if (readError) return failure(friendlyDbError(readError, "No se pudo leer la cuenta."));
  if (!current) return failure("La cuenta no existe o fue eliminada.");

  if (current.id === actor.id && v.role !== current.role) {
    return fieldFailure("role", "No puedes cambiar tu propio rol. Pide a otra persona con rol de administración que lo haga.");
  }
  if (reasonRequired(current, { role: v.role, active: current.active }) && !v.reason) {
    return fieldFailure("reason", "Indica el motivo del cambio de rol (mínimo 5 caracteres).");
  }

  const nextWorker = v.worker_id ?? null;
  if (nextWorker && nextWorker !== current.worker_id) {
    const workerIssue = await checkWorker(supabase, nextWorker, current.id);
    if (workerIssue) return fieldFailure("worker_id", workerIssue);
  }
  const facilityIssue = await checkFacilities(supabase, v.facility_ids);
  if (facilityIssue) return fieldFailure("facility_ids", facilityIssue);

  const { data: scopeRows, error: scopeReadError } = await supabase.from("user_facility_scopes").select("facility_id").eq("user_id", v.user_id);
  if (scopeReadError) return failure(friendlyDbError(scopeReadError, "No se pudieron leer las sedes asignadas."));
  const changes = changedAccountFields(
    { display_name: current.display_name, role: current.role, worker_id: current.worker_id, facility_ids: (scopeRows ?? []).map((s) => s.facility_id) },
    { display_name: v.display_name, role: v.role, worker_id: nextWorker, facility_ids: v.facility_ids },
  );
  if (changes.length === 0) return { ok: true, message: "No hubo cambios que guardar." };

  const profileChanged = changes.some((c) => c !== "sedes asignadas");
  if (profileChanged) {
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ display_name: v.display_name, role: v.role, worker_id: nextWorker, change_reason: v.reason ?? null })
      .eq("id", v.user_id)
      .select("id");
    if (error) return failure(friendlyAdminError(error, "No se pudo guardar la cuenta."));
    if (!updated || updated.length === 0) return failure("No tienes permiso para modificar esta cuenta.");
  }

  const scopeIssue = await syncScopes(supabase, v.user_id, v.facility_ids);
  if (scopeIssue) {
    revalidateAccounts(v.user_id);
    return failure(profileChanged ? `Se guardaron los datos de la cuenta, pero no las sedes: ${scopeIssue}` : scopeIssue);
  }

  // Metadatos de Auth (solo informativos: la autorización usa profiles).
  let warning = "";
  if (profileChanged) {
    const admin = getAuthAdmin(actor);
    const { error } = admin.ok
      ? await admin.api.updateUserById(v.user_id, {
          app_metadata: { role: v.role, worker_id: nextWorker },
          user_metadata: { display_name: v.display_name },
        })
      : { error: { message: admin.message } };
    if (error) warning = " (No se pudieron sincronizar los metadatos del sistema de acceso; los permisos sí se aplicaron.)";
  }

  revalidateAccounts(v.user_id);
  return { ok: true, message: `Cambios guardados: ${joinSpanish(changes)}.${warning}` };
}

/**
 * Desactivar: profiles.active = false y bloqueo del inicio de sesión en Auth.
 * Reactivar: profiles.active = true y desbloqueo. Motivo obligatorio.
 */
export async function setAccountActive(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = accountStatusSchema.safeParse(readAccountStatusForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const { user_id, active, reason } = parsed.data;
  if (user_id === actor.id && !active) return failure("No puedes desactivar tu propia cuenta.");

  const admin = getAuthAdmin(actor);
  if (!admin.ok) return failure(admin.message);

  const supabase = await createClient();
  const { data: current, error: readError } = await currentProfile(supabase, user_id);
  if (readError) return failure(friendlyDbError(readError, "No se pudo leer la cuenta."));
  if (!current) return failure("La cuenta no existe o fue eliminada.");

  if (current.active !== active) {
    const { data: updated, error } = await supabase.from("profiles").update({ active, change_reason: reason }).eq("id", user_id).select("id");
    if (error) return failure(friendlyAdminError(error, "No se pudo cambiar el estado de la cuenta."));
    if (!updated || updated.length === 0) return failure("No tienes permiso para modificar esta cuenta.");
  }

  const { error: banError } = await admin.api.updateUserById(user_id, { ban_duration: active ? "none" : BAN_DURATION });
  revalidateAccounts(user_id);
  if (banError) {
    const detail = friendlyAuthError(banError);
    return failure(
      active
        ? `La cuenta se marcó como activa, pero el inicio de sesión sigue bloqueado en el sistema de acceso (${detail}). Vuelve a intentarlo.`
        : `La cuenta quedó inactiva en la plataforma y ya no puede usarse, pero no se pudo bloquear el inicio de sesión en el sistema de acceso (${detail}). Vuelve a intentarlo.`,
    );
  }
  return {
    ok: true,
    message: active ? "Cuenta reactivada. La persona puede volver a iniciar sesión." : "Cuenta desactivada. Ya no puede iniciar sesión.",
  };
}

/** Restablece una contraseña temporal (capturada o generada; la generada se muestra una vez). */
export async function resetAccountPassword(
  _prev: ActionResult<PasswordResetResult> | null,
  formData: FormData,
): Promise<ActionResult<PasswordResetResult>> {
  const actor = await requireAdmin();
  const parsed = resetPasswordSchema.safeParse(readResetPasswordForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: current, error: readError } = await currentProfile(supabase, v.user_id);
  if (readError) return failure(friendlyDbError(readError, "No se pudo leer la cuenta."));
  if (!current) return failure("La cuenta no existe o fue eliminada.");

  const admin = getAuthAdmin(actor);
  if (!admin.ok) return failure(admin.message);

  const password = v.password_mode === "generar" ? generateTemporaryPassword() : (v.password ?? "");
  const { error } = await admin.api.updateUserById(v.user_id, { password });
  if (error) return failure(friendlyAuthError(error, "No se pudo restablecer la contraseña."));

  return {
    ok: true,
    message: current.active
      ? "Contraseña temporal restablecida."
      : "Contraseña temporal restablecida. La cuenta sigue inactiva: reactívala para que pueda iniciar sesión.",
    data: { generatedPassword: v.password_mode === "generar" ? password : null },
  };
}
