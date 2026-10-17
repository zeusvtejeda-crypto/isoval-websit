/**
 * Configuración de la aplicación (app_settings): lectura con valores por
 * omisión, validación de formularios y lectura de resultados de funciones.
 * Lógica pura.
 */
import { z } from "zod";
import { readText } from "./form";

export const SETTINGS_PATH = "/administracion/configuracion";

export const SETTING_KEYS = {
  privacy: "privacy_notice",
  retention: "retention",
  attendance: "attendance",
} as const;
export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** Descripción y visibilidad, por si hubiera que crear la fila. */
export const SETTING_META: Record<SettingKey, { description: string; isPublic: boolean }> = {
  privacy_notice: { description: "Aviso de privacidad (requiere revisión jurídica antes de producción).", isPublic: true },
  retention: {
    description: "Periodos de conservación (meses): guardias y asistencia, bitácora y datos privados de trabajadores inactivos.",
    isPublic: false,
  },
  attendance: {
    description: "Ventana para registrar entrada antes del inicio y margen para cerrar una entrada abierta sin revisión.",
    isPublic: false,
  },
};

type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function int(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// ---------------------------------------------------------------------------
// Aviso de privacidad
// ---------------------------------------------------------------------------

export const LEGAL_REVIEW_STATUSES = ["pendiente", "aprobado"] as const;
export type LegalReviewStatus = (typeof LEGAL_REVIEW_STATUSES)[number];
export const LEGAL_REVIEW_LABELS: Record<LegalReviewStatus, string> = {
  pendiente: "Pendiente de revisión jurídica",
  aprobado: "Aprobado por revisión jurídica",
};

export type PrivacyNotice = {
  title: string;
  body: string;
  responsible: string | null;
  contact: string | null;
  legal_review_status: LegalReviewStatus;
};

export const PRIVACY_TITLE_MAX = 150;
export const PRIVACY_BODY_MAX = 20_000;
export const PRIVACY_FIELD_MAX = 300;

export function readPrivacyNotice(value: unknown): PrivacyNotice {
  const v = asObject(value);
  return {
    title: str(v.title) ?? "Aviso de privacidad",
    body: typeof v.body === "string" ? v.body : "",
    responsible: str(v.responsible),
    contact: str(v.contact),
    // Cualquier valor distinto de «aprobado» se trata como pendiente.
    legal_review_status: v.legal_review_status === "aprobado" ? "aprobado" : "pendiente",
  };
}

export const privacyNoticeSchema = z.object({
  title: z
    .string({ error: "Escribe el título." })
    .min(3, { error: "El título debe tener al menos 3 caracteres." })
    .max(PRIVACY_TITLE_MAX, { error: `El título admite hasta ${PRIVACY_TITLE_MAX} caracteres.` }),
  body: z
    .string({ error: "Escribe el texto del aviso." })
    .min(20, { error: "El texto del aviso debe tener al menos 20 caracteres." })
    .max(PRIVACY_BODY_MAX, { error: `El texto admite hasta ${PRIVACY_BODY_MAX} caracteres.` }),
  responsible: z.string().max(PRIVACY_FIELD_MAX, { error: `Admite hasta ${PRIVACY_FIELD_MAX} caracteres.` }).nullable(),
  contact: z.string().max(PRIVACY_FIELD_MAX, { error: `Admite hasta ${PRIVACY_FIELD_MAX} caracteres.` }).nullable(),
  legal_review_status: z.enum(LEGAL_REVIEW_STATUSES, { error: "Elige el estado de la revisión jurídica." }),
});

export function readPrivacyNoticeForm(formData: FormData) {
  const body = formData.get("body");
  return {
    title: readText(formData, "title"),
    // Se conservan saltos de línea; solo se recortan los extremos.
    body: typeof body === "string" && body.trim() ? body.replace(/\r\n/g, "\n").trim() : undefined,
    responsible: readText(formData, "responsible") ?? null,
    contact: readText(formData, "contact") ?? null,
    legal_review_status: readText(formData, "legal_review_status"),
  };
}

// ---------------------------------------------------------------------------
// Conservación de datos
// ---------------------------------------------------------------------------

export const RETENTION_DEFAULTS = { attendance_months: 24, audit_months: 60, inactive_worker_months: 24 } as const;
export const RETENTION_MAX_MONTHS = 600;
export type RetentionSettings = { attendance_months: number; audit_months: number; inactive_worker_months: number };

export function readRetention(value: unknown): RetentionSettings {
  const v = asObject(value);
  return {
    attendance_months: int(v.attendance_months, RETENTION_DEFAULTS.attendance_months),
    audit_months: int(v.audit_months, RETENTION_DEFAULTS.audit_months),
    inactive_worker_months: int(v.inactive_worker_months, RETENTION_DEFAULTS.inactive_worker_months),
  };
}

const months = (label: string) =>
  z.coerce
    .number({ error: `Indica los meses de ${label}.` })
    .int({ error: "Usa un número entero de meses." })
    .min(1, { error: "El mínimo es 1 mes." })
    .max(RETENTION_MAX_MONTHS, { error: `El máximo es ${RETENTION_MAX_MONTHS} meses.` });

export const retentionSchema = z.object({
  attendance_months: months("conservación de guardias y asistencia"),
  audit_months: months("conservación de bitácora"),
  inactive_worker_months: months("conservación de datos privados de trabajadores inactivos"),
});

export function readRetentionForm(formData: FormData) {
  return {
    attendance_months: readText(formData, "attendance_months"),
    audit_months: readText(formData, "audit_months"),
    inactive_worker_months: readText(formData, "inactive_worker_months"),
  };
}

export type RetentionImpact = {
  executed: boolean;
  attendanceCutoff: string | null;
  auditCutoff: string | null;
  inactiveWorkerCutoff: string | null;
  shifts: number;
  sessions: number;
  auditRows: number;
  /** Filas de worker_private (número de trabajador y teléfono) de trabajadores inactivos. */
  workerPrivateRows: number;
};

/** Lee la respuesta de apply_retention_policy. */
export function parseRetentionImpact(value: unknown): RetentionImpact | null {
  const v = asObject(value);
  if (!("shifts" in v) && !("audit_rows" in v)) return null;
  return {
    executed: v.executed === true,
    attendanceCutoff: str(v.attendance_cutoff),
    auditCutoff: str(v.audit_cutoff),
    inactiveWorkerCutoff: str(v.inactive_worker_cutoff),
    shifts: Math.max(0, int(v.shifts, 0)),
    sessions: Math.max(0, int(v.sessions, 0)),
    auditRows: Math.max(0, int(v.audit_rows, 0)),
    workerPrivateRows: Math.max(0, int(v.worker_private_rows, 0)),
  };
}

export function retentionImpactIsEmpty(impact: RetentionImpact): boolean {
  return impact.shifts === 0 && impact.sessions === 0 && impact.auditRows === 0 && impact.workerPrivateRows === 0;
}

/** Resumen del resultado de «Aplicar ahora». */
export function describeAppliedRetention(impact: RetentionImpact): string {
  const p = (n: number, one: string, many: string) => `${n.toLocaleString("es-MX")} ${n === 1 ? one : many}`;
  return (
    `Política aplicada. Se eliminaron ${p(impact.shifts, "guardia", "guardias")}, ` +
    `${p(impact.sessions, "registro de entrada y salida", "registros de entrada y salida")}, ` +
    `${p(impact.auditRows, "evento de bitácora", "eventos de bitácora")} y ` +
    `los datos privados de ${p(impact.workerPrivateRows, "trabajador inactivo", "trabajadores inactivos")}. Quedó constancia en la bitácora.`
  );
}

// ---------------------------------------------------------------------------
// Registro de asistencia
// ---------------------------------------------------------------------------

export const ATTENDANCE_DEFAULTS = { checkin_window_before_minutes: 120, open_session_grace_minutes: 240 } as const;
export const CHECKIN_WINDOW_MAX = 1440;
export const OPEN_SESSION_GRACE_MAX = 2880;
export type AttendanceSettings = { checkin_window_before_minutes: number; open_session_grace_minutes: number };

export function readAttendanceSettings(value: unknown): AttendanceSettings {
  const v = asObject(value);
  return {
    checkin_window_before_minutes: int(v.checkin_window_before_minutes, ATTENDANCE_DEFAULTS.checkin_window_before_minutes),
    open_session_grace_minutes: int(v.open_session_grace_minutes, ATTENDANCE_DEFAULTS.open_session_grace_minutes),
  };
}

const minutes = (label: string, max: number) =>
  z.coerce
    .number({ error: `Indica ${label}.` })
    .int({ error: "Usa un número entero de minutos." })
    .min(0, { error: "No puede ser negativo." })
    .max(max, { error: `El máximo es ${max} minutos.` });

export const attendanceSettingsSchema = z.object({
  checkin_window_before_minutes: minutes("los minutos de ventana", CHECKIN_WINDOW_MAX),
  open_session_grace_minutes: minutes("los minutos de margen", OPEN_SESSION_GRACE_MAX),
});

export function readAttendanceSettingsForm(formData: FormData) {
  return {
    checkin_window_before_minutes: readText(formData, "checkin_window_before_minutes"),
    open_session_grace_minutes: readText(formData, "open_session_grace_minutes"),
  };
}

// ---------------------------------------------------------------------------
// Datos de demostración
// ---------------------------------------------------------------------------

export type DemoCounts = { facilities: number; workers: number; shifts: number };

export function parseDemoPurgeResult(value: unknown): DemoCounts {
  const v = asObject(value);
  return {
    facilities: Math.max(0, int(v.facilities, 0)),
    workers: Math.max(0, int(v.workers, 0)),
    shifts: Math.max(0, int(v.shifts, 0)),
  };
}

export function demoTotal(counts: DemoCounts): number {
  return counts.facilities + counts.workers + counts.shifts;
}

/** «3 instalaciones, 1 trabajador y 0 guardias». */
export function describeDemoCounts(c: DemoCounts): string {
  const p = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return `${p(c.facilities, "instalación", "instalaciones")}, ${p(c.workers, "trabajador", "trabajadores")} y ${p(c.shifts, "guardia", "guardias")}`;
}

/** Confirmación de casilla (valor «on» o «1»). */
export function isConfirmed(formData: FormData, key = "confirm"): boolean {
  const v = formData.get(key);
  return v === "on" || v === "1" || v === "true";
}

/** Combina el valor guardado con el nuevo sin perder claves desconocidas. */
export function mergeSettingValue(current: unknown, next: Record<string, string | number | boolean | null>): Record<string, unknown> {
  return { ...asObject(current), ...next };
}
