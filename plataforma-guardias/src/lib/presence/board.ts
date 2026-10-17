/**
 * Tablero «Quién está aquí» (funciones puras).
 *
 * Recibe guardias ya calculadas con loadShiftsWithAttendance() y las agrupa en
 * secciones. No recalcula horas: solo usa el resumen de summarizeAttendance().
 * Las señales (retraso, salida anticipada, permanencia adicional, registro
 * incompleto) son para revisión humana; nunca sancionan ni ordenan a las
 * personas por desempeño.
 *
 * Responde las preguntas del tablero: quién tiene guardia, quién registró
 * llegada, quién continúa en servicio, quién se retiró, quién llegó tarde,
 * quién salió antes, quién se quedó después de su horario, quién cubrió a otra
 * persona, qué guardias están incompletas y (con enlaces) el historial de cada
 * trabajador.
 */
import type { AttendanceMethod } from "@/lib/attendance/calc";
import type { AssignmentWithAttendance, ShiftStatus, ShiftWithAttendance } from "@/lib/attendance/load";
import { coverageCurrent } from "@/lib/attendance/coverage";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { overlapsLocalDay, shiftPeriodOf, type ShiftPeriodFilter } from "./periods";

export type PresenceFilters = {
  /** Día local (yyyy-MM-dd) en la zona de cada sede. */
  day: string;
  period: ShiftPeriodFilter;
  facilityId?: string | null;
  /**
   * Además de las guardias del día: registros incompletos de guardias (misma
   * sede y turno) que terminaron desde esta fecha. Así una entrada olvidada de
   * ayer sigue visible para revisión en el tablero de hoy.
   */
  incompleteSince?: Date | null;
};

type ShiftRef = {
  shiftId: string;
  shiftTitle: string | null;
  facilityId: string;
  facilityName: string;
  timezone: string;
  meetingPoint: string;
  startsAt: string;
  endsAt: string;
};

export type BoardOptions = {
  /**
   * Margen (minutos) tras el término en que todavía se puede registrar la
   * salida con la hora actual (app_settings.attendance.open_session_grace_minutes).
   * Después, check_out la rechaza y se corrige con la hora real.
   */
  graceMinutes?: number | null;
};

type PersonRef = ShiftRef & {
  assignmentId: string;
  workerId: string | null;
  workerName: string;
  assignedPoint: string | null;
  /** Nombre de la persona a quien cubre (sustitución), o null. */
  substituteFor: string | null;
};

/** Incidencias de horario tomadas del resumen (señales para revisión, no sanciones). */
export type ScheduleIncidents = {
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  /** Tiempo registrado después del término (permanencia adicional, no horas extra pagadas). */
  afterEndMinutes: number;
};

export type InServiceEntry = PersonRef &
  ScheduleIncidents & {
    checkInAt: string;
    elapsedMinutes: number;
    method: AttendanceMethod;
    /** La entrada la registró coordinación (o es una corrección), no la persona. */
    registeredByStaff: boolean;
    isResponsible: boolean;
    /** La guardia ya terminó y la entrada sigue abierta (dentro del margen). */
    shiftEnded: boolean;
    /** Hasta cuándo se puede registrar la salida con la hora actual (término + margen), si se conoce el margen. */
    checkOutDeadline: string | null;
  };

export type ExpectedEntry = PersonRef & {
  shiftInProgress: boolean;
  /** Ya pasó inicio + tolerancia sin entrada registrada. */
  late: boolean;
  minutesSinceStart: number;
  toleranceMinutes: number;
};

export type LeftEntry = PersonRef &
  ScheduleIncidents & {
    checkOutAt: string;
    totalMinutes: number;
    method: AttendanceMethod | null;
  };

export type AbsenceStatus = "ausencia_justificada" | "inasistencia_confirmada";

export type AbsenceEntry = PersonRef & {
  status: AbsenceStatus;
  /** Motivo capturado por coordinación (shift_assignments.status_reason). */
  reason: string | null;
  changedAt: string | null;
};

export type IncompleteReason = "entrada_sin_salida" | "sin_registros";

export type IncompleteEntry = PersonRef & {
  reason: IncompleteReason;
  checkInAt: string | null;
};

export type ResponsiblePresence = "en_servicio" | "sin_entrada" | "ya_salio" | "ausente" | "sin_asignacion";

export type ResponsibleEntry = ShiftRef & {
  responsibleId: string;
  responsibleName: string;
  presence: ResponsiblePresence;
  checkInAt: string | null;
};

export type CoverageEntry = ShiftRef & {
  effectiveStatus: ShiftStatus;
  assigned: number;
  inService: number;
  attended: number;
  minStaff: number;
  maxStaff: number | null;
  /** Personas que faltan para el mínimo (en servicio si está en curso; con registro si terminó; asignadas si es futura). */
  missing: number;
};

export type IncidentCounts = {
  /** Personas (en servicio o que ya salieron) con llegada tardía. */
  late: number;
  earlyLeave: number;
  afterEnd: number;
  /** Asignaciones (no canceladas) de las guardias del filtro que cubren a otra persona. */
  substitutions: number;
};

export type PresenceBoard = {
  shiftCount: number;
  /** Asignaciones no canceladas en las guardias del filtro (quién tiene guardia). */
  rosterCount: number;
  inService: InServiceEntry[];
  responsibles: ResponsibleEntry[];
  expected: ExpectedEntry[];
  left: LeftEntry[];
  absences: AbsenceEntry[];
  uncovered: CoverageEntry[];
  incomplete: IncompleteEntry[];
  incidentCounts: IncidentCounts;
};

export const INCOMPLETE_REASON_LABELS: Record<IncompleteReason, string> = {
  entrada_sin_salida: "Entrada sin salida",
  sin_registros: "Sin registros al terminar la guardia",
};

export const RESPONSIBLE_PRESENCE_LABELS: Record<ResponsiblePresence, string> = {
  en_servicio: "En servicio",
  sin_entrada: "Sin entrada registrada",
  ya_salio: "Ya registró salida",
  ausente: "Ausencia o inasistencia registrada",
  sin_asignacion: "Sin asignación en guardias de este filtro",
};

export const ABSENCE_STATUS_LABELS: Record<AbsenceStatus, string> = {
  ausencia_justificada: "Ausencia justificada",
  inasistencia_confirmada: "Inasistencia confirmada tras revisión",
};

/** Opción «todas» del filtro de sedes: administración ve todas; los demás, solo las suyas. */
export function allFacilitiesLabel(isAdmin: boolean): string {
  return isAdmin ? "Todas las sedes" : "Todas mis sedes";
}

/** Historial individual del trabajador. */
export function workerHistoryHref(workerId: string): string {
  return `/historial/trabajador/${encodeURIComponent(workerId)}`;
}

/**
 * Etiquetas de texto de las incidencias de una persona (en el orden en que se
 * muestran). Son señales para revisión; no sanciones.
 */
export function incidentLabels(entry: Partial<ScheduleIncidents> & { substituteFor?: string | null }): string[] {
  const out: string[] = [];
  if (entry.lateMinutes != null && entry.lateMinutes > 0) out.push(`Llegada tardía ${entry.lateMinutes} min`);
  if (entry.earlyLeaveMinutes != null && entry.earlyLeaveMinutes > 0) out.push(`Salida anticipada ${entry.earlyLeaveMinutes} min`);
  if (entry.afterEndMinutes != null && entry.afterEndMinutes > 0) {
    out.push(`Permanencia adicional ${entry.afterEndMinutes} min (tiempo registrado adicional)`);
  }
  if (entry.substituteFor) out.push(`Cubre a ${entry.substituteFor}`);
  return out;
}

const MINUTE = 60_000;

function isCancelled(item: ShiftWithAttendance): boolean {
  return item.shift.status === "cancelada" || item.effectiveStatus === "cancelada";
}

/** ¿La guardia es de la sede y del turno filtrados (turno por hora local de inicio)? */
function matchesFacilityAndPeriod(item: ShiftWithAttendance, filters: PresenceFilters): boolean {
  if (filters.facilityId && item.shift.facility_id !== filters.facilityId) return false;
  const tz = item.facility?.timezone ?? DEFAULT_TIMEZONE;
  if (filters.period !== "todos" && shiftPeriodOf(item.shift.starts_at, tz) !== filters.period) return false;
  return true;
}

/** ¿La guardia entra en los filtros (sede, día local y turno por hora local de inicio)? */
export function shiftMatchesFilters(item: ShiftWithAttendance, filters: PresenceFilters): boolean {
  if (!matchesFacilityAndPeriod(item, filters)) return false;
  const tz = item.facility?.timezone ?? DEFAULT_TIMEZONE;
  return overlapsLocalDay(item.shift.starts_at, item.shift.ends_at, filters.day, tz);
}

/** Motivo de revisión de una asignación (o null si no requiere revisión). */
function incompleteEntry(item: ShiftWithAttendance, a: AssignmentWithAttendance, nowMs: number): IncompleteEntry | null {
  if (a.assignment.status === "cancelado") return null;
  const s = a.summary;
  if (s.status === "registro_incompleto") {
    return { ...personRef(item, a), reason: "entrada_sin_salida", checkInAt: s.openSession ? toIso(s.openSession.checkInAt) : null };
  }
  if (s.status === "pendiente" && a.assignment.status === "asignado" && s.needsReview && nowMs >= Date.parse(item.shift.ends_at)) {
    return { ...personRef(item, a), reason: "sin_registros", checkInAt: null };
  }
  return null;
}

function shiftRef(item: ShiftWithAttendance): ShiftRef {
  return {
    shiftId: item.shift.id,
    shiftTitle: item.shift.title,
    facilityId: item.shift.facility_id,
    facilityName: item.facility?.official_name ?? "Sede no disponible",
    timezone: item.facility?.timezone ?? DEFAULT_TIMEZONE,
    meetingPoint: item.shift.meeting_point,
    startsAt: item.shift.starts_at,
    endsAt: item.shift.ends_at,
  };
}

function personRef(item: ShiftWithAttendance, a: AssignmentWithAttendance): PersonRef {
  return {
    ...shiftRef(item),
    assignmentId: a.assignment.id,
    workerId: a.worker?.id ?? a.assignment.worker_id ?? null,
    workerName: a.worker?.full_name ?? "Persona no disponible",
    assignedPoint: a.assignment.assigned_point,
    // RLS puede ocultar el nombre de la persona cubierta (p. ej. de otra sede).
    substituteFor: a.substituteFor?.full_name ?? (a.assignment.substitute_for_worker_id ? "otra persona" : null),
  };
}

function scheduleIncidents(a: AssignmentWithAttendance): ScheduleIncidents {
  const s = a.summary;
  return {
    lateMinutes: s.lateMinutes != null && s.lateMinutes > 0 ? s.lateMinutes : null,
    earlyLeaveMinutes: s.earlyLeaveMinutes != null && s.earlyLeaveMinutes > 0 ? s.earlyLeaveMinutes : null,
    afterEndMinutes: Math.max(0, s.afterEndMinutes),
  };
}

function isAbsence(status: string): status is AbsenceStatus {
  return status === "ausencia_justificada" || status === "inasistencia_confirmada";
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function inServiceEntry(item: ShiftWithAttendance, a: AssignmentWithAttendance, nowMs: number, graceMs: number | null): InServiceEntry {
  const open = a.summary.openSession;
  if (!open) throw new Error("inServiceEntry requiere una entrada abierta");
  const endMs = Date.parse(item.shift.ends_at);
  const base = personRef(item, a);
  const checkInAt = toIso(open.checkInAt);
  const method = open.checkInMethod ?? "propio";
  const shiftEnded = nowMs >= endMs;
  const responsibleId = item.responsible?.id ?? null;
  return {
    ...base,
    ...scheduleIncidents(a),
    checkInAt,
    elapsedMinutes: Math.max(0, Math.floor((nowMs - Date.parse(checkInAt)) / MINUTE)),
    method,
    registeredByStaff: method !== "propio",
    isResponsible: responsibleId != null && base.workerId === responsibleId,
    shiftEnded,
    checkOutDeadline: shiftEnded && graceMs != null ? new Date(endMs + graceMs).toISOString() : null,
  };
}

function presenceOf(a: AssignmentWithAttendance): { presence: ResponsiblePresence; checkInAt: string | null } {
  const s = a.summary;
  if (s.status === "en_servicio" && s.openSession) return { presence: "en_servicio", checkInAt: toIso(s.openSession.checkInAt) };
  if (isAbsence(a.assignment.status)) return { presence: "ausente", checkInAt: null };
  if (s.hasLeft) return { presence: "ya_salio", checkInAt: null };
  return { presence: "sin_entrada", checkInAt: null };
}

export function buildPresenceBoard(shifts: ShiftWithAttendance[], now: Date, filters: PresenceFilters, options: BoardOptions = {}): PresenceBoard {
  const nowMs = now.getTime();
  const graceMs = options.graceMinutes != null && Number.isFinite(options.graceMinutes) ? Math.max(0, options.graceMinutes) * MINUTE : null;
  const selected = shifts.filter((s) => !isCancelled(s) && shiftMatchesFilters(s, filters));
  const selectedIds = new Set(selected.map((s) => s.shift.id));
  const sinceMs = filters.incompleteSince ? filters.incompleteSince.getTime() : null;
  // Guardias anteriores (fuera del día) que solo aportan registros incompletos.
  const lookback =
    sinceMs == null
      ? []
      : shifts.filter((s) => {
          if (isCancelled(s) || selectedIds.has(s.shift.id) || !matchesFacilityAndPeriod(s, filters)) return false;
          const endMs = Date.parse(s.shift.ends_at);
          return endMs >= sinceMs && endMs <= nowMs;
        });

  const inService: InServiceEntry[] = [];
  const expected: ExpectedEntry[] = [];
  const left: LeftEntry[] = [];
  const absences: AbsenceEntry[] = [];
  const incomplete: IncompleteEntry[] = [];
  let rosterCount = 0;
  let substitutions = 0;
  const responsibles: ResponsibleEntry[] = [];
  const uncovered: CoverageEntry[] = [];

  // Índice para saber si un responsable está en servicio en cualquier guardia del filtro.
  const byWorker = new Map<string, AssignmentWithAttendance[]>();
  for (const item of selected) {
    for (const a of item.assignments) {
      const wid = a.worker?.id ?? a.assignment.worker_id;
      if (!wid) continue;
      const list = byWorker.get(wid) ?? [];
      list.push(a);
      byWorker.set(wid, list);
    }
  }

  for (const item of selected) {
    const startMs = Date.parse(item.shift.starts_at);
    const endMs = Date.parse(item.shift.ends_at);
    const tolerance = item.facility?.arrival_tolerance_minutes ?? 10;

    for (const a of item.assignments) {
      if (a.assignment.status === "cancelado") continue;
      const s = a.summary;
      const base = personRef(item, a);
      rosterCount += 1;
      if (base.substituteFor) substitutions += 1;

      if (isAbsence(a.assignment.status)) {
        absences.push({
          ...base,
          status: a.assignment.status,
          reason: a.assignment.status_reason?.trim() || null,
          changedAt: a.assignment.status_changed_at ? toIso(a.assignment.status_changed_at) : null,
        });
      } else if (s.status === "en_servicio" && s.openSession) {
        inService.push(inServiceEntry(item, a, nowMs, graceMs));
      } else if (s.status === "registro_incompleto") {
        const entry = incompleteEntry(item, a, nowMs);
        if (entry) incomplete.push(entry);
      } else if (s.status === "finalizada" && s.hasLeft && s.lastCheckOut) {
        const lastSession = a.sessions
          .filter((x) => x.record_status === "vigente" && x.check_out_at)
          .sort((x, y) => Date.parse(y.check_out_at as string) - Date.parse(x.check_out_at as string))[0];
        left.push({
          ...base,
          ...scheduleIncidents(a),
          checkOutAt: toIso(s.lastCheckOut),
          totalMinutes: s.totalMinutes,
          method: lastSession?.check_out_method ?? null,
        });
      } else if (s.status === "pendiente" && a.assignment.status === "asignado") {
        // Una guardia cerrada manualmente por coordinación ya no espera llegadas.
        if (nowMs < endMs && item.effectiveStatus !== "finalizada") {
          const sinceStart = Math.floor((nowMs - startMs) / MINUTE);
          expected.push({
            ...base,
            shiftInProgress: nowMs >= startMs,
            late: nowMs > startMs + tolerance * MINUTE,
            minutesSinceStart: sinceStart,
            toleranceMinutes: tolerance,
          });
        } else {
          const entry = incompleteEntry(item, a, nowMs);
          if (entry) incomplete.push(entry);
        }
      }
    }

    if (item.responsible) {
      const own = item.assignments.find((a) => (a.worker?.id ?? a.assignment.worker_id) === item.responsible?.id);
      let presence: ResponsiblePresence = "sin_asignacion";
      let checkInAt: string | null = null;
      if (own && own.assignment.status !== "cancelado") {
        ({ presence, checkInAt } = presenceOf(own));
      } else {
        const elsewhere = (byWorker.get(item.responsible.id) ?? []).filter((a) => a.assignment.status !== "cancelado");
        const active = elsewhere.find((a) => a.summary.status === "en_servicio");
        if (active) ({ presence, checkInAt } = presenceOf(active));
        else if (elsewhere.length > 0) ({ presence, checkInAt } = presenceOf(elsewhere[0]));
      }
      responsibles.push({
        ...shiftRef(item),
        responsibleId: item.responsible.id,
        responsibleName: item.responsible.full_name,
        presence,
        checkInAt,
      });
    }

    if (item.coverage.insufficient) {
      const current = coverageCurrent(item.effectiveStatus, item.coverage).count;
      uncovered.push({
        ...shiftRef(item),
        effectiveStatus: item.effectiveStatus,
        assigned: item.coverage.assigned,
        inService: item.coverage.inService,
        attended: item.coverage.attended,
        minStaff: item.coverage.minStaff,
        maxStaff: item.coverage.maxStaff,
        missing: Math.max(0, item.coverage.minStaff - current),
      });
    }
  }

  for (const item of lookback) {
    for (const a of item.assignments) {
      // Guardia de un día anterior con la entrada aún abierta dentro del margen
      // (p. ej. terminó a las 22:00 y ya pasó la medianoche): sigue en servicio.
      if (a.assignment.status !== "cancelado" && !isAbsence(a.assignment.status) && a.summary.status === "en_servicio" && a.summary.openSession) {
        inService.push(inServiceEntry(item, a, nowMs, graceMs));
        continue;
      }
      const entry = incompleteEntry(item, a, nowMs);
      if (entry) incomplete.push(entry);
    }
  }

  const byName = (a: { workerName: string }, b: { workerName: string }) => a.workerName.localeCompare(b.workerName, "es");

  // Orden operativo (no es un ranking): por hora y, a igual hora, alfabético.
  inService.sort((a, b) => Date.parse(a.checkInAt) - Date.parse(b.checkInAt) || byName(a, b));
  expected.sort((a, b) => Number(b.late) - Number(a.late) || Date.parse(a.startsAt) - Date.parse(b.startsAt) || byName(a, b));
  left.sort((a, b) => Date.parse(b.checkOutAt) - Date.parse(a.checkOutAt) || byName(a, b));
  incomplete.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || byName(a, b));
  responsibles.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.responsibleName.localeCompare(b.responsibleName, "es"));
  absences.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || byName(a, b));
  uncovered.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const present = [...inService, ...left];
  const incidentCounts: IncidentCounts = {
    late: present.filter((e) => e.lateMinutes != null).length,
    earlyLeave: present.filter((e) => e.earlyLeaveMinutes != null).length,
    afterEnd: present.filter((e) => e.afterEndMinutes > 0).length,
    substitutions,
  };

  return { shiftCount: selected.length, rosterCount, inService, responsibles, expected, left, absences, uncovered, incomplete, incidentCounts };
}
