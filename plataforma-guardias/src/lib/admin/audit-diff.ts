/**
 * Detalle de eventos de la bitácora: campos cambiados con valor anterior y
 * valor nuevo, en texto legible. Lógica pura.
 */
import { formatDateTime } from "@/lib/time";
import { FIELD_LABELS, SETTING_FIELD_LABELS, SETTING_KEY_LABELS, enumValueLabel, fieldLabel } from "./audit-labels";

export type AuditEventData = {
  table_name: string;
  action: string;
  changed_fields: string[] | null;
  old_data: unknown;
  new_data: unknown;
};

export type RefKind = "facility" | "category" | "state" | "municipality" | "profile" | "worker";

export type ValueContext = {
  /** Zona para mostrar fechas y horas. */
  timeZone?: string | null;
  /** Etiquetas de roles (ROLE_LABELS). */
  roleLabels?: Readonly<Record<string, string>>;
  /** Nombres conocidos (que RLS permite leer) de sedes, categorías, estados, municipios, cuentas y trabajadores. */
  refs?: Partial<Record<RefKind, Readonly<Record<string, string>>>>;
};

export type FieldChange = { field: string; label: string; before: string; after: string };

export const EMPTY_VALUE = "(vacío)";
export const NOT_APPLICABLE = "—";
export const MAX_VALUE_LENGTH = 300;

/** Campos técnicos que no aportan al lector. */
const HIDDEN_FIELDS = new Set(["normalized_name", "updated_at", "updated_by", "change_reason"]);
/** En altas y bajas además se omiten los datos de control. */
const SNAPSHOT_HIDDEN = new Set([...HIDDEN_FIELDS, "id", "created_at", "created_by"]);

const REF_KIND: Record<string, RefKind> = {
  facility_id: "facility",
  category_id: "category",
  state_id: "state",
  municipality_id: "municipality",
  user_id: "profile",
  created_by: "profile",
  updated_by: "profile",
  granted_by: "profile",
  check_in_by: "profile",
  check_out_by: "profile",
  status_changed_by: "profile",
  requested_by: "profile",
  reviewed_by: "profile",
  worker_id: "worker",
  substitute_for_worker_id: "worker",
  responsible_worker_id: "worker",
};

const UNKNOWN_REF_PREFIX: Partial<Record<RefKind, string>> = { profile: "Usuario", worker: "Trabajador" };

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIELD_ORDER = Object.keys(FIELD_LABELS);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function truncate(value: string, max = MAX_VALUE_LENGTH): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

function refName(field: string, raw: string, ctx: ValueContext): string | null {
  const kind = REF_KIND[field];
  if (!kind) return null;
  const map = ctx.refs?.[kind];
  const name = map && Object.prototype.hasOwnProperty.call(map, raw) ? map[raw] : undefined;
  if (name) return name;
  const prefix = UNKNOWN_REF_PREFIX[kind];
  return prefix ? `${prefix} ${shortId(raw)}` : null;
}

/** Identificadores referenciados en los datos de los eventos (para buscar sus nombres). */
export function collectRefIds(events: readonly Pick<AuditEventData, "old_data" | "new_data">[], kind: RefKind): string[] {
  const out = new Set<string>();
  for (const e of events) {
    for (const data of [e.old_data, e.new_data]) {
      if (!isPlainObject(data)) continue;
      for (const [field, value] of Object.entries(data)) {
        if (REF_KIND[field] !== kind) continue;
        if (typeof value === "string" && value) out.add(value);
        else if (typeof value === "number" && Number.isFinite(value)) out.add(String(value));
      }
    }
  }
  return [...out];
}

function textField(data: Record<string, unknown>, field: string): string | null {
  const v = data[field];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Qué registro cambió, en palabras (nombre de la instalación, del trabajador,
 * de la guardia…). null si no se puede describir sin exponer datos de más.
 */
export function auditSubject(event: AuditEventData & { record_id?: string | null }, ctx: ValueContext = {}): string | null {
  const data = { ...asObject(event.old_data), ...asObject(event.new_data) };
  const ref = (kind: RefKind, id: unknown) => (typeof id === "string" && id ? refName(kind === "worker" ? "worker_id" : "user_id", id, ctx) : null);
  switch (event.table_name) {
    case "facilities":
      return textField(data, "official_name");
    case "workers":
      return textField(data, "full_name");
    case "facility_categories":
      return textField(data, "name");
    case "profiles":
      return textField(data, "display_name") ?? ref("profile", data.id);
    case "worker_private":
    case "shift_assignments":
    case "attendance_sessions":
    case "correction_requests":
    case "incident_notes":
      return ref("worker", data.worker_id);
    case "shifts":
      return textField(data, "title") ?? textField(data, "meeting_point");
    case "user_facility_scopes": {
      const who = ref("profile", data.user_id);
      const facilities = ctx.refs?.facility;
      const where =
        typeof data.facility_id === "string" && facilities && Object.prototype.hasOwnProperty.call(facilities, data.facility_id)
          ? facilities[data.facility_id]
          : null;
      return who && where ? `${who} → ${where}` : who;
    }
    case "app_settings": {
      const key = textField(data, "key") ?? event.record_id ?? null;
      return key ? (SETTING_KEY_LABELS[key] ?? key) : null;
    }
    default:
      return null;
  }
}

/** Valor legible de un campo de la bitácora. */
export function formatAuditValue(table: string, field: string, value: unknown, ctx: ValueContext = {}): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return EMPTY_VALUE;
    return refName(field, String(value), ctx) ?? String(value);
  }
  if (typeof value === "string") {
    if (value.trim() === "") return EMPTY_VALUE;
    const ref = refName(field, value, ctx);
    if (ref) return ref;
    const label = enumValueLabel(table, field, value, ctx.roleLabels);
    if (label) return label;
    if (ISO_TIMESTAMP.test(value)) {
      const t = Date.parse(value);
      if (Number.isFinite(t)) return formatDateTime(t, ctx.timeZone);
    }
    const date = ISO_DATE.exec(value);
    if (date) return `${date[3]}/${date[2]}/${date[1]}`;
    return truncate(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "(sin elementos)";
    return truncate(value.map((v) => (typeof v === "string" ? v : formatAuditValue(table, field, v, ctx))).join(", "));
  }
  return truncate(JSON.stringify(value));
}

function orderIndex(field: string): number {
  const i = FIELD_ORDER.indexOf(field);
  return i === -1 ? FIELD_ORDER.length : i;
}

function byFieldOrder(a: string, b: string): number {
  return orderIndex(a) - orderIndex(b) || a.localeCompare(b);
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
}

/** Cambios dentro de app_settings.value (un objeto JSON). */
export function settingValueChanges(before: unknown, after: unknown, ctx: ValueContext = {}): FieldChange[] {
  const oldObj = asObject(before);
  const newObj = asObject(after);
  const keys = [...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])].sort();
  return keys
    .filter((k) => !sameJson(oldObj[k], newObj[k]))
    .map((k) => ({
      field: `value.${k}`,
      label: SETTING_FIELD_LABELS[k] ?? k,
      before: k in oldObj ? formatAuditValue("app_settings", k, oldObj[k], ctx) : NOT_APPLICABLE,
      after: k in newObj ? formatAuditValue("app_settings", k, newObj[k], ctx) : NOT_APPLICABLE,
    }));
}

function snapshot(table: string, data: Record<string, unknown>, side: "before" | "after", ctx: ValueContext, hide: Set<string>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of Object.keys(data).sort(byFieldOrder)) {
    if (hide.has(field) || isEmptyValue(data[field])) continue;
    if (table === "app_settings" && field === "value" && isPlainObject(data[field])) {
      const nested = side === "after" ? settingValueChanges({}, data[field], ctx) : settingValueChanges(data[field], {}, ctx);
      out.push(...nested);
      continue;
    }
    const text = formatAuditValue(table, field, data[field], ctx);
    out.push({
      field,
      label: fieldLabel(table, field),
      before: side === "before" ? text : NOT_APPLICABLE,
      after: side === "after" ? text : NOT_APPLICABLE,
    });
  }
  return out;
}

/**
 * Lista de campos de un evento:
 * - Modificación: campos de `changed_fields` (o los que difieren), anterior → nuevo.
 * - Alta: valores registrados (— → valor).
 * - Eliminación: valores que tenía (valor → —).
 * - Depuración: resumen de lo eliminado.
 */
export function auditFieldChanges(event: AuditEventData, ctx: ValueContext = {}): FieldChange[] {
  const table = event.table_name;
  const oldObj = asObject(event.old_data);
  const newObj = asObject(event.new_data);

  if (event.action === "INSERT") return snapshot(table, newObj, "after", ctx, SNAPSHOT_HIDDEN);
  if (event.action === "DELETE") return snapshot(table, oldObj, "before", ctx, SNAPSHOT_HIDDEN);
  if (event.action === "PURGE") return snapshot(table, newObj, "after", ctx, new Set());

  const candidates = event.changed_fields?.length
    ? event.changed_fields
    : [...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])].filter((k) => !sameJson(oldObj[k], newObj[k]));
  const out: FieldChange[] = [];
  for (const field of [...new Set(candidates)].filter((f) => !HIDDEN_FIELDS.has(f)).sort(byFieldOrder)) {
    if (table === "app_settings" && field === "value" && isPlainObject(oldObj[field]) && isPlainObject(newObj[field])) {
      out.push(...settingValueChanges(oldObj[field], newObj[field], ctx));
      continue;
    }
    out.push({
      field,
      label: fieldLabel(table, field),
      before: formatAuditValue(table, field, oldObj[field], ctx),
      after: formatAuditValue(table, field, newObj[field], ctx),
    });
  }
  return out;
}

/**
 * Zona horaria para las fechas del detalle de un evento: la de su sede
 * (p. ej. el inicio y término de una guardia) si se conoce; si no, la zona
 * por omisión. La fecha del evento en sí se muestra siempre en la zona por omisión.
 */
export function eventValueTimeZone(
  facilityId: string | null | undefined,
  facilityTimezones: Readonly<Record<string, string>>,
  fallback: string,
): string {
  if (!facilityId || !Object.prototype.hasOwnProperty.call(facilityTimezones, facilityId)) return fallback;
  const tz = facilityTimezones[facilityId];
  return tz && tz.trim() ? tz : fallback;
}

/** Texto breve para el resumen del detalle plegable. */
export function changesSummary(action: string, count: number): string {
  if (count === 0) return "Sin campos que mostrar";
  const fields = `${count} ${count === 1 ? "campo" : "campos"}`;
  switch (action) {
    case "UPDATE":
      return `Ver ${fields} modificado${count === 1 ? "" : "s"}`;
    case "INSERT":
      return `Ver datos registrados (${fields})`;
    case "DELETE":
      return `Ver datos eliminados (${fields})`;
    case "PURGE":
      return "Ver resumen de la depuración";
    default:
      return `Ver ${fields}`;
  }
}
