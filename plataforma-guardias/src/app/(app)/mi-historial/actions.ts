"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError, type ActionResult } from "@/lib/actions";
import { correctionFromFormData, parseCorrection, resolveCorrection, type CorrectionFields } from "@/lib/presence/correction";
import { NOT_LINKED_MESSAGE } from "@/lib/presence/texts";

export type CorrectionState =
  | (ActionResult & {
      /** Valores enviados (para no perderlos si hay error). */
      values?: Partial<Record<CorrectionFields, string>>;
      /** Cambia en cada envío para reiniciar el formulario. */
      submittedAt: number;
    })
  | null;

type AssignmentLookup = {
  id: string;
  worker_id: string;
  shift: { id: string; facility: { timezone: string } | null } | null;
};

/** Solicitud de corrección de un registro propio (request_correction). */
export async function requestCorrection(_prev: CorrectionState, formData: FormData): Promise<CorrectionState> {
  const submittedAt = Date.now();
  const raw = correctionFromFormData(formData);
  const fail = (message: string, fieldErrors?: Record<string, string>): CorrectionState => ({
    ok: false,
    message,
    fieldErrors,
    values: raw,
    submittedAt,
  });

  const user = await getSessionUser();
  if (!user) return fail("Tu sesión terminó. Vuelve a iniciar sesión.");
  if (!user.workerId) return fail(NOT_LINKED_MESSAGE);

  const parsed = parseCorrection(raw);
  if (!parsed.ok) return fail(parsed.message, parsed.fieldErrors);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shift_assignments")
    .select("id, worker_id, shift:shifts!shift_assignments_shift_id_fkey(id, facility:facilities!shifts_facility_id_fkey(timezone))")
    .eq("id", parsed.input.assignmentId)
    .maybeSingle();
  if (error) return fail(friendlyDbError(error, "No se pudo verificar la guardia."));
  const assignment = data as AssignmentLookup | null;
  // Solo registros propios (RLS ya lo limita; se verifica también aquí).
  if (!assignment || assignment.worker_id !== user.workerId) {
    return fail("Solo puedes solicitar correcciones de tus propios registros.");
  }
  const timeZone = assignment.shift?.facility?.timezone;
  if (!timeZone) return fail("No se pudo determinar la zona horaria de la sede.");

  const resolved = resolveCorrection(parsed.input, timeZone);
  if (!resolved.ok) return fail(resolved.message, resolved.fieldErrors);

  const { error: rpcError } = await supabase.rpc("request_correction", {
    p_assignment_id: resolved.assignmentId,
    // La función acepta null (los tipos generados no lo reflejan).
    p_session_id: resolved.sessionId as string,
    p_check_in_at: (resolved.checkInAt?.toISOString() ?? null) as string,
    p_check_out_at: (resolved.checkOutAt?.toISOString() ?? null) as string,
    p_reason: resolved.reason,
  });
  if (rpcError) return fail(friendlyDbError(rpcError, "No se pudo enviar la solicitud."));

  revalidatePath("/mi-historial");
  revalidatePath("/correcciones");
  return {
    ok: true,
    message: "Solicitud enviada. Coordinación la revisará; verás el resultado en «Mis solicitudes de corrección».",
    submittedAt,
  };
}
