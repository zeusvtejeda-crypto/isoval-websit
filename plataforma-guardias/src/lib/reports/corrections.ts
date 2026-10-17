/**
 * Revisión de solicitudes de corrección (funciones puras).
 * La aprobación o el rechazo se hacen SOLO con la función `review_correction`
 * de la base de datos; aquí se valida la entrada y se prepara la vista.
 */
import { z } from "zod";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/attendance/labels";
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

// ---------------------------------------------------------------------------
// Reglas de la base de datos que se anticipan en la interfaz
// ---------------------------------------------------------------------------

/** Horas máximas antes del inicio o después del término para horas capturadas a mano. */
export const SHIFT_WINDOW_HOURS = 12;
/** Mismo texto que la función app.assert_within_shift de la base de datos. */
export const SHIFT_WINDOW_MESSAGE =
  "Las horas deben estar dentro del horario de la guardia (máximo 12 h antes del inicio o después del término)";

export type ShiftTimes = { starts_at: DateLike; ends_at: DateLike };

/** Ventana permitida para horas capturadas a mano: la guardia ±12 h. */
export function shiftWindow(shift: ShiftTimes): { start: Date; end: Date } {
  const hours = SHIFT_WINDOW_HOURS * 3_600_000;
  return { start: new Date(new Date(shift.starts_at).getTime() - hours), end: new Date(new Date(shift.ends_at).getTime() + hours) };
}

/** Todas las horas indicadas (se ignoran las vacías) caen en la ventana de la guardia. */
export function isWithinShiftWindow(shift: ShiftTimes, ...times: Array<DateLike | null | undefined>): boolean {
  const { start, end } = shiftWindow(shift);
  return times.every((t) => {
    if (t == null) return true;
    const ms = new Date(t).getTime();
    return ms >= start.getTime() && ms <= end.getTime();
  });
}

/**
 * Estados de asignación que una solicitud aprobada regresa a «Asignado»: la
 * persona sí asistió y pide el registro que faltó (review_correction).
 */
export const REVERTIBLE_ABSENCE_STATUSES = ["ausencia_justificada", "inasistencia_confirmada"] as const;
export type RevertibleAbsenceStatus = (typeof REVERTIBLE_ABSENCE_STATUSES)[number];

export function isRevertibleAbsence(status: string | null | undefined): status is RevertibleAbsenceStatus {
  return (REVERTIBLE_ABSENCE_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * Una solicitud de corrección solo puede aprobarse si la guardia y la
 * asignación no están canceladas (mismas reglas que request_correction): no se
 * ofrece en otros casos. Una ausencia o inasistencia sí se puede impugnar.
 */
export function correctionRequestBlock(shiftStatus: string | null | undefined, assignmentStatus: string | null | undefined): string | null {
  if (shiftStatus === "cancelada") return "La guardia está cancelada: no se pueden solicitar correcciones de esta guardia.";
  if (assignmentStatus === "cancelado") return "La asignación está cancelada: no se pueden solicitar correcciones de esta guardia.";
  return null;
}

/** Aviso para el trabajador antes de impugnar una ausencia o inasistencia (null en otros estados). */
export function absenceRequestHint(assignmentStatus: string | null | undefined): string | null {
  if (!isRevertibleAbsence(assignmentStatus)) return null;
  const label = ASSIGNMENT_STATUS_LABELS[assignmentStatus];
  return `Esta guardia está registrada como «${label}». Si sí asististe, solicita el registro con tus horas reales de entrada y salida. Si coordinación lo aprueba, la guardia deja de contar como «${label}».`;
}

/**
 * Separación de funciones: salvo administración, nadie revisa una solicitud
 * que hizo ni una sobre su propia asistencia (la base de datos lo rechaza).
 */
export const OWN_REVIEW_MESSAGE = "Otra persona de coordinación o administración debe revisar esta solicitud";

export type Reviewer = { id: string; workerId: string | null; isAdmin: boolean };

export type OwnReviewBlock = "own_request" | "own_attendance" | null;

export function ownReviewBlock(request: { requested_by: string; worker_id: string }, reviewer: Reviewer): OwnReviewBlock {
  if (reviewer.isAdmin) return null;
  // Mismo orden de verificación que review_correction.
  if (request.requested_by === reviewer.id) return "own_request";
  if (reviewer.workerId && request.worker_id === reviewer.workerId) return "own_attendance";
  return null;
}

/** Mensajes de la base de datos para cada caso (se muestran tal cual). */
export const OWN_REVIEW_DB_MESSAGES: Record<Exclude<OwnReviewBlock, null>, string> = {
  own_request: "No puedes revisar una solicitud que tú hiciste",
  own_attendance: "No puedes corregir, anular ni revisar tu propia asistencia. Pide a otra persona de coordinación o a administración.",
};

export type CorrectionRequestTimes = {
  session_id: string | null;
  requested_check_in_at: string | null;
  requested_check_out_at: string | null;
};

export type CurrentSession = { check_in_at: string; check_out_at: string | null; record_status: "vigente" | "corregido" | "anulado" } | null;

/** Guardia y asignación de la solicitud (para anticipar rechazos de la base de datos). */
export type CorrectionContext = {
  shift?: (ShiftTimes & { status?: string | null }) | null;
  assignmentStatus?: string | null;
  /** Motivo registrado del estado de la asignación (p. ej., de la inasistencia). */
  assignmentStatusReason?: string | null;
};

/** Contexto a partir de una solicitud cargada con su asignación y guardia. */
export function correctionContext(item: {
  assignment: { status?: string | null; status_reason?: string | null; shift: (ShiftTimes & { status?: string | null }) | null } | null;
}): CorrectionContext {
  return {
    shift: item.assignment?.shift ?? null,
    assignmentStatus: item.assignment?.status ?? null,
    assignmentStatusReason: item.assignment?.status_reason ?? null,
  };
}

export type CorrectionView = {
  /** "ajuste" = corrige un registro existente; "nuevo" = agrega un registro que faltó. */
  kind: "ajuste" | "nuevo";
  current: { checkIn: string | null; checkOut: string | null; status: "vigente" | "corregido" | "anulado" | null };
  requested: { checkIn: string | null; checkOut: string | null };
  /** Cómo quedaría el registro si se aprueba. */
  result: { checkIn: string | null; checkOut: string | null };
  warnings: string[];
  /**
   * Aviso para quien revisa: aprobar regresa la asignación de una ausencia o
   * inasistencia a «Asignado» (null si no aplica).
   */
  revertNote: string | null;
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
export function describeCorrection(request: CorrectionRequestTimes, session: CurrentSession, tz: string, context: CorrectionContext = {}): CorrectionView {
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

  const { shift, assignmentStatus, assignmentStatusReason } = context;
  let revertNote: string | null = null;
  if (kind === "nuevo") {
    // add_manual_attendance: guardia y asignación no canceladas.
    if (shift?.status === "cancelada") {
      warnings.push("La guardia está cancelada: no se puede agregar un registro. Recházala con una nota.");
      canApprove = false;
    }
    if (assignmentStatus === "cancelado") {
      warnings.push("La asignación está cancelada: no se puede agregar un registro. Recházala con una nota.");
      canApprove = false;
    } else if (isRevertibleAbsence(assignmentStatus) && shift?.status !== "cancelada") {
      // review_correction regresa la asignación a «Asignado» antes de agregar el registro.
      const label = ASSIGNMENT_STATUS_LABELS[assignmentStatus];
      const reason = assignmentStatusReason?.trim();
      revertNote =
        `La asignación está registrada como «${label}»${reason ? ` (motivo: ${reason})` : ""}. ` +
        `Si apruebas, deja de contar como «${label}», vuelve a «Asignado» y se agrega el registro solicitado. ` +
        "El cambio queda en la bitácora con el motivo de la solicitud y tus notas de revisión.";
    }
  }
  if (shift && !isWithinShiftWindow(shift, resultIn, resultOut)) {
    warnings.push(`${SHIFT_WINDOW_MESSAGE}: la aprobación será rechazada. Recházala y pide que envíe las horas reales.`);
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
    revertNote,
    canApprove,
  };
}
