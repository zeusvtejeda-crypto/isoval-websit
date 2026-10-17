/**
 * Tablero «Quién está aquí» (funciones puras).
 *
 * Recibe guardias ya calculadas con loadShiftsWithAttendance() y las agrupa en
 * secciones. No recalcula horas: solo usa el resumen de summarizeAttendance().
 * Las señales (retraso, registro incompleto) son para revisión humana; nunca
 * sancionan ni ordenan a las personas por desempeño.
 */
import type { AttendanceMethod } from "@/lib/attendance/calc";
import type { AssignmentWithAttendance, ShiftStatus, ShiftWithAttendance } from "@/lib/attendance/load";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { overlapsLocalDay, shiftPeriodOf, type ShiftPeriodFilter } from "./periods";

export type PresenceFilters = {
  /** Día local (yyyy-MM-dd) en la zona de cada sede. */
  day: string;
  period: ShiftPeriodFilter;
  facilityId?: string | null;
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

type PersonRef = ShiftRef & {
  assignmentId: string;
  workerId: string | null;
  workerName: string;
  assignedPoint: string | null;
};

export type InServiceEntry = PersonRef & {
  checkInAt: string;
  elapsedMinutes: number;
  method: AttendanceMethod;
  /** La entrada la registró coordinación (o es una corrección), no la persona. */
  registeredByStaff: boolean;
  isResponsible: boolean;
};

export type ExpectedEntry = PersonRef & {
  shiftInProgress: boolean;
  /** Ya pasó inicio + tolerancia sin entrada registrada. */
  late: boolean;
  minutesSinceStart: number;
  toleranceMinutes: number;
};

export type LeftEntry = PersonRef & {
  checkOutAt: string;
  totalMinutes: number;
  method: AttendanceMethod | null;
};

export type IncompleteReason = "entrada_sin_salida" | "sin_registros";

export type IncompleteEntry = PersonRef & {
  reason: IncompleteReason;
  checkInAt: string | null;
};

export type ResponsiblePresence = "en_servicio" | "sin_entrada" | "ya_salio" | "sin_asignacion";

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
  minStaff: number;
  maxStaff: number | null;
  /** Personas que faltan para el mínimo (en servicio si está en curso; asignadas si es futura). */
  missing: number;
};

export type PresenceBoard = {
  shiftCount: number;
  inService: InServiceEntry[];
  responsibles: ResponsibleEntry[];
  expected: ExpectedEntry[];
  left: LeftEntry[];
  uncovered: CoverageEntry[];
  incomplete: IncompleteEntry[];
};

export const INCOMPLETE_REASON_LABELS: Record<IncompleteReason, string> = {
  entrada_sin_salida: "Entrada sin salida",
  sin_registros: "Sin registros al terminar la guardia",
};

export const RESPONSIBLE_PRESENCE_LABELS: Record<ResponsiblePresence, string> = {
  en_servicio: "En servicio",
  sin_entrada: "Sin entrada registrada",
  ya_salio: "Ya registró salida",
  sin_asignacion: "Sin asignación en guardias de este filtro",
};

const MINUTE = 60_000;

function isCancelled(item: ShiftWithAttendance): boolean {
  return item.shift.status === "cancelada" || item.effectiveStatus === "cancelada";
}

/** ¿La guardia entra en los filtros (sede, día local y turno por hora local de inicio)? */
export function shiftMatchesFilters(item: ShiftWithAttendance, filters: PresenceFilters): boolean {
  if (filters.facilityId && item.shift.facility_id !== filters.facilityId) return false;
  const tz = item.facility?.timezone ?? DEFAULT_TIMEZONE;
  if (!overlapsLocalDay(item.shift.starts_at, item.shift.ends_at, filters.day, tz)) return false;
  if (filters.period !== "todos" && shiftPeriodOf(item.shift.starts_at, tz) !== filters.period) return false;
  return true;
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
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function presenceOf(a: AssignmentWithAttendance): { presence: ResponsiblePresence; checkInAt: string | null } {
  const s = a.summary;
  if (s.status === "en_servicio" && s.openSession) return { presence: "en_servicio", checkInAt: toIso(s.openSession.checkInAt) };
  if (s.hasLeft) return { presence: "ya_salio", checkInAt: null };
  return { presence: "sin_entrada", checkInAt: null };
}

export function buildPresenceBoard(shifts: ShiftWithAttendance[], now: Date, filters: PresenceFilters): PresenceBoard {
  const nowMs = now.getTime();
  const selected = shifts.filter((s) => !isCancelled(s) && shiftMatchesFilters(s, filters));

  const inService: InServiceEntry[] = [];
  const expected: ExpectedEntry[] = [];
  const left: LeftEntry[] = [];
  const incomplete: IncompleteEntry[] = [];
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
    const responsibleId = item.responsible?.id ?? null;

    for (const a of item.assignments) {
      if (a.assignment.status === "cancelado") continue;
      const s = a.summary;
      const base = personRef(item, a);

      if (s.status === "en_servicio" && s.openSession) {
        const checkInAt = toIso(s.openSession.checkInAt);
        const method = s.openSession.checkInMethod ?? "propio";
        inService.push({
          ...base,
          checkInAt,
          elapsedMinutes: Math.max(0, Math.floor((nowMs - Date.parse(checkInAt)) / MINUTE)),
          method,
          registeredByStaff: method !== "propio",
          isResponsible: responsibleId != null && base.workerId === responsibleId,
        });
      } else if (s.status === "registro_incompleto") {
        incomplete.push({
          ...base,
          reason: "entrada_sin_salida",
          checkInAt: s.openSession ? toIso(s.openSession.checkInAt) : null,
        });
      } else if (s.status === "finalizada" && s.hasLeft && s.lastCheckOut) {
        const lastSession = a.sessions
          .filter((x) => x.record_status === "vigente" && x.check_out_at)
          .sort((x, y) => Date.parse(y.check_out_at as string) - Date.parse(x.check_out_at as string))[0];
        left.push({
          ...base,
          checkOutAt: toIso(s.lastCheckOut),
          totalMinutes: s.totalMinutes,
          method: lastSession?.check_out_method ?? null,
        });
      } else if (s.status === "pendiente" && a.assignment.status === "asignado") {
        if (nowMs < endMs) {
          const sinceStart = Math.floor((nowMs - startMs) / MINUTE);
          expected.push({
            ...base,
            shiftInProgress: nowMs >= startMs,
            late: nowMs > startMs + tolerance * MINUTE,
            minutesSinceStart: sinceStart,
            toleranceMinutes: tolerance,
          });
        } else if (s.needsReview) {
          incomplete.push({ ...base, reason: "sin_registros", checkInAt: null });
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
      const current = item.effectiveStatus === "en_curso" ? item.coverage.inService : item.coverage.assigned;
      uncovered.push({
        ...shiftRef(item),
        effectiveStatus: item.effectiveStatus,
        assigned: item.coverage.assigned,
        inService: item.coverage.inService,
        minStaff: item.coverage.minStaff,
        maxStaff: item.coverage.maxStaff,
        missing: Math.max(0, item.coverage.minStaff - current),
      });
    }
  }

  const byName = (a: { workerName: string }, b: { workerName: string }) => a.workerName.localeCompare(b.workerName, "es");

  // Orden operativo (no es un ranking): por hora y, a igual hora, alfabético.
  inService.sort((a, b) => Date.parse(a.checkInAt) - Date.parse(b.checkInAt) || byName(a, b));
  expected.sort((a, b) => Number(b.late) - Number(a.late) || Date.parse(a.startsAt) - Date.parse(b.startsAt) || byName(a, b));
  left.sort((a, b) => Date.parse(b.checkOutAt) - Date.parse(a.checkOutAt) || byName(a, b));
  incomplete.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || byName(a, b));
  responsibles.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.responsibleName.localeCompare(b.responsibleName, "es"));
  uncovered.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  return { shiftCount: selected.length, inService, responsibles, expected, left, uncovered, incomplete };
}
