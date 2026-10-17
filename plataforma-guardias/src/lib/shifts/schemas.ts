/**
 * Validación (zod) de los formularios del módulo de guardias.
 * Puro: se usa en Server Actions y en pruebas unitarias.
 */
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { DATETIME_LOCAL_RE, TIME_RE, isValidDay } from "./dates";

/** Lee campos de un FormData: recorta espacios y convierte vacíos en undefined. */
export function readForm<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string | undefined> {
  const out = {} as Record<K, string | undefined>;
  for (const key of keys) {
    const value = formData.get(key);
    const trimmed = typeof value === "string" ? value.trim() : "";
    out[key] = trimmed.length ? trimmed : undefined;
  }
  return out;
}

/** Primer mensaje por campo. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function invalidResult(error: z.ZodError): Extract<ActionResult, { ok: false }> {
  return { ok: false, message: "Revisa los campos marcados.", fieldErrors: fieldErrorsFrom(error) };
}

const id = (label: string) => z.guid({ error: label });
const optionalText = (max: number) => z.string().max(max, { error: `Máximo ${max} caracteres.` }).optional();
const reason = (min: number, label = "Indica el motivo") =>
  z
    .string({ error: `${label} (mínimo ${min} caracteres).` })
    .min(min, { error: `${label} (mínimo ${min} caracteres).` })
    .max(500, { error: "Máximo 500 caracteres." });
const localDateTime = (label: string) =>
  z.string({ error: `Indica ${label}.` }).regex(DATETIME_LOCAL_RE, { error: `Indica ${label} con fecha y hora válidas.` });

export const SHIFT_FORM_FIELDS = [
  "id",
  "facility_id",
  "title",
  "meeting_point",
  "date",
  "start_time",
  "end_time",
  "responsible_worker_id",
  "min_staff",
  "max_staff",
  "instructions",
  "change_reason",
] as const;

export const shiftFormSchema = z
  .object({
    id: id("Guardia inválida.").optional(),
    facility_id: id("Elige la sede."),
    title: optionalText(200),
    meeting_point: z
      .string({ error: "Indica el punto de reunión o acceso." })
      .min(2, { error: "El punto de reunión debe tener al menos 2 caracteres." })
      .max(200, { error: "Máximo 200 caracteres." }),
    date: z.string({ error: "Indica la fecha." }).refine((v) => isValidDay(v), { error: "La fecha no es válida." }),
    start_time: z.string({ error: "Indica la hora de inicio." }).regex(TIME_RE, { error: "Hora de inicio inválida (HH:mm)." }),
    end_time: z.string({ error: "Indica la hora de término." }).regex(TIME_RE, { error: "Hora de término inválida (HH:mm)." }),
    responsible_worker_id: id("Responsable inválido.").optional(),
    min_staff: z.coerce
      .number({ error: "Indica el cupo mínimo." })
      .int({ error: "El cupo mínimo debe ser un número entero." })
      .min(0, { error: "El cupo mínimo no puede ser negativo." })
      .max(1000, { error: "Máximo 1000 personas." }),
    max_staff: z.coerce
      .number({ error: "El cupo máximo debe ser un número." })
      .int({ error: "El cupo máximo debe ser un número entero." })
      .min(1, { error: "El cupo máximo debe ser al menos 1." })
      .max(1000, { error: "Máximo 1000 personas." })
      .optional(),
    instructions: optionalText(2000),
    change_reason: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (typeof v.max_staff === "number" && typeof v.min_staff === "number" && v.max_staff < v.min_staff) {
      ctx.addIssue({ code: "custom", path: ["max_staff"], message: "El cupo máximo debe ser mayor o igual al mínimo." });
    }
    if (v.id && (!v.change_reason || v.change_reason.length < 5)) {
      ctx.addIssue({ code: "custom", path: ["change_reason"], message: "Indica el motivo del cambio (mínimo 5 caracteres)." });
    }
  });
export type ShiftFormInput = z.infer<typeof shiftFormSchema>;

export const SHIFT_STATUS_TARGETS = ["programada", "finalizada", "cancelada"] as const;
export const shiftStatusSchema = z.object({
  shift_id: id("Guardia inválida."),
  status: z.enum(SHIFT_STATUS_TARGETS, { error: "Estado inválido." }),
  reason: reason(5),
});

export const addAssignmentSchema = z
  .object({
    shift_id: id("Guardia inválida."),
    worker_id: id("Elige a la persona que se asigna."),
    assigned_point: optionalText(200),
    substitute_for_worker_id: id("Persona sustituida inválida.").optional(),
    notes: optionalText(500),
  })
  .refine((v) => !v.substitute_for_worker_id || v.substitute_for_worker_id !== v.worker_id, {
    path: ["substitute_for_worker_id"],
    error: "Una persona no puede sustituirse a sí misma.",
  });

export const removeAssignmentSchema = z.object({
  assignment_id: id("Asignación inválida."),
  reason: reason(5),
});

export const ASSIGNMENT_STATUS_VALUES = ["asignado", "ausencia_justificada", "inasistencia_confirmada", "cancelado"] as const;
export const assignmentStatusSchema = z.object({
  assignment_id: id("Asignación inválida."),
  status: z.enum(ASSIGNMENT_STATUS_VALUES, { error: "Elige el nuevo estado." }),
  reason: reason(5),
});

export const correctSessionSchema = z.object({
  session_id: id("Registro inválido."),
  check_in: localDateTime("la hora de entrada"),
  check_out: localDateTime("la hora de salida").optional(),
  reason: reason(5, "Indica el motivo de la corrección"),
  notes: optionalText(500),
});

export const voidSessionSchema = z.object({
  session_id: id("Registro inválido."),
  reason: reason(5, "Indica el motivo de la anulación"),
});

export const manualSessionSchema = z.object({
  assignment_id: id("Asignación inválida."),
  request_id: id("Solicitud inválida; recarga la página."),
  check_in: localDateTime("la hora de entrada"),
  check_out: localDateTime("la hora de salida"),
  reason: reason(5),
  notes: optionalText(500),
});

export const INCIDENT_TYPE_VALUES = [
  "llegada_tardia",
  "salida_anticipada",
  "permanencia_adicional",
  "sustitucion",
  "correccion_administrativa",
  "registro_incompleto",
] as const;
export const incidentNoteSchema = z.object({
  assignment_id: id("Asignación inválida."),
  incident_type: z.enum(INCIDENT_TYPE_VALUES, { error: "Incidencia inválida." }),
  note: z
    .string({ error: "Escribe la justificación (mínimo 3 caracteres)." })
    .min(3, { error: "Escribe la justificación (mínimo 3 caracteres)." })
    .max(1000, { error: "Máximo 1000 caracteres." }),
});
