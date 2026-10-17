/**
 * Filtros de la bitácora por URL (GET). Lógica pura.
 */
import { dayRangeUtc } from "@/lib/time";
import { isAuditAction, type AuditAction } from "./audit-labels";
import { shortId } from "./audit-diff";

export const AUDIT_PATH = "/administracion/bitacora";
export const AUDIT_PAGE_SIZE = 50;
const MAX_PAGE = 100_000;

export type AuditFilters = {
  table: string;
  action: AuditAction | "";
  /** yyyy-MM-dd (zona por omisión). */
  from: string;
  to: string;
  facilityId: string;
  actorId: string;
  page: number;
};

export const EMPTY_AUDIT_FILTERS: AuditFilters = { table: "", action: "", from: "", to: "", facilityId: "", actorId: "", page: 1 };

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: string | null | undefined): value is string {
  return !!value && GUID.test(value);
}

/** Fecha de calendario válida en formato yyyy-MM-dd. */
export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

export function parseAuditFilters(sp: RawParams, opts: { tables: readonly string[] }): AuditFilters {
  const table = first(sp.tabla);
  const action = first(sp.accion);
  let from = first(sp.desde);
  let to = first(sp.hasta);
  from = isIsoDay(from) ? from : "";
  to = isIsoDay(to) ? to : "";
  // Rango invertido: se corrige en lugar de devolver vacío.
  if (from && to && from > to) [from, to] = [to, from];
  const facilityId = first(sp.sede);
  const actorId = first(sp.autor);
  const rawPage = first(sp.pagina);
  const page = /^\d{1,6}$/.test(rawPage) ? Math.min(Math.max(1, Number(rawPage)), MAX_PAGE) : 1;
  return {
    table: opts.tables.includes(table) ? table : "",
    action: isAuditAction(action) ? action : "",
    from,
    to,
    facilityId: isGuid(facilityId) ? facilityId.toLowerCase() : "",
    actorId: isGuid(actorId) ? actorId.toLowerCase() : "",
    page,
  };
}

export function auditHref(filters: AuditFilters, overrides: Partial<AuditFilters> = {}): string {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (f.table) params.set("tabla", f.table);
  if (f.action) params.set("accion", f.action);
  if (f.from) params.set("desde", f.from);
  if (f.to) params.set("hasta", f.to);
  if (f.facilityId) params.set("sede", f.facilityId);
  if (f.actorId) params.set("autor", f.actorId);
  if (f.page > 1) params.set("pagina", String(f.page));
  const qs = params.toString();
  return qs ? `${AUDIT_PATH}?${qs}` : AUDIT_PATH;
}

export function hasAuditFilters(f: AuditFilters): boolean {
  return Boolean(f.table || f.action || f.from || f.to || f.facilityId || f.actorId);
}

/** Límites UTC del rango de días (incluye el día «hasta» completo). */
export function auditTimeRange(f: Pick<AuditFilters, "from" | "to">, timeZone?: string | null): { gte: string | null; lt: string | null } {
  return {
    gte: f.from ? dayRangeUtc(f.from, timeZone).start.toISOString() : null,
    lt: f.to ? dayRangeUtc(f.to, timeZone).end.toISOString() : null,
  };
}

export function pageCount(total: number, pageSize = AUDIT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

export function pageBounds(page: number, pageSize = AUDIT_PAGE_SIZE): { from: number; to: number } {
  const p = Math.max(1, Math.trunc(page));
  return { from: (p - 1) * pageSize, to: p * pageSize - 1 };
}

/** Autor del evento: nombre visible si se puede leer; si no, «Usuario <id corto>». */
export function actorDisplay(actorId: string | null | undefined, names: Readonly<Record<string, string>>): string {
  if (!actorId) return "Sistema (proceso automático)";
  const name = Object.prototype.hasOwnProperty.call(names, actorId) ? names[actorId] : undefined;
  return name && name.trim() ? name : `Usuario ${shortId(actorId)}`;
}
