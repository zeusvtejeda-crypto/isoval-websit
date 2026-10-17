/**
 * Revisión de solicitudes de corrección (funciones puras).
 * La aprobación o el rechazo se hacen SOLO con la función `review_correction`
 * de la base de datos; aquí se valida la entrada y se prepara la vista.
 */
import { z } from "zod";
import { formatDateTime } from "@/lib/time";

export type CorrectionTab = "pendientes" | "revisadas";

export function parseCorrectionTab(value: unknown): CorrectionTab {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "revisadas" ? "revisadas" : "pendientes";
}

export type ReviewResult = "aprobada" | "rechazada";

export function parseReviewResult(value: unknown): ReviewResult | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "aprobada" || v === "rechazada" ? v : null;
}

export const REVIEW_NOTES_MAX = 1000;

const reviewSchema = z
  .object({
    requestId: z.guid({ message: "Solicitud no válida." }),
    decision: z.enum(["aprobar", "rechazar"], { message: "Elige aprobar o rechazar." }),
    notes: z.string().trim().max(REVIEW_NOTES_MAX, { message: `Las notas admiten hasta ${REVIEW_NOTES_MAX} caracteres.` }),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "rechazar" && value.notes.length < 3) {
      ctx.addIssue({ code: "custom", path: ["notes"], message: "Para rechazar, explica el motivo en las notas (mínimo 3 caracteres)." });
    }
  });

export type ReviewInput = { requestId: string; approve: boolean; notes: string | null };

export type ReviewParse = { ok: true; input: ReviewInput } | { ok: false; message: string; fieldErrors: Record<string, string> };

export function parseReview(raw: { requestId: unknown; decision: unknown; notes: unknown }): ReviewParse {
  const result = reviewSchema.safeParse({
    requestId: typeof raw.requestId === "string" ? raw.requestId : "",
    decision: raw.decision,
    notes: typeof raw.notes === "string" ? raw.notes : "",
  });
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, message: Object.values(fieldErrors)[0] ?? "Revisa los datos.", fieldErrors };
  }
  const { requestId, decision, notes } = result.data;
  return { ok: true, input: { requestId, approve: decision === "aprobar", notes: notes.length ? notes : null } };
}

type DateLike = string | Date;

export type CorrectionRequestTimes = {
  session_id: string | null;
  requested_check_in_at: string | null;
  requested_check_out_at: string | null;
};

export type CurrentSession = { check_in_at: string; check_out_at: string | null; record_status: "vigente" | "corregido" | "anulado" } | null;

export type CorrectionView = {
  /** "ajuste" = corrige un registro existente; "nuevo" = agrega un registro que faltó. */
  kind: "ajuste" | "nuevo";
  current: { checkIn: string | null; checkOut: string | null; status: "vigente" | "corregido" | "anulado" | null };
  requested: { checkIn: string | null; checkOut: string | null };
  /** Cómo quedaría el registro si se aprueba. */
  result: { checkIn: string | null; checkOut: string | null };
  warnings: string[];
  /** Se puede aprobar sin que la base de datos lo rechace por datos incompletos. */
  canApprove: boolean;
};

function fmt(value: DateLike | null | undefined, tz: string): string | null {
  return value ? formatDateTime(value, tz) : null;
}

/**
 * Compara horas actuales y solicitadas en la zona de la sede y anticipa los
 * casos que la base de datos rechazaría (para avisar antes de aprobar).
 */
export function describeCorrection(request: CorrectionRequestTimes, session: CurrentSession, tz: string): CorrectionView {
  const warnings: string[] = [];
  let canApprove = true;
  const kind = request.session_id ? "ajuste" : "nuevo";

  const resultIn = request.requested_check_in_at ?? session?.check_in_at ?? null;
  const resultOut = request.requested_check_out_at ?? session?.check_out_at ?? null;

  if (kind === "ajuste") {
    if (!session) {
      warnings.push("No se pudo leer el registro original; es posible que ya no exista o que no tengas acceso.");
      canApprove = false;
    } else if (session.record_status !== "vigente") {
      warnings.push("El registro ya fue corregido o anulado después de la solicitud; la aprobación será rechazada. Considera rechazarla con una nota.");
      canApprove = false;
    }
  } else if (!request.requested_check_in_at || !request.requested_check_out_at) {
    warnings.push("Es un registro nuevo y falta la hora de entrada o de salida; no se puede aprobar. Recházala y pide que envíe ambas horas.");
    canApprove = false;
  }

  if (resultIn && resultOut && Date.parse(resultOut) <= Date.parse(resultIn)) {
    warnings.push("Con estos cambios la salida quedaría antes o igual que la entrada; la aprobación será rechazada.");
    canApprove = false;
  }

  return {
    kind,
    current: {
      checkIn: fmt(session?.check_in_at, tz),
      checkOut: fmt(session?.check_out_at, tz),
      status: session?.record_status ?? null,
    },
    requested: {
      checkIn: fmt(request.requested_check_in_at, tz),
      checkOut: fmt(request.requested_check_out_at, tz),
    },
    result: { checkIn: fmt(resultIn, tz), checkOut: fmt(resultOut, tz) },
    warnings,
    canApprove,
  };
}
