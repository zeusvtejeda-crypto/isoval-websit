"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageFacility, requireManager } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { clearStoredReason } from "@/lib/reason";
import { buildShiftTimes, resolveEditedSchedule } from "@/lib/shifts/dates";
import { countAssignments, countValidSessions, getShiftContext } from "@/lib/shifts/queries";
import { FACILITY_LOCKED_NOTICE, SCHEDULE_LOCKED_NOTICE, isScheduleLocked } from "@/lib/shifts/rules";
import { SHIFT_FORM_FIELDS, invalidResult, readForm, shiftFormSchema, shiftStatusSchema } from "@/lib/shifts/schemas";

/** Alta o edición de una guardia. Al guardar redirige al detalle. */
/** Mensaje de la BD (guard_protected_columns) para guardias en las que uno está asignado. */
const OWN_SHIFT_MESSAGE =
  "No puedes cancelar, finalizar ni reprogramar una guardia en la que estás asignado. Pide a otra persona de coordinación o a administración.";

/** ¿La persona usuaria (como trabajadora) está asignada a la guardia? Administración queda exenta. */
async function isOwnShiftLocked(supabase: Awaited<ReturnType<typeof createClient>>, user: { isAdmin: boolean; workerId: string | null }, shiftId: string) {
  if (user.isAdmin || !user.workerId) return false;
  const { count } = await supabase
    .from("shift_assignments")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId)
    .eq("worker_id", user.workerId);
  return (count ?? 0) > 0;
}

export async function saveShift(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireManager();
  const parsed = shiftFormSchema.safeParse(readForm(formData, SHIFT_FORM_FIELDS));
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;

  if (!canManageFacility(user, v.facility_id)) {
    return { ok: false, message: "No puedes programar guardias en esa sede." };
  }

  const supabase = await createClient();
  const { data: facility, error: facilityError } = await supabase
    .from("facilities")
    .select("id, timezone, active")
    .eq("id", v.facility_id)
    .maybeSingle();
  if (facilityError) return { ok: false, message: friendlyDbError(facilityError) };
  if (!facility) return { ok: false, message: "La sede no existe o no está disponible.", fieldErrors: { facility_id: "Sede no disponible." } };

  // Edición: la guardia debe existir, ser visible y gestionable.
  const current = v.id ? await getShiftContext(supabase, v.id) : null;
  let existingResponsible: string | null = null;
  let facilityChanged = false;
  if (v.id) {
    if (!current) return { ok: false, message: "La guardia no existe o no tienes acceso." };
    if (!canManageFacility(user, current.shift.facility_id)) {
      return { ok: false, message: "No puedes editar guardias de esa sede." };
    }
    if (current.shift.facility_id !== v.facility_id) {
      facilityChanged = true;
      if (!facility.active) return { ok: false, message: "La sede elegida no está activa." };
      // La BD también lo impide (guard_protected_columns).
      const assigned = await countAssignments(supabase, v.id);
      if (assigned > 0) {
        return { ok: false, message: FACILITY_LOCKED_NOTICE, fieldErrors: { facility_id: "La guardia ya tiene asignaciones." } };
      }
    }
    const { data: row } = await supabase.from("shifts").select("responsible_worker_id").eq("id", v.id).maybeSingle();
    existingResponsible = row?.responsible_worker_id ?? null;
  } else if (!facility.active) {
    return { ok: false, message: "La sede no está activa." };
  }

  let startsAt: Date;
  let endsAt: Date;
  try {
    if (current) {
      // Sin cambios en fecha y horas se conserva el horario guardado.
      const schedule = resolveEditedSchedule(current.shift, v, current.timezone, facility.timezone);
      if (schedule.changed && !user.isAdmin && isScheduleLocked(user, await countValidSessions(supabase, current.shift.id))) {
        // La BD también lo impide (guard_protected_columns).
        return { ok: false, message: SCHEDULE_LOCKED_NOTICE, fieldErrors: { date: "Conserva la fecha y las horas guardadas." } };
      }
      if (schedule.changed && (await isOwnShiftLocked(supabase, user, current.shift.id))) {
        return { ok: false, message: OWN_SHIFT_MESSAGE, fieldErrors: { date: "Conserva la fecha y las horas guardadas." } };
      }
      ({ startsAt, endsAt } = schedule);
    } else {
      ({ startsAt, endsAt } = buildShiftTimes(v.date, v.start_time, v.end_time, facility.timezone));
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Fecha u hora inválidas." };
  }

  // Responsable: trabajador activo de la sede (se respeta el actual si no cambió
  // ni cambió la sede; al cambiar de sede se vuelve a validar).
  const responsible = v.responsible_worker_id ?? null;
  if (responsible && (responsible !== existingResponsible || facilityChanged)) {
    const { data: worker, error: workerError } = await supabase
      .from("workers")
      .select("id, active, facility_id")
      .eq("id", responsible)
      .maybeSingle();
    if (workerError) return { ok: false, message: friendlyDbError(workerError) };
    if (!worker || !worker.active || worker.facility_id !== v.facility_id) {
      return {
        ok: false,
        message: "El responsable debe ser un trabajador activo de la sede.",
        fieldErrors: { responsible_worker_id: "Elige un trabajador activo de la sede." },
      };
    }
  }

  const values = {
    facility_id: v.facility_id,
    title: v.title ?? null,
    meeting_point: v.meeting_point,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    responsible_worker_id: responsible,
    min_staff: v.min_staff,
    max_staff: v.max_staff ?? null,
    instructions: v.instructions ?? null,
  };

  let shiftId: string;
  if (v.id) {
    // Un motivo igual al guardado se perdería en la bitácora: se limpia antes.
    const cleared = await clearStoredReason(supabase, "shifts", v.id);
    if (cleared) return { ok: false, message: friendlyDbError(cleared, "No se pudo guardar la guardia.") };
    const { error } = await supabase
      .from("shifts")
      .update({ ...values, change_reason: v.change_reason ?? null })
      .eq("id", v.id);
    if (error) return { ok: false, message: friendlyDbError(error, "No se pudo guardar la guardia.") };
    shiftId = v.id;
  } else {
    const { data, error } = await supabase
      .from("shifts")
      .insert({ ...values, change_reason: v.change_reason ?? "Alta de guardia" })
      .select("id")
      .single();
    if (error || !data) return { ok: false, message: friendlyDbError(error, "No se pudo crear la guardia.") };
    shiftId = data.id;
  }

  revalidatePath("/guardias");
  revalidatePath(`/guardias/${shiftId}`);
  redirect(`/guardias/${shiftId}`);
}

/** Cancelar (motivo obligatorio), finalizar manualmente o reactivar una guardia. */
export async function setShiftStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const parsed = shiftStatusSchema.safeParse(readForm(formData, ["shift_id", "status", "reason"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const { shift_id, status, reason } = parsed.data;

  const supabase = await createClient();
  const ctx = await getShiftContext(supabase, shift_id);
  if (!ctx) return { ok: false, message: "La guardia no existe o no tienes acceso." };
  if (!canManageFacility(user, ctx.shift.facility_id)) {
    return { ok: false, message: "No puedes modificar guardias de esa sede." };
  }
  if (ctx.shift.status === status) {
    return { ok: false, message: "La guardia ya tiene ese estado." };
  }
  if (await isOwnShiftLocked(supabase, user, shift_id)) {
    return { ok: false, message: OWN_SHIFT_MESSAGE };
  }
  if (status === "cancelada" && (await countValidSessions(supabase, shift_id)) > 0 && !user.isAdmin) {
    return { ok: false, message: "La guardia tiene registros de asistencia vigentes; corrígelos o anúlalos antes de cancelarla." };
  }
  if (status === "finalizada" && ctx.shift.status === "cancelada") {
    return { ok: false, message: "La guardia está cancelada. Reactívala antes de marcarla como finalizada." };
  }
  if (status === "finalizada" && Date.now() < Date.parse(ctx.shift.starts_at)) {
    return { ok: false, message: "Solo puedes finalizar manualmente una guardia que ya inició." };
  }

  const update =
    status === "cancelada"
      ? { status, cancel_reason: reason, change_reason: reason }
      : { status, cancel_reason: null, change_reason: reason };
  const cleared = await clearStoredReason(supabase, "shifts", shift_id);
  if (cleared) return { ok: false, message: friendlyDbError(cleared, "No se pudo cambiar el estado de la guardia.") };
  const { error } = await supabase.from("shifts").update(update).eq("id", shift_id);
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo cambiar el estado de la guardia.") };

  revalidatePath("/guardias");
  revalidatePath(`/guardias/${shift_id}`);
  const messages = {
    cancelada: "Guardia cancelada.",
    finalizada: "Guardia marcada como finalizada.",
    programada: "Guardia reactivada: su estado se calcula según el horario.",
  } as const;
  return { ok: true, message: messages[status] };
}
