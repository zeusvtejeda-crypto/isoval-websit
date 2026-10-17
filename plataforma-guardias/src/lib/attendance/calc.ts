/**
 * Cálculo de asistencia por asignación (funciones puras, sin dependencias).
 *
 * Reglas:
 * - Solo cuentan sesiones vigentes (las corregidas/anuladas se conservan pero no suman).
 * - Una entrada sin salida NO suma tiempo registrado y se marca para revisión
 *   cuando la guardia terminó hace más del margen configurado.
 * - El tiempo entre una salida y un regreso no cuenta como presencia.
 * - Intervalos superpuestos no se cuentan dos veces.
 * - "Permanencia adicional" = tiempo registrado después del término; NO son horas extra pagadas.
 * - Nada aquí sanciona: las incidencias son señales para revisión humana.
 */

export type AttendanceStatus =
  | "pendiente"
  | "en_servicio"
  | "finalizada"
  | "ausencia_justificada"
  | "inasistencia_confirmada"
  | "registro_incompleto"
  | "cancelada";

export type IncidentType =
  | "llegada_tardia"
  | "salida_anticipada"
  | "permanencia_adicional"
  | "sustitucion"
  | "correccion_administrativa"
  | "registro_incompleto";

export type AssignmentStatus = "asignado" | "ausencia_justificada" | "inasistencia_confirmada" | "cancelado";
export type ShiftStatus = "programada" | "en_curso" | "finalizada" | "cancelada";
export type RecordStatus = "vigente" | "corregido" | "anulado";
export type AttendanceMethod = "propio" | "coordinador" | "qr" | "correccion";

type DateLike = Date | string;

export interface SessionInput {
  id: string;
  checkInAt: DateLike;
  checkOutAt: DateLike | null;
  recordStatus?: RecordStatus;
  checkInMethod?: AttendanceMethod;
  checkOutMethod?: AttendanceMethod | null;
  supersedesId?: string | null;
}

export interface ShiftInput {
  startsAt: DateLike;
  endsAt: DateLike;
  status?: ShiftStatus;
}

export interface AssignmentInput {
  status: AssignmentStatus;
  substituteForWorkerId?: string | null;
}

export interface CalcOptions {
  /** Tolerancia de llegada de la sede (minutos). */
  toleranceMinutes: number;
  /** Margen tras el término para considerar una entrada abierta como incompleta. */
  openSessionGraceMinutes?: number;
  now?: Date;
}

export interface Incident {
  type: IncidentType;
  minutes?: number;
}

export interface AttendanceSummary {
  status: AttendanceStatus;
  scheduledMinutes: number;
  /** Tiempo registrado dentro del horario programado. */
  withinScheduleMinutes: number;
  /** Tiempo registrado fuera del horario (antes del inicio o después del término). */
  outsideScheduleMinutes: number;
  /** Tiempo registrado antes del inicio. */
  beforeStartMinutes: number;
  /** Tiempo registrado después del término (permanencia adicional). */
  afterEndMinutes: number;
  /** Tiempo total registrado (sesiones cerradas, sin doble conteo). */
  totalMinutes: number;
  /** Registrado − programado. */
  differenceMinutes: number;
  /** Tiempo entre salidas y regresos dentro de la guardia (no cuenta). */
  gapMinutes: number;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  firstCheckIn: Date | null;
  lastCheckOut: Date | null;
  openSession: SessionInput | null;
  /** Minutos desde la entrada abierta (informativo; no suma horas completadas). */
  openElapsedMinutes: number | null;
  /** Tuvo registros y ya no tiene entrada abierta. */
  hasLeft: boolean;
  needsReview: boolean;
  incidents: Incident[];
  sessionsCount: number;
}

type Interval = [number, number];

const MINUTE = 60_000;

function ms(value: DateLike): number {
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`Fecha inválida: ${String(value)}`);
  return t;
}

/** Une intervalos superpuestos o contiguos. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter(([s, e]) => e > s)
    .map(([s, e]) => [s, e] as Interval)
    .sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      out.push([cur[0], cur[1]]);
    }
  }
  return out;
}

export function overlapMs(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

function sumOverlap(intervals: Interval[], window: Interval): number {
  return intervals.reduce((acc, iv) => acc + overlapMs(iv, window), 0);
}

const toMin = (value: number) => Math.floor(value / MINUTE);

export function summarizeAttendance(
  shift: ShiftInput,
  assignment: AssignmentInput,
  sessions: SessionInput[],
  options: CalcOptions,
): AttendanceSummary {
  const now = (options.now ?? new Date()).getTime();
  const start = ms(shift.startsAt);
  const end = ms(shift.endsAt);
  const tolerance = Math.max(0, options.toleranceMinutes) * MINUTE;
  const grace = Math.max(0, options.openSessionGraceMinutes ?? 240) * MINUTE;

  const valid = sessions.filter((s) => (s.recordStatus ?? "vigente") === "vigente");
  const closed = valid.filter((s) => s.checkOutAt != null);
  const open = valid.filter((s) => s.checkOutAt == null);
  const openSession =
    open.sort((a, b) => ms(b.checkInAt) - ms(a.checkInAt))[0] ?? null;

  const merged = mergeIntervals(closed.map((s) => [ms(s.checkInAt), ms(s.checkOutAt as DateLike)]));

  const withinMs = sumOverlap(merged, [start, end]);
  const beforeMs = sumOverlap(merged, [Number.NEGATIVE_INFINITY, start]);
  const afterMs = sumOverlap(merged, [end, Number.POSITIVE_INFINITY]);

  const withinScheduleMinutes = toMin(withinMs);
  const beforeStartMinutes = toMin(beforeMs);
  const afterEndMinutes = toMin(afterMs);
  const outsideScheduleMinutes = beforeStartMinutes + afterEndMinutes;
  const totalMinutes = withinScheduleMinutes + outsideScheduleMinutes;
  const scheduledMinutes = toMin(end - start);

  // Huecos entre sesiones (salida y regreso) dentro del horario.
  let gapMs = 0;
  for (let i = 1; i < merged.length; i++) {
    gapMs += overlapMs([merged[i - 1][1], merged[i][0]], [start, end]);
  }

  const allStarts = valid.map((s) => ms(s.checkInAt));
  const firstIn = allStarts.length ? Math.min(...allStarts) : null;
  const lastOut = !openSession && closed.length ? Math.max(...closed.map((s) => ms(s.checkOutAt as DateLike))) : null;

  const incidents: Incident[] = [];

  let lateMinutes: number | null = null;
  if (firstIn != null && firstIn > start + tolerance) {
    lateMinutes = toMin(firstIn - start);
    incidents.push({ type: "llegada_tardia", minutes: lateMinutes });
  }

  let earlyLeaveMinutes: number | null = null;
  if (lastOut != null && now >= end && lastOut < end) {
    earlyLeaveMinutes = toMin(end - lastOut);
    if (earlyLeaveMinutes > 0) {
      incidents.push({ type: "salida_anticipada", minutes: earlyLeaveMinutes });
    } else {
      earlyLeaveMinutes = null;
    }
  }

  if (afterEndMinutes > 0) {
    incidents.push({ type: "permanencia_adicional", minutes: afterEndMinutes });
  }

  if (assignment.substituteForWorkerId) {
    incidents.push({ type: "sustitucion" });
  }

  const corrected = valid.some(
    (s) => s.supersedesId || s.checkInMethod === "correccion" || s.checkOutMethod === "correccion",
  );
  if (corrected) {
    incidents.push({ type: "correccion_administrativa" });
  }

  const openIsStale = openSession != null && now > end + grace;
  if (openIsStale) {
    incidents.push({ type: "registro_incompleto" });
  }

  let status: AttendanceStatus;
  if (assignment.status === "cancelado" || shift.status === "cancelada") {
    status = "cancelada";
  } else if (assignment.status === "ausencia_justificada") {
    status = "ausencia_justificada";
  } else if (assignment.status === "inasistencia_confirmada") {
    status = "inasistencia_confirmada";
  } else if (openSession) {
    status = openIsStale ? "registro_incompleto" : "en_servicio";
  } else if (closed.length > 0) {
    status = "finalizada";
  } else {
    status = "pendiente";
  }

  const noShowPendingReview =
    status === "pendiente" && now >= end && assignment.status === "asignado";

  return {
    status,
    scheduledMinutes,
    withinScheduleMinutes,
    outsideScheduleMinutes,
    beforeStartMinutes,
    afterEndMinutes,
    totalMinutes,
    differenceMinutes: totalMinutes - scheduledMinutes,
    gapMinutes: toMin(gapMs),
    lateMinutes,
    earlyLeaveMinutes,
    firstCheckIn: firstIn != null ? new Date(firstIn) : null,
    lastCheckOut: lastOut != null ? new Date(lastOut) : null,
    openSession,
    openElapsedMinutes: openSession ? Math.max(0, toMin(now - ms(openSession.checkInAt))) : null,
    hasLeft: valid.length > 0 && !openSession,
    needsReview: openIsStale || noShowPendingReview,
    incidents,
    sessionsCount: valid.length,
  };
}

export interface TotalsSummary {
  assignments: number;
  scheduledMinutes: number;
  withinScheduleMinutes: number;
  outsideScheduleMinutes: number;
  afterEndMinutes: number;
  totalMinutes: number;
  differenceMinutes: number;
  late: number;
  earlyLeave: number;
  extraStay: number;
  substitutions: number;
  corrections: number;
  incomplete: number;
  justifiedAbsences: number;
  confirmedAbsences: number;
  pendingReview: number;
}

/** Suma resúmenes (p. ej. historial de un trabajador o reporte por sede). */
export function totalize(summaries: AttendanceSummary[]): TotalsSummary {
  const t: TotalsSummary = {
    assignments: 0,
    scheduledMinutes: 0,
    withinScheduleMinutes: 0,
    outsideScheduleMinutes: 0,
    afterEndMinutes: 0,
    totalMinutes: 0,
    differenceMinutes: 0,
    late: 0,
    earlyLeave: 0,
    extraStay: 0,
    substitutions: 0,
    corrections: 0,
    incomplete: 0,
    justifiedAbsences: 0,
    confirmedAbsences: 0,
    pendingReview: 0,
  };
  for (const s of summaries) {
    if (s.status === "cancelada") continue;
    t.assignments += 1;
    t.scheduledMinutes += s.scheduledMinutes;
    t.withinScheduleMinutes += s.withinScheduleMinutes;
    t.outsideScheduleMinutes += s.outsideScheduleMinutes;
    t.afterEndMinutes += s.afterEndMinutes;
    t.totalMinutes += s.totalMinutes;
    t.differenceMinutes += s.differenceMinutes;
    const has = (type: IncidentType) => s.incidents.some((i) => i.type === type);
    if (has("llegada_tardia")) t.late += 1;
    if (has("salida_anticipada")) t.earlyLeave += 1;
    if (has("permanencia_adicional")) t.extraStay += 1;
    if (has("sustitucion")) t.substitutions += 1;
    if (has("correccion_administrativa")) t.corrections += 1;
    if (s.status === "registro_incompleto") t.incomplete += 1;
    if (s.status === "ausencia_justificada") t.justifiedAbsences += 1;
    if (s.status === "inasistencia_confirmada") t.confirmedAbsences += 1;
    if (s.needsReview) t.pendingReview += 1;
  }
  return t;
}
