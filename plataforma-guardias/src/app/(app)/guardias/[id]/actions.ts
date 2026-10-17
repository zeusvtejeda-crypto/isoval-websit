"use server";

import { revalidatePath } from "next/cache";
import { canManageFacility, requireManager, type SessionUser } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { localInputToUtc } from "@/lib/time";
import { getAssignmentContext, getSessionContext, getShiftContext, type ShiftContext } from "@/lib/shifts/queries";
import {
  addAssignmentSchema,
  assignmentStatusSchema,
  correctSessionSchema,
  incidentNoteSchema,
  invalidResult,
  manualSessionSchema,
  readForm,
  removeAssignmentSchema,
  voidSessionSchema,
} from "@/lib/shifts/schemas";

const NO_ACCESS: ActionResult = { ok: false, message: "No tienes permiso para modificar guardias de esta sede." };

function revalidateShift(shiftId: string) {
  revalidatePath("/guardias");
  revalidatePath(`/guardias/${shiftId}`);
}

function ensureManage(user: SessionUser, ctx: ShiftContext | null): ActionResult | null {
  if (!ctx) return { ok: false, message: "La guardia o el registro no existe, o no tienes acceso." };
  if (!canManageFacility(user, ctx.shift.facility_id)) return NO_ACCESS;
  return null;
}

/** Agregar una persona a la guardia. */
export async function addAssignment(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const parsed = addAssignmentSchema.safeParse(
    readForm(formData, ["shift_id", "worker_id", "assigned_point", "substitute_for_worker_id", "notes"] as const),
  );
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const ctx = await getShiftContext(supabase, v.shift_id);
  const denied = ensureManage(user, ctx);
  if (denied || !ctx) return denied ?? NO_ACCESS;
  if (ctx.shift.status === "cancelada") return { ok: false, message: "La guardia está cancelada; reactívala para agregar personas." };

  const { data: worker, error: workerError } = await supabase.from("workers").select("id, active").eq("id", v.worker_id).maybeSingle();
  if (workerError) return { ok: false, message: friendlyDbError(workerError) };
  if (!worker || !worker.active) {
    return { ok: false, message: "La persona no está activa o no es visible para tu cuenta.", fieldErrors: { worker_id: "Elige un trabajador activo." } };
  }

  const { error } = await supabase.from("shift_assignments").insert({
    shift_id: v.shift_id,
    worker_id: v.worker_id,
    assigned_point: v.assigned_point ?? null,
    substitute_for_worker_id: v.substitute_for_worker_id ?? null,
    notes: v.notes ?? null,
    change_reason: v.substitute_for_worker_id ? "Asignación por sustitución" : "Asignación a la guardia",
  });
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo agregar la asignación.") };

  revalidateShift(v.shift_id);
  return { ok: true, message: "Asignación agregada." };
}

/** Quitar una asignación SIN registros. Con registros se usa el estado «cancelado». */
export async function removeAssignment(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const parsed = removeAssignmentSchema.safeParse(readForm(formData, ["assignment_id", "reason"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const { assignment_id, reason } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAssignmentContext(supabase, assignment_id);
  const denied = ensureManage(user, ctx);
  if (denied || !ctx) return denied ?? NO_ACCESS;

  const { count, error: countError } = await supabase
    .from("attendance_sessions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignment_id);
  if (countError) return { ok: false, message: friendlyDbError(countError) };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: "La asignación tiene registros de asistencia y no puede quitarse. Cambia su estado a «Asignación cancelada» con un motivo.",
    };
  }

  // El motivo se guarda antes de borrar para que la bitácora lo conserve.
  const { error: reasonError } = await supabase.from("shift_assignments").update({ change_reason: reason }).eq("id", assignment_id);
  if (reasonError) return { ok: false, message: friendlyDbError(reasonError, "No se pudo quitar la asignación.") };
  const { error } = await supabase.from("shift_assignments").delete().eq("id", assignment_id);
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo quitar la asignación.") };

  revalidateShift(ctx.shift.id);
  return { ok: true, message: "Asignación quitada." };
}

/** Cambiar el estado de una asignación (función set_assignment_status). */
export async function changeAssignmentStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const parsed = assignmentStatusSchema.safeParse(readForm(formData, ["assignment_id", "status", "reason"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const { assignment_id, status, reason } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAssignmentContext(supabase, assignment_id);
  const denied = ensureManage(user, ctx);
  if (denied || !ctx) return denied ?? NO_ACCESS;
  if (ctx.assignment.status === status) return { ok: false, message: "La asignación ya tiene ese estado." };

  const { error } = await supabase.rpc("set_assignment_status", { p_assignment_id: assignment_id, p_status: status, p_reason: reason });
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo cambiar el estado.") };

  revalidateShift(ctx.shift.id);
  return { ok: true, message: "Estado de la asignación actualizado." };
}

/** Corregir una sesión vigente (correct_attendance). Horas capturadas en la zona de la sede. */
export async function correctSession(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const parsed = correctSessionSchema.safeParse(readForm(formData, ["session_id", "check_in", "check_out", "reason", "notes"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const ctx = await getSessionContext(supabase, v.session_id);
  const denied = ensureManage(user, ctx);
  if (denied || !ctx) return denied ?? NO_ACCESS;
  if (ctx.session.record_status !== "vigente") return { ok: false, message: "Solo se corrige la versión vigente del registro." };

  const checkIn = localInputToUtc(v.check_in, ctx.timezone);
  const checkOut = v.check_out ? localInputToUtc(v.check_out, ctx.timezone) : null;
  if (checkOut && checkOut <= checkIn) {
    return { ok: false, message: "La salida debe ser posterior a la entrada.", fieldErrors: { check_out: "Debe ser posterior a la entrada." } };
  }

  const { error } = await supabase.rpc("correct_attendance", {
    p_session_id: v.session_id,
    p_check_in_at: checkIn.toISOString(),
    // La función acepta salida nula (entrada aún abierta); el tipo generado no lo refleja.
    p_check_out_at: (checkOut ? checkOut.toISOString() : null) as string,
    p_reason: v.reason,
    p_notes: v.notes,
  });
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo guardar la corrección.") };

  revalidateShift(ctx.shift.id);
  return { ok: true, message: "Corrección guardada. El registro original se conserva como «corregido»." };
}

/** Anular una sesión vigente (void_attendance). */
export async function voidSession(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const parsed = voidSessionSchema.safeParse(readForm(formData, ["session_id", "reason"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const { session_id, reason } = parsed.data;

  const supabase = await createClient();
  const ctx = await getSessionContext(supabase, session_id);
  const denied = ensureManage(user, ctx);
  if (denied || !ctx) return denied ?? NO_ACCESS;

  const { error } = await supabase.rpc("void_attendance", { p_session_id: session_id, p_reason: reason });
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo anular el registro.") };

  revalidateShift(ctx.shift.id);
  return { ok: true, message: "Registro anulado. Se conserva en el historial." };
}

/** Registro manual posterior (add_manual_attendance). El requestId viene del servidor: un doble envío no duplica. */
export async function addManualSession(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const parsed = manualSessionSchema.safeParse(
    readForm(formData, ["assignment_id", "request_id", "check_in", "check_out", "reason", "notes"] as const),
  );
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const ctx = await getAssignmentContext(supabase, v.assignment_id);
  const denied = ensureManage(user, ctx);
  if (denied || !ctx) return denied ?? NO_ACCESS;

  const checkIn = localInputToUtc(v.check_in, ctx.timezone);
  const checkOut = localInputToUtc(v.check_out, ctx.timezone);
  if (checkOut <= checkIn) {
    return { ok: false, message: "La salida debe ser posterior a la entrada.", fieldErrors: { check_out: "Debe ser posterior a la entrada." } };
  }

  const { data, error } = await supabase.rpc("add_manual_attendance", {
    p_assignment_id: v.assignment_id,
    p_check_in_at: checkIn.toISOString(),
    p_check_out_at: checkOut.toISOString(),
    p_reason: v.reason,
    p_request_id: v.request_id,
    p_notes: v.notes,
  });
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo agregar el registro.") };

  revalidateShift(ctx.shift.id);
  const result = (data as { result?: string } | null)?.result;
  return {
    ok: true,
    message: result === "duplicate" ? "Este registro ya se había guardado; no se duplicó." : "Registro manual agregado (corrección administrativa).",
  };
}

/** Justificar una incidencia calculada (upsert en incident_notes). */
export async function saveIncidentNote(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const parsed = incidentNoteSchema.safeParse(readForm(formData, ["assignment_id", "incident_type", "note"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const ctx = await getAssignmentContext(supabase, v.assignment_id);
  const denied = ensureManage(user, ctx);
  if (denied || !ctx) return denied ?? NO_ACCESS;

  const { error } = await supabase.from("incident_notes").upsert(
    {
      assignment_id: v.assignment_id,
      facility_id: ctx.shift.facility_id,
      incident_type: v.incident_type,
      note: v.note,
      justified: true,
    },
    { onConflict: "assignment_id,incident_type" },
  );
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo guardar la justificación.") };

  revalidateShift(ctx.shift.id);
  return { ok: true, message: "Justificación guardada." };
}
