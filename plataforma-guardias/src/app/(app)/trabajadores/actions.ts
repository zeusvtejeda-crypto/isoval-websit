"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageFacility, requireAdmin, requireManager } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import {
  EMPLOYEE_NUMBER_TAKEN,
  invalidResult,
  readFields,
  readWorkerForm,
  workerActiveSchema,
  workerDeleteSchema,
  workerFormSchema,
} from "@/lib/validation/worker";

type SaveResult = ActionResult<{ id: string }>;
type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * app.touch_row() deja change_reason en NULL cuando el motivo enviado es igual al
 * ya guardado (para no arrastrar motivos viejos), y entonces la bitácora quedaría
 * sin motivo. Si coinciden, se limpia antes: una actualización que solo cambia
 * change_reason no genera entrada en la bitácora, y la siguiente sí lo registra.
 */
async function clearReasonIfSame(
  supabase: Supabase,
  table: "workers" | "worker_private",
  workerId: string,
  stored: string | null | undefined,
  reason: string | null,
) {
  if (!reason || stored !== reason) return null;
  const { error } =
    table === "workers"
      ? await supabase.from("workers").update({ change_reason: null }).eq("id", workerId)
      : await supabase.from("worker_private").update({ change_reason: null }).eq("worker_id", workerId);
  return error;
}

/** Resultado de create_worker: {ok: true, id} o {ok: false, taken: true, …}. */
function parseCreateWorker(data: unknown): { id: string | null; taken: boolean } {
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return { id: o.ok === true && typeof o.id === "string" ? o.id : null, taken: o.taken === true };
}

/**
 * Alta o edición de un trabajador. El alta crea el registro y sus datos
 * privados en una sola transacción (create_worker). La edición escribe workers,
 * después el teléfono en worker_private (si cambió) y el número de trabajador
 * con set_employee_number (si cambió): authenticated no escribe
 * employee_number directamente. Al guardar redirige a la ficha.
 */
export async function saveWorker(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const user = await requireManager();
  const parsed = workerFormSchema.safeParse(readWorkerForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;

  if (!canManageFacility(user, v.facility_id)) {
    return { ok: false, message: "No puedes registrar trabajadores en esa instalación.", fieldErrors: { facility_id: "Instalación fuera de tus sedes." } };
  }

  const supabase = await createClient();

  // Registro actual (edición): debe ser visible y gestionable.
  let current: { id: string; facility_id: string | null; change_reason: string | null } | null = null;
  if (v.id) {
    const { data, error } = await supabase.from("workers").select("id, facility_id, change_reason").eq("id", v.id).maybeSingle();
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data) return { ok: false, message: "El trabajador no existe o no tienes acceso." };
    if (!canManageFacility(user, data.facility_id)) {
      return { ok: false, message: "No puedes editar trabajadores de esa sede." };
    }
    current = data;
  }

  // Catálogos: estado, municipio del mismo estado e instalación activa.
  const [stateRes, municipalityRes, facilityRes] = await Promise.all([
    supabase.from("states").select("id").eq("id", v.state_id).maybeSingle(),
    v.municipality_id
      ? supabase.from("municipalities").select("id, state_id").eq("id", v.municipality_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("facilities").select("id, active").eq("id", v.facility_id).maybeSingle(),
  ]);
  const catalogError = stateRes.error ?? municipalityRes.error ?? facilityRes.error;
  if (catalogError) return { ok: false, message: friendlyDbError(catalogError) };
  if (!stateRes.data) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { state_id: "Estado no válido." } };
  if (v.municipality_id && (!municipalityRes.data || municipalityRes.data.state_id !== v.state_id)) {
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { municipality_id: "El municipio no corresponde al estado elegido." } };
  }
  if (!facilityRes.data) {
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { facility_id: "La instalación no existe o no está disponible." } };
  }
  if (!facilityRes.data.active && current?.facility_id !== v.facility_id) {
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { facility_id: "La instalación está inactiva." } };
  }

  // Número de trabajador repetido en cualquier sede, también en las que la cuenta
  // no ve (la función solo responde sí/no). Las carreras las cubren create_worker
  // y set_employee_number, que responden «taken» sin crear ni cambiar nada.
  const employeeNumber = v.employee_number ?? null;
  if (employeeNumber) {
    const { data: taken, error } = await supabase.rpc("employee_number_taken", { p_number: employeeNumber, p_except_worker: v.id });
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (taken) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { employee_number: EMPLOYEE_NUMBER_TAKEN } };
  }

  // Alta: registro y datos privados juntos; si algo falla no queda nada creado.
  if (!v.id) {
    const { data, error } = await supabase.rpc("create_worker", {
      p_full_name: v.full_name,
      p_state_id: v.state_id,
      p_facility_id: v.facility_id,
      p_municipality_id: v.municipality_id,
      p_area: v.area,
      p_position: v.position,
      p_usual_shift: v.usual_shift,
      p_active: v.active,
      p_employee_number: v.employee_number,
      p_phone: v.phone,
      p_change_reason: v.change_reason ?? "Alta de trabajador",
    });
    if (error) return { ok: false, message: friendlyDbError(error, "No se pudo registrar el trabajador.") };
    const created = parseCreateWorker(data);
    // Número registrado entre la comprobación y el alta: la función no crea nada
    // y responde «taken» (sin error, para conservar la cuota consumida).
    if (created.taken) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { employee_number: EMPLOYEE_NUMBER_TAKEN } };
    if (!created.id) return { ok: false, message: "No se pudo registrar el trabajador." };
    const newId = created.id;
    revalidatePath("/trabajadores");
    revalidatePath(`/trabajadores/${newId}`);
    redirect(`/trabajadores/${newId}?guardado=1`);
  }

  const workerId = v.id;
  const reason = v.change_reason ?? null;
  const values = {
    full_name: v.full_name,
    state_id: v.state_id,
    municipality_id: v.municipality_id ?? null,
    facility_id: v.facility_id,
    area: v.area ?? null,
    position: v.position ?? null,
    usual_shift: v.usual_shift ?? null,
    active: v.active,
  };

  const clearError = await clearReasonIfSame(supabase, "workers", workerId, current?.change_reason, reason);
  if (clearError) return { ok: false, message: friendlyDbError(clearError, "No se pudo guardar el trabajador.") };
  const { data, error } = await supabase
    .from("workers")
    .update({ ...values, change_reason: reason })
    .eq("id", workerId)
    .select("id");
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo guardar el trabajador.") };
  if (!data || data.length === 0) return { ok: false, message: "No tienes permiso para modificar este registro." };

  // Datos privados: el teléfono se escribe directamente; el número de trabajador
  // solo con set_employee_number (consume la cuota de comprobación).
  const phone = v.phone ?? null;
  const { data: existingPrivate, error: privateReadError } = await supabase
    .from("worker_private")
    .select("employee_number, phone, change_reason")
    .eq("worker_id", workerId)
    .maybeSingle();
  let privateError = privateReadError;
  // Lo que no se guardó (para el mensaje): sin leer la fila no se escribe nada.
  let missing = "el número de trabajador ni el teléfono";
  let phoneWritten = false;
  let numberTaken = false;
  const phoneChanged = (existingPrivate?.phone ?? null) !== phone;
  const numberChanged = (existingPrivate?.employee_number ?? null) !== employeeNumber;
  if (!privateError && phoneChanged) {
    privateError = await clearReasonIfSame(supabase, "worker_private", workerId, existingPrivate?.change_reason, reason);
    if (!privateError) {
      const { error } = await supabase.from("worker_private").upsert({ worker_id: workerId, phone, change_reason: reason }, { onConflict: "worker_id" });
      privateError = error;
    }
    if (privateError) missing = numberChanged ? "el número de trabajador ni el teléfono" : "el teléfono";
    else phoneWritten = true;
  }
  if (!privateError && numberChanged) {
    const { data: outcome, error } = await supabase.rpc("set_employee_number", {
      p_worker_id: workerId,
      p_number: employeeNumber ?? "",
      p_reason: reason ?? "",
    });
    privateError = error;
    numberTaken = !error && outcome === "taken";
    missing = "el número de trabajador";
  }

  revalidatePath("/trabajadores");
  revalidatePath(`/trabajadores/${workerId}`);

  if (numberTaken || privateError) {
    const saved = phoneWritten ? "los datos generales y el teléfono" : "los datos generales";
    return {
      ok: false,
      message: `Se guardaron ${saved}, pero no ${missing}: ${numberTaken ? EMPLOYEE_NUMBER_TAKEN : friendlyDbError(privateError)}`,
      ...(numberTaken ? { fieldErrors: { employee_number: EMPLOYEE_NUMBER_TAKEN } } : {}),
    };
  }
  redirect(`/trabajadores/${workerId}?guardado=1`);
}

/** Desactivar (en lugar de borrar) o reactivar, con motivo. */
export async function setWorkerActive(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const parsed = workerActiveSchema.safeParse(readFields(formData, ["worker_id", "active", "reason"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const { worker_id, reason } = parsed.data;
  const active = parsed.data.active === "1";

  const supabase = await createClient();
  const { data: worker, error } = await supabase.from("workers").select("id, facility_id, active, change_reason").eq("id", worker_id).maybeSingle();
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!worker) return { ok: false, message: "El trabajador no existe o no tienes acceso." };
  if (!canManageFacility(user, worker.facility_id)) return { ok: false, message: "No puedes modificar trabajadores de esa sede." };
  if (worker.active === active) return { ok: false, message: active ? "El trabajador ya está activo." : "El trabajador ya está inactivo." };

  const clearError = await clearReasonIfSame(supabase, "workers", worker_id, worker.change_reason, reason);
  if (clearError) return { ok: false, message: friendlyDbError(clearError, "No se pudo cambiar el estado.") };

  const { data, error: updateError } = await supabase
    .from("workers")
    .update({ active, change_reason: reason })
    .eq("id", worker_id)
    .select("id");
  if (updateError) return { ok: false, message: friendlyDbError(updateError, "No se pudo cambiar el estado.") };
  if (!data || data.length === 0) return { ok: false, message: "No tienes permiso para modificar este registro." };

  revalidatePath("/trabajadores");
  revalidatePath(`/trabajadores/${worker_id}`);
  return {
    ok: true,
    message: active
      ? "Trabajador reactivado."
      : "Trabajador desactivado. Su historial se conserva y ya no podrá asignarse a nuevas guardias.",
  };
}

/**
 * Eliminación definitiva: solo administración y solo si no tiene relaciones
 * (asignaciones, registros de asistencia, solicitudes, responsabilidades ni cuenta).
 */
export async function deleteWorker(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = workerDeleteSchema.safeParse(readFields(formData, ["worker_id", "reason", "confirm"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const { worker_id, reason } = parsed.data;

  const supabase = await createClient();
  const { data: worker, error } = await supabase.from("workers").select("id, change_reason").eq("id", worker_id).maybeSingle();
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!worker) return { ok: false, message: "El trabajador no existe o ya fue eliminado." };

  const countOf = async (table: "shift_assignments" | "attendance_sessions" | "correction_requests" | "profiles", column: string) => {
    // Solo la columna filtrada: profiles no concede SELECT de todas sus columnas (change_reason).
    const { count, error: countError } = await supabase.from(table).select(column, { count: "exact", head: true }).eq(column, worker_id);
    if (countError) throw new Error(countError.message);
    return count ?? 0;
  };
  let relations: string[] = [];
  try {
    const [assignments, sessions, corrections, accounts, substitutions, responsible] = await Promise.all([
      countOf("shift_assignments", "worker_id"),
      countOf("attendance_sessions", "worker_id"),
      countOf("correction_requests", "worker_id"),
      countOf("profiles", "worker_id"),
      countOf("shift_assignments", "substitute_for_worker_id"),
      supabase
        .from("shifts")
        .select("id", { count: "exact", head: true })
        .eq("responsible_worker_id", worker_id)
        .then(({ count, error: e }) => {
          if (e) throw new Error(e.message);
          return count ?? 0;
        }),
    ]);
    relations = [
      assignments ? `${assignments} ${assignments === 1 ? "asignación a guardia" : "asignaciones a guardias"}` : "",
      sessions ? `${sessions} ${sessions === 1 ? "registro de asistencia" : "registros de asistencia"}` : "",
      corrections ? `${corrections} ${corrections === 1 ? "solicitud de corrección" : "solicitudes de corrección"}` : "",
      accounts ? "una cuenta de acceso" : "",
      substitutions ? `${substitutions} ${substitutions === 1 ? "sustitución registrada" : "sustituciones registradas"}` : "",
      responsible ? `${responsible} ${responsible === 1 ? "guardia como responsable" : "guardias como responsable"}` : "",
    ].filter(Boolean);
  } catch {
    return { ok: false, message: "No se pudo comprobar si el registro tiene relaciones. Inténtalo de nuevo." };
  }
  if (relations.length > 0) {
    return {
      ok: false,
      message: `No se puede eliminar porque tiene ${relations.join(", ")}. Desactívalo en su lugar: el historial se conserva.`,
    };
  }

  // El motivo queda en la bitácora: se guarda antes de borrar (sin generar otra entrada).
  // Si ya es el motivo guardado no se reescribe (touch_row lo dejaría en NULL).
  if (worker.change_reason !== reason) {
    const { error: reasonError } = await supabase.from("workers").update({ change_reason: reason }).eq("id", worker_id);
    if (reasonError) return { ok: false, message: friendlyDbError(reasonError, "No se pudo eliminar el registro.") };
  }
  const { error: deleteError } = await supabase.from("workers").delete().eq("id", worker_id);
  if (deleteError) return { ok: false, message: friendlyDbError(deleteError, "No se pudo eliminar el registro.") };

  revalidatePath("/trabajadores");
  redirect("/trabajadores?eliminado=1");
}
