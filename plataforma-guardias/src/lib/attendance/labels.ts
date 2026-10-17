import type { AttendanceStatus, IncidentType } from "./calc";

/** Etiquetas en español de México. Los estados siempre se muestran con texto. */
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  pendiente: "Pendiente",
  en_servicio: "En servicio",
  finalizada: "Finalizada",
  ausencia_justificada: "Ausencia justificada",
  inasistencia_confirmada: "Inasistencia confirmada tras revisión",
  registro_incompleto: "Registro incompleto (pendiente de revisión)",
  cancelada: "Cancelada",
};

export const INCIDENT_LABELS: Record<IncidentType, string> = {
  llegada_tardia: "Llegada tardía",
  salida_anticipada: "Salida anticipada",
  permanencia_adicional: "Permanencia adicional (tiempo registrado adicional)",
  sustitucion: "Sustitución",
  correccion_administrativa: "Corrección administrativa",
  registro_incompleto: "Registro incompleto",
};

export const SHIFT_STATUS_LABELS = {
  programada: "Programada",
  en_curso: "En curso",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
} as const;

export const ASSIGNMENT_STATUS_LABELS = {
  asignado: "Asignado",
  ausencia_justificada: "Ausencia justificada",
  inasistencia_confirmada: "Inasistencia confirmada",
  cancelado: "Asignación cancelada",
} as const;

export const METHOD_LABELS = {
  propio: "Registro propio",
  coordinador: "Registrado por coordinación",
  qr: "Código QR",
  correccion: "Corrección administrativa",
} as const;

export const RECORD_STATUS_LABELS = {
  vigente: "Vigente",
  corregido: "Corregido (versión original conservada)",
  anulado: "Anulado",
} as const;

export const CORRECTION_STATUS_LABELS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
} as const;

/**
 * Quién hizo algo, para usar después de una preposición («por …»):
 * «Tú» se escribe «ti» («Corregido por ti», no «por Tú»).
 */
export function afterPreposition(actor: string): string {
  return actor === "Tú" ? "ti" : actor;
}

/** Tono visual de apoyo (el texto siempre acompaña al color). */
export type Tone = "neutral" | "success" | "info" | "warning" | "danger" | "muted";

export const ATTENDANCE_STATUS_TONE: Record<AttendanceStatus, Tone> = {
  pendiente: "neutral",
  en_servicio: "success",
  finalizada: "info",
  ausencia_justificada: "muted",
  inasistencia_confirmada: "danger",
  registro_incompleto: "warning",
  cancelada: "muted",
};

export const SHIFT_STATUS_TONE: Record<keyof typeof SHIFT_STATUS_LABELS, Tone> = {
  programada: "neutral",
  en_curso: "success",
  finalizada: "info",
  cancelada: "muted",
};
