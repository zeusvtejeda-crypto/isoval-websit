"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageFacility, requireManager } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { buildShiftTimes } from "@/lib/shifts/dates";
import { countAssignments, getShiftContext } from "@/lib/shifts/queries";
import { SHIFT_FORM_FIELDS, invalidResult, readForm, shiftFormSchema, shiftStatusSchema } from "@/lib/shifts/schemas";

/** Alta o edición de una guardia. Al guardar redirige al detalle. */
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

  let times: ReturnType<typeof buildShiftTimes>;
  try {
    times = buildShiftTimes(v.date, v.start_time, v.end_time, facility.timezone);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Fecha u hora inválidas." };
  }

  // Edición: la guardia debe existir, ser visible y gestionable.
  let existingResponsible: string | null = null;
  if (v.id) {
    const current = await getShiftContext(supabase, v.id);
    if (!current) return { ok: false, message: "La guardia no existe o no tienes acceso." };
    if (!canManageFacility(user, current.shift.facility_id)) {
      return { ok: false, message: "No puedes editar guardias de esa sede." };
    }
    if (current.shift.facility_id !== v.facility_id) {
      if (!facility.active) return { ok: false, message: "La sede elegida no está activa." };
      const assigned = await countAssignments(supabase, v.id);
      if (assigned > 0) {
        return {
          ok: false,
          message: "No se puede cambiar la sede de una guardia que ya tiene asignaciones. Crea una guardia nueva en la otra sede.",
          fieldErrors: { facility_id: "La guardia ya tiene asignaciones." },
        };
      }
    }
    const { data: row } = await supabase.from("shifts").select("responsible_worker_id").eq("id", v.id).maybeSingle();
    existingResponsible = row?.responsible_worker_id ?? null;
  } else if (!facility.active) {
    return { ok: false, message: "La sede no está activa." };
  }

  // Responsable: trabajador activo de la sede (se respeta el actual si no cambió).
  const responsible = v.responsible_worker_id ?? null;
  if (responsible && responsible !== existingResponsible) {
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
    starts_at: times.startsAt.toISOString(),
    ends_at: times.endsAt.toISOString(),
    responsible_worker_id: responsible,
    min_staff: v.min_staff,
    max_staff: v.max_staff ?? null,
    instructions: v.instructions ?? null,
  };

  let shiftId: string;
  if (v.id) {
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
  if (status === "finalizada" && Date.now() < Date.parse(ctx.shift.starts_at)) {
    return { ok: false, message: "Solo puedes finalizar manualmente una guardia que ya inició." };
  }

  const update =
    status === "cancelada"
      ? { status, cancel_reason: reason, change_reason: reason }
      : { status, cancel_reason: null, change_reason: reason };
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
