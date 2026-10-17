"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageFacility, getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError, type ActionResult } from "@/lib/actions";
import { OWN_REVIEW_DB_MESSAGES, isRevertibleAbsence, ownReviewBlock, parseReview } from "@/lib/reports/corrections";
import { isGuid } from "@/lib/reports/params";

export type ReviewState = ActionResult | null;

type RequestLookup = {
  id: string;
  facility_id: string;
  worker_id: string;
  requested_by: string;
  session_id: string | null;
  status: "pendiente" | "aprobada" | "rechazada";
  assignment: { shift_id: string; status: string } | null;
};

/**
 * Aprueba o rechaza una solicitud de corrección con la función
 * `review_correction` (la base de datos vuelve a validar permisos y conserva
 * el registro original). Rechazar exige notas.
 */
export async function reviewCorrection(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Tu sesión terminó. Vuelve a iniciar sesión." };
  if (!user.canManage) return { ok: false, message: "Tu cuenta no puede revisar solicitudes de corrección." };

  const parsed = parseReview({
    requestId: formData.get("requestId"),
    decision: formData.get("decision"),
    notes: formData.get("notes"),
  });
  if (!parsed.ok) return { ok: false, message: parsed.message, fieldErrors: parsed.fieldErrors };
  const { requestId, approve, notes } = parsed.input;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("correction_requests")
    .select("id, facility_id, worker_id, requested_by, session_id, status, assignment:shift_assignments!correction_requests_assignment_id_fkey(shift_id, status)")
    .eq("id", requestId)
    .maybeSingle<RequestLookup>();
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo leer la solicitud.") };
  if (!data) return { ok: false, message: "La solicitud no existe o tu cuenta no tiene acceso a ella." };
  if (!canManageFacility(user, data.facility_id)) {
    return { ok: false, message: "No tienes permiso para revisar solicitudes de esta sede." };
  }
  if (data.status !== "pendiente") return { ok: false, message: "La solicitud ya fue revisada por otra persona. Actualiza la página." };
  // La base de datos también lo rechaza; se avisa antes con el mismo mensaje.
  const ownBlock = ownReviewBlock(data, { id: user.id, workerId: user.workerId, isAdmin: user.isAdmin });
  if (ownBlock) return { ok: false, message: OWN_REVIEW_DB_MESSAGES[ownBlock] };

  const { error: rpcError } = await supabase.rpc("review_correction", {
    p_request_id: requestId,
    p_approve: approve,
    p_notes: notes ?? undefined,
  });
  if (rpcError) return { ok: false, message: friendlyDbError(rpcError, "No se pudo registrar la revisión.") };

  revalidatePath("/correcciones");
  revalidatePath("/historial");
  revalidatePath(`/historial/trabajador/${data.worker_id}`);
  revalidatePath("/mi-historial");
  revalidatePath("/inicio");
  if (data.assignment?.shift_id) revalidatePath(`/guardias/${data.assignment.shift_id}`);

  const back = new URLSearchParams({ pestana: "pendientes", revisada: requestId, resultado: approve ? "aprobada" : "rechazada" });
  // Registro nuevo sobre una ausencia o inasistencia: la aprobación la regresó a «Asignado».
  if (approve && !data.session_id && isRevertibleAbsence(data.assignment?.status)) back.set("revertida", "1");
  const sede = formData.get("sede");
  if (typeof sede === "string" && isGuid(sede)) back.set("sede", sede);
  redirect(`/correcciones?${back.toString()}`);
}
