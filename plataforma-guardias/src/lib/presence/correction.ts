/**
 * Validación de la solicitud de corrección del trabajador (funciones puras).
 * Las horas se capturan en la zona de la sede y se convierten a UTC.
 * La base de datos (request_correction) vuelve a validar todo.
 */
import { z } from "zod";
import { localInputToUtc } from "@/lib/time";

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const optionalLocal = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || LOCAL_DATETIME.test(v), "Fecha y hora inválidas.");

export const correctionSchema = z.object({
  assignmentId: z.guid("La guardia no es válida."),
  sessionId: z
    .union([z.guid("El registro no es válido."), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  checkIn: optionalLocal,
  checkOut: optionalLocal,
  reason: z
    .string({ error: "Describe el motivo (mínimo 5 caracteres)." })
    .trim()
    .min(5, "Describe el motivo (mínimo 5 caracteres).")
    .max(500, "El motivo admite hasta 500 caracteres."),
});

export type CorrectionInput = z.infer<typeof correctionSchema>;

export type CorrectionFields = "assignmentId" | "sessionId" | "checkIn" | "checkOut" | "reason";

type Failure = { ok: false; message: string; fieldErrors: Partial<Record<CorrectionFields, string>> };

export type ParsedCorrection = { ok: true; input: CorrectionInput } | Failure;

export type ResolvedCorrection =
  | { ok: true; assignmentId: string; sessionId: string | null; checkInAt: Date | null; checkOutAt: Date | null; reason: string }
  | Failure;

const INVALID = "Revisa los datos marcados.";

export function correctionFromFormData(formData: FormData): Record<CorrectionFields, string> {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };
  return {
    assignmentId: get("assignmentId"),
    sessionId: get("sessionId"),
    checkIn: get("checkIn"),
    checkOut: get("checkOut"),
    reason: get("reason"),
  };
}

export function parseCorrection(raw: unknown): ParsedCorrection {
  const parsed = correctionSchema.safeParse(raw);
  if (parsed.success) return { ok: true, input: parsed.data };
  const fieldErrors: Partial<Record<CorrectionFields, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in fieldErrors)) fieldErrors[key as CorrectionFields] = issue.message;
  }
  return { ok: false, message: INVALID, fieldErrors };
}

/** Convierte las horas (zona de la sede) a UTC y aplica las reglas de la solicitud. */
export function resolveCorrection(input: CorrectionInput, timeZone: string, now: Date = new Date()): ResolvedCorrection {
  const fieldErrors: Partial<Record<CorrectionFields, string>> = {};
  let checkInAt: Date | null = null;
  let checkOutAt: Date | null = null;
  try {
    checkInAt = input.checkIn ? localInputToUtc(input.checkIn, timeZone) : null;
  } catch {
    fieldErrors.checkIn = "Fecha y hora inválidas.";
  }
  try {
    checkOutAt = input.checkOut ? localInputToUtc(input.checkOut, timeZone) : null;
  } catch {
    fieldErrors.checkOut = "Fecha y hora inválidas.";
  }
  if (Object.keys(fieldErrors).length) return { ok: false, message: INVALID, fieldErrors };

  if (!checkInAt && !checkOutAt) {
    return { ok: false, message: "Indica al menos la hora de entrada o la de salida correcta.", fieldErrors: { checkIn: "Indica la hora correcta." } };
  }
  if (!input.sessionId && (!checkInAt || !checkOutAt)) {
    const msg = "Para solicitar un registro nuevo indica la hora de entrada y la de salida.";
    return {
      ok: false,
      message: msg,
      fieldErrors: { ...(checkInAt ? {} : { checkIn: "Indica la hora de entrada." }), ...(checkOutAt ? {} : { checkOut: "Indica la hora de salida." }) },
    };
  }
  if (checkInAt && checkOutAt && checkOutAt.getTime() <= checkInAt.getTime()) {
    return { ok: false, message: INVALID, fieldErrors: { checkOut: "La salida debe ser posterior a la entrada." } };
  }
  if (checkInAt && checkInAt.getTime() > now.getTime()) fieldErrors.checkIn = "No se pueden solicitar horas futuras.";
  if (checkOutAt && checkOutAt.getTime() > now.getTime()) fieldErrors.checkOut = "No se pueden solicitar horas futuras.";
  if (Object.keys(fieldErrors).length) return { ok: false, message: INVALID, fieldErrors };

  return { ok: true, assignmentId: input.assignmentId, sessionId: input.sessionId, checkInAt, checkOutAt, reason: input.reason };
}
