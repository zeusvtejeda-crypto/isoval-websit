/**
 * Filas de reporte por asignación (funciones puras).
 *
 * Toma el resultado de `loadShiftsWithAttendance` (que ya calculó cada
 * asignación con `summarizeAttendance`) y lo aplana para la tabla del
 * historial y las exportaciones. No recalcula tiempos: solo los copia.
 * Las horas se expresan en la zona horaria de la sede de cada guardia.
 */
import { formatInTimeZone } from "date-fns-tz";
import { totalize, type AttendanceStatus, type AttendanceSummary, type TotalsSummary } from "@/lib/attendance/calc";
import type { ShiftWithAttendance } from "@/lib/attendance/load";
import { ATTENDANCE_STATUS_LABELS, INCIDENT_LABELS } from "@/lib/attendance/labels";
import { DEFAULT_TIMEZONE, formatDate, formatDateTime, formatOffset, formatTime, isValidTimezone } from "@/lib/time";
import type { AttendanceFilter } from "./params";

export type ReportRow = {
  assignmentId: string;
  shiftId: string;
  workerId: string;
  workerName: string;
  workerCode: string | null;
  facilityId: string;
  facilityName: string;
  stateId: number | null;
  timeZone: string;
  /** Desfase de la zona al inicio de la guardia, p. ej. "GMT-7". */
  zoneOffset: string;
  /** Fecha local (zona de la sede) del inicio de la guardia: yyyy-MM-dd. */
  localDate: string;
  /** "sáb 17 oct 2026" */
  dateLabel: string;
  /** Inicio y término en UTC (ISO). */
  startsAt: string;
  endsAt: string;
  /** "17/10/2026 22:00" en la zona de la sede. */
  startLocal: string;
  endLocal: string;
  /** "22:00 – 06:00 (+1 día)" en la zona de la sede. */
  scheduleLabel: string;
  meetingPoint: string;
  status: AttendanceStatus;
  statusLabel: string;
  scheduledMinutes: number;
  withinScheduleMinutes: number;
  outsideScheduleMinutes: number;
  totalMinutes: number;
  differenceMinutes: number;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  /** Permanencia adicional = tiempo registrado después del término (no son horas extra pagadas). */
  extraStayMinutes: number;
  firstCheckInLocal: string | null;
  lastCheckOutLocal: string | null;
  substitution: boolean;
  substituteForName: string | null;
  corrected: boolean;
  incomplete: boolean;
  /** Tiene una entrada sin salida (no suma tiempo registrado). */
  openSession: boolean;
  needsReview: boolean;
  incidentLabels: string[];
  summary: AttendanceSummary;
};

export type BuildRowsOptions = {
  /** Fecha local (zona de la sede) inicial del inicio de la guardia, inclusive. */
  desde?: string | null;
  /** Fecha local (zona de la sede) final del inicio de la guardia, inclusive. */
  hasta?: string | null;
  workerId?: string | null;
  attendance?: AttendanceFilter;
  /** Excluye guardias que aún no inician (requiere `now`). */
  onlyStarted?: boolean;
  now?: Date;
};

function zoneOf(tz: string | null | undefined): string {
  return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** "22:00 – 06:00 (+1 día)": horas locales de la sede; indica si termina otro día. */
export function timeRangeLabel(startsAt: string | Date, endsAt: string | Date, tz?: string | null): string {
  const zone = zoneOf(tz);
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const base = `${formatTime(start, zone)} – ${formatTime(end, zone)}`;
  const startDay = formatInTimeZone(start, zone, "yyyy-MM-dd");
  const endDay = formatInTimeZone(end, zone, "yyyy-MM-dd");
  if (startDay === endDay) return base;
  const days = Math.round((Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / 86_400_000);
  return `${base} (+${days} día${days === 1 ? "" : "s"})`;
}

function matchesAttendance(summary: AttendanceSummary, filter: AttendanceFilter | undefined): boolean {
  switch (filter ?? "") {
    case "":
      return summary.status !== "cancelada";
    case "todas":
      return true;
    case "revision":
      return summary.needsReview;
    default:
      return summary.status === filter;
  }
}

const collator = new Intl.Collator("es-MX", { sensitivity: "base" });

/**
 * Aplana guardias → filas por asignación, filtra y ordena por fecha
 * (luego sede y nombre, alfabéticamente). Nunca ordena por desempeño.
 */
export function buildReportRows(shifts: ShiftWithAttendance[], options: BuildRowsOptions = {}): ReportRow[] {
  const now = options.now ?? new Date();
  const rows: ReportRow[] = [];

  for (const item of shifts) {
    const { shift } = item;
    if (options.onlyStarted && Date.parse(shift.starts_at) > now.getTime()) continue;
    const tz = zoneOf(item.facility?.timezone);
    const localDate = formatInTimeZone(new Date(shift.starts_at), tz, "yyyy-MM-dd");
    if (options.desde && localDate < options.desde) continue;
    if (options.hasta && localDate > options.hasta) continue;

    for (const a of item.assignments) {
      if (options.workerId && a.assignment.worker_id !== options.workerId) continue;
      const s = a.summary;
      if (!matchesAttendance(s, options.attendance)) continue;

      const has = (type: (typeof s.incidents)[number]["type"]) => s.incidents.some((i) => i.type === type);
      rows.push({
        assignmentId: a.assignment.id,
        shiftId: shift.id,
        workerId: a.assignment.worker_id,
        workerName: a.worker?.full_name ?? "Persona no visible",
        workerCode: a.worker?.internal_code ?? null,
        facilityId: shift.facility_id,
        facilityName: item.facility?.official_name ?? "Sede no visible",
        stateId: item.facility?.state_id ?? null,
        timeZone: tz,
        zoneOffset: formatOffset(shift.starts_at, tz),
        localDate,
        dateLabel: formatDate(shift.starts_at, tz),
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
        startLocal: formatDateTime(shift.starts_at, tz),
        endLocal: formatDateTime(shift.ends_at, tz),
        scheduleLabel: timeRangeLabel(shift.starts_at, shift.ends_at, tz),
        meetingPoint: shift.meeting_point,
        status: s.status,
        statusLabel: ATTENDANCE_STATUS_LABELS[s.status],
        scheduledMinutes: s.scheduledMinutes,
        withinScheduleMinutes: s.withinScheduleMinutes,
        outsideScheduleMinutes: s.outsideScheduleMinutes,
        totalMinutes: s.totalMinutes,
        differenceMinutes: s.differenceMinutes,
        lateMinutes: s.lateMinutes,
        earlyLeaveMinutes: s.earlyLeaveMinutes,
        extraStayMinutes: s.afterEndMinutes,
        firstCheckInLocal: s.firstCheckIn ? formatDateTime(s.firstCheckIn, tz) : null,
        lastCheckOutLocal: s.lastCheckOut ? formatDateTime(s.lastCheckOut, tz) : null,
        substitution: has("sustitucion"),
        substituteForName: a.substituteFor?.full_name ?? null,
        corrected: has("correccion_administrativa"),
        incomplete: s.status === "registro_incompleto",
        openSession: s.openSession != null,
        needsReview: s.needsReview,
        incidentLabels: s.incidents.map((i) => INCIDENT_LABELS[i.type]),
        summary: s,
      });
    }
  }

  return rows.sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      collator.compare(a.facilityName, b.facilityName) ||
      collator.compare(a.workerName, b.workerName) ||
      a.assignmentId.localeCompare(b.assignmentId),
  );
}

/** Totales de las filas (mismas reglas que `totalize`: las canceladas no suman). */
export function reportTotals(rows: ReportRow[]): TotalsSummary {
  return totalize(rows.map((r) => r.summary));
}

export type GroupSummary = { key: string; label: string; detail: string | null; totals: TotalsSummary };

/**
 * Totales agrupados por sede o por trabajador, en orden ALFABÉTICO.
 * No es una clasificación ni un ranking.
 */
export function summarizeBy(rows: ReportRow[], by: "facility" | "worker"): GroupSummary[] {
  const groups = new Map<string, { label: string; detail: string | null; rows: ReportRow[] }>();
  for (const r of rows) {
    const key = by === "facility" ? r.facilityId : r.workerId;
    const label = by === "facility" ? r.facilityName : r.workerName;
    const detail = by === "facility" ? null : r.workerCode;
    const g = groups.get(key) ?? { label, detail, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, detail: g.detail, totals: reportTotals(g.rows) }))
    .sort((a, b) => collator.compare(a.label, b.label) || a.key.localeCompare(b.key));
}
