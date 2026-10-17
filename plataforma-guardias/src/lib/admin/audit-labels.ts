/**
 * Nombres en español para la bitácora: tablas, acciones, campos y valores.
 * Lógica pura.
 */
import type { Tone } from "@/lib/attendance/labels";
import {
  ASSIGNMENT_STATUS_LABELS,
  CORRECTION_STATUS_LABELS,
  INCIDENT_LABELS,
  METHOD_LABELS,
  RECORD_STATUS_LABELS,
  SHIFT_STATUS_LABELS,
} from "@/lib/attendance/labels";

export const AUDIT_TABLE_LABELS: Record<string, string> = {
  facility_categories: "Categorías de instalaciones",
  facilities: "Instalaciones",
  workers: "Trabajadores",
  worker_private: "Datos privados de trabajadores",
  profiles: "Cuentas de acceso",
  user_facility_scopes: "Sedes asignadas a cuentas",
  shifts: "Guardias",
  shift_assignments: "Asignaciones a guardias",
  attendance_sessions: "Registros de entrada y salida",
  correction_requests: "Solicitudes de corrección",
  incident_notes: "Justificaciones de incidencias",
  app_settings: "Configuración",
  retention: "Política de conservación de datos",
  demo_data: "Datos de demostración",
  states: "Entidades federativas",
  municipalities: "Municipios",
};

/** Tablas cuya bitácora solo ve administración (política audit_read). */
export const ADMIN_ONLY_AUDIT_TABLES = ["worker_private", "profiles", "user_facility_scopes"] as const;
/** Eventos sin sede: solo administración los ve. */
export const GLOBAL_AUDIT_TABLES = ["facility_categories", "app_settings", "retention", "demo_data", "states", "municipalities"] as const;

/** Tablas que puede filtrar cada perfil (las demás nunca le aparecerían por RLS). */
export function auditTablesFor(isAdmin: boolean): string[] {
  const all = Object.keys(AUDIT_TABLE_LABELS);
  if (isAdmin) return all;
  const hidden = new Set<string>([...ADMIN_ONLY_AUDIT_TABLES, ...GLOBAL_AUDIT_TABLES]);
  return all.filter((t) => !hidden.has(t));
}

export function auditTableLabel(table: string): string {
  return AUDIT_TABLE_LABELS[table] ?? `Tabla «${table}»`;
}

export const AUDIT_ACTIONS = ["INSERT", "UPDATE", "DELETE", "PURGE"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  INSERT: "Alta",
  UPDATE: "Modificación",
  DELETE: "Eliminación",
  PURGE: "Depuración",
};

export const AUDIT_ACTION_TONE: Record<AuditAction, Tone> = {
  INSERT: "success",
  UPDATE: "info",
  DELETE: "danger",
  PURGE: "warning",
};

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

export function auditActionLabel(action: string): string {
  return isAuditAction(action) ? AUDIT_ACTION_LABELS[action] : action;
}

export function auditActionTone(action: string): Tone {
  return isAuditAction(action) ? AUDIT_ACTION_TONE[action] : "neutral";
}

export const FIELD_LABELS: Record<string, string> = {
  id: "Identificador",
  internal_code: "Clave interna",
  official_name: "Nombre oficial",
  unit_key: "Clave de unidad",
  category_id: "Categoría",
  description: "Descripción",
  state_id: "Estado (entidad)",
  municipality_id: "Municipio",
  address: "Domicilio",
  latitude: "Latitud",
  longitude: "Longitud",
  phone: "Teléfono",
  schedule: "Horario",
  services: "Servicios",
  services_verified: "Servicios verificados",
  source: "Fuente",
  source_url: "Enlace de la fuente",
  last_verified_at: "Última verificación",
  verification_status: "Verificación",
  notes: "Notas",
  timezone: "Zona horaria",
  arrival_tolerance_minutes: "Tolerancia de llegada (min)",
  is_public: "Visible en el directorio público",
  is_demo: "Dato de demostración",
  active: "Activa",
  created_at: "Fecha de alta",
  updated_at: "Última modificación",
  created_by: "Dado de alta por",
  updated_by: "Modificado por",
  full_name: "Nombre completo",
  facility_id: "Sede",
  area: "Área",
  position: "Puesto",
  usual_shift: "Turno habitual",
  worker_id: "Trabajador",
  employee_number: "Número de trabajador",
  role: "Rol",
  display_name: "Nombre visible",
  user_id: "Cuenta",
  granted_by: "Asignada por",
  granted_at: "Fecha de asignación",
  title: "Título",
  meeting_point: "Punto de reunión",
  starts_at: "Inicio",
  ends_at: "Término",
  responsible_worker_id: "Responsable",
  min_staff: "Cupo mínimo",
  max_staff: "Cupo máximo",
  instructions: "Instrucciones",
  status: "Estado",
  cancel_reason: "Motivo de cancelación",
  shift_id: "Guardia",
  assigned_point: "Punto asignado",
  substitute_for_worker_id: "Sustituye a",
  status_reason: "Motivo del estado",
  status_changed_by: "Estado cambiado por",
  status_changed_at: "Fecha del cambio de estado",
  assignment_id: "Asignación",
  check_in_at: "Entrada registrada",
  check_out_at: "Salida registrada",
  check_in_method: "Forma de registro de entrada",
  check_out_method: "Forma de registro de salida",
  check_in_by: "Entrada registrada por",
  check_out_by: "Salida registrada por",
  check_in_reason: "Motivo (entrada)",
  check_out_reason: "Motivo (salida)",
  check_in_request_id: "Folio de solicitud (entrada)",
  check_out_request_id: "Folio de solicitud (salida)",
  record_status: "Estado del registro",
  supersedes_id: "Reemplaza al registro",
  session_id: "Registro de entrada y salida",
  requested_by: "Solicitada por",
  requested_check_in_at: "Entrada solicitada",
  requested_check_out_at: "Salida solicitada",
  reason: "Motivo",
  reviewed_by: "Revisada por",
  reviewed_at: "Fecha de revisión",
  review_notes: "Notas de la revisión",
  resulting_session_id: "Registro resultante",
  incident_type: "Tipo de incidencia",
  note: "Nota",
  justified: "Justificada",
  name: "Nombre",
  key: "Parámetro",
  value: "Valor",
  slug: "Identificador",
  icon: "Icono",
  color: "Color",
  sort_order: "Orden",
  change_reason: "Motivo del cambio",
  normalized_name: "Nombre normalizado",
  // Resúmenes de depuración
  shifts: "Guardias",
  sessions: "Registros de entrada y salida",
  audit_rows: "Eventos de bitácora",
  attendance_cutoff: "Fecha de corte (guardias y asistencia)",
  audit_cutoff: "Fecha de corte (bitácora)",
  workers: "Trabajadores",
  facilities: "Instalaciones",
  executed: "Ejecutada",
};

/** Etiquetas que dependen de la tabla. */
export const FIELD_LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  workers: { active: "Activo", facility_id: "Sede de adscripción" },
  profiles: { active: "Cuenta activa", worker_id: "Trabajador vinculado" },
  shifts: { status: "Estado de la guardia" },
  shift_assignments: { status: "Estado de la asignación" },
  correction_requests: { status: "Estado de la solicitud", reason: "Motivo de la solicitud" },
  facility_categories: { active: "Activa", description: "Descripción" },
};

/** Claves dentro de app_settings.value. */
export const SETTING_FIELD_LABELS: Record<string, string> = {
  title: "Título",
  body: "Texto",
  responsible: "Responsable",
  contact: "Contacto",
  legal_review_status: "Revisión jurídica",
  attendance_months: "Meses de conservación de guardias y asistencia",
  audit_months: "Meses de conservación de bitácora",
  checkin_window_before_minutes: "Ventana de entrada antes del inicio (min)",
  open_session_grace_minutes: "Margen para entradas abiertas (min)",
  text: "Texto",
};

export const SETTING_KEY_LABELS: Record<string, string> = {
  privacy_notice: "Aviso de privacidad",
  retention: "Conservación de datos",
  attendance: "Registro de asistencia",
  disclaimer: "Aviso de no oficialidad",
};

export function fieldLabel(table: string, field: string): string {
  return FIELD_LABEL_OVERRIDES[table]?.[field] ?? FIELD_LABELS[field] ?? field;
}

const VERIFICATION_VALUE_LABELS: Record<string, string> = { verificado: "Verificada", pendiente: "Pendiente de verificación" };
const LEGAL_REVIEW_VALUE_LABELS: Record<string, string> = { pendiente: "Pendiente", aprobado: "Aprobado" };

/** Traducción de valores enumerados (o null si no aplica). */
export function enumValueLabel(table: string, field: string, value: string, roleLabels: Readonly<Record<string, string>> = {}): string | null {
  const pick = (map: Readonly<Record<string, string>>) => (Object.prototype.hasOwnProperty.call(map, value) ? map[value] : null);
  switch (field) {
    case "role":
      return pick(roleLabels);
    case "verification_status":
      return pick(VERIFICATION_VALUE_LABELS);
    case "record_status":
      return pick(RECORD_STATUS_LABELS);
    case "check_in_method":
    case "check_out_method":
      return pick(METHOD_LABELS);
    case "incident_type":
      return pick(INCIDENT_LABELS);
    case "legal_review_status":
      return pick(LEGAL_REVIEW_VALUE_LABELS);
    case "key":
      return table === "app_settings" ? pick(SETTING_KEY_LABELS) : null;
    case "status":
      if (table === "shifts") return pick(SHIFT_STATUS_LABELS);
      if (table === "shift_assignments") return pick(ASSIGNMENT_STATUS_LABELS);
      if (table === "correction_requests") return pick(CORRECTION_STATUS_LABELS);
      return null;
    default:
      return null;
  }
}

/** Rol del autor: etiqueta del rol de la aplicación o «Proceso del sistema». */
export function actorRoleLabel(role: string | null | undefined, roleLabels: Readonly<Record<string, string>>): string {
  if (!role) return "Sin rol registrado";
  if (Object.prototype.hasOwnProperty.call(roleLabels, role)) return roleLabels[role];
  return "Proceso del sistema";
}
