/**
 * Vista del trabajador: qué guardia mostrar y qué botones habilitar
 * (funciones puras). La decisión final SIEMPRE la toma el servidor
 * (check_in/check_out); aquí solo se orienta a la persona.
 */
import {
  summarizeAttendance,
  type AssignmentStatus,
  type AttendanceMethod,
  type AttendanceSummary,
  type RecordStatus,
  type ShiftStatus,
} from "@/lib/attendance/calc";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/attendance/labels";
import { formatDate, formatTime } from "@/lib/time";

/** Fila de get_my_assignments (columnas que pueden venir nulas, tipadas como tales). */
export type MyAssignmentRow = {
  assignment_id: string;
  assignment_status: AssignmentStatus;
  assigned_point: string | null;
  substitute_for_name: string | null;
  shift_id: string;
  shift_title: string | null;
  meeting_point: string;
  starts_at: string;
  ends_at: string;
  shift_status: ShiftStatus;
  instructions: string | null;
  facility_id: string;
  facility_name: string;
  facility_timezone: string;
  arrival_tolerance_minutes: number;
  responsible_name: string | null;
};

export type OwnSession = {
  id: string;
  assignment_id: string;
  check_in_at: string;
  check_out_at: string | null;
  record_status: RecordStatus;
  check_in_method: AttendanceMethod;
  check_out_method: AttendanceMethod | null;
  supersedes_id: string | null;
};

export type CheckInBlock = "already_open" | "cancelled" | "inactive" | "open_elsewhere" | "not_yet_open" | "ended";
export type CheckOutBlock = "no_open_session" | "needs_review";
export type ShiftTiming = "proxima" | "en_curso" | "terminada";

export type WorkerRules = {
  /** Minutos antes del inicio en que abre el registro de entrada. */
  windowBeforeMinutes: number;
  /** Margen tras el término para cerrar una entrada abierta sin revisión. */
  graceMinutes: number;
};

export type MyShiftView = {
  row: MyAssignmentRow;
  summary: AttendanceSummary;
  /** Todas las versiones de las sesiones de esta asignación. */
  sessions: OwnSession[];
  /** Entrada abierta vigente en ESTA asignación. */
  openSession: OwnSession | null;
  timing: ShiftTiming;
  /** Momento en que abre el registro de entrada. */
  opensAt: Date;
  active: boolean;
  canCheckIn: boolean;
  checkInBlock: CheckInBlock | null;
  canCheckOut: boolean;
  checkOutBlock: CheckOutBlock | null;
};

const MINUTE = 60_000;

function isOpen(s: OwnSession): boolean {
  return s.record_status === "vigente" && s.check_out_at == null;
}

export function buildMyShifts(rows: MyAssignmentRow[], sessions: OwnSession[], now: Date, rules: WorkerRules): MyShiftView[] {
  const nowMs = now.getTime();
  const globalOpen = sessions.find(isOpen) ?? null;

  const byAssignment = new Map<string, OwnSession[]>();
  for (const s of sessions) {
    const list = byAssignment.get(s.assignment_id) ?? [];
    list.push(s);
    byAssignment.set(s.assignment_id, list);
  }

  const seen = new Set<string>();
  const views: MyShiftView[] = [];
  for (const row of rows) {
    if (seen.has(row.assignment_id)) continue;
    seen.add(row.assignment_id);

    const own = (byAssignment.get(row.assignment_id) ?? []).slice().sort((a, b) => Date.parse(a.check_in_at) - Date.parse(b.check_in_at));
    const startMs = Date.parse(row.starts_at);
    const endMs = Date.parse(row.ends_at);
    const opensAt = new Date(startMs - Math.max(0, rules.windowBeforeMinutes) * MINUTE);
    const openSession = own.find(isOpen) ?? null;
    const cancelled = row.shift_status === "cancelada" || row.assignment_status === "cancelado";
    const active = row.assignment_status === "asignado" && row.shift_status !== "cancelada";
    const timing: ShiftTiming = nowMs < startMs ? "proxima" : nowMs < endMs ? "en_curso" : "terminada";

    const summary = summarizeAttendance(
      { startsAt: row.starts_at, endsAt: row.ends_at, status: row.shift_status },
      // La función solo necesita saber si hay sustitución; get_my_assignments entrega el nombre.
      { status: row.assignment_status, substituteForWorkerId: row.substitute_for_name ? "sustitucion" : null },
      own.map((s) => ({
        id: s.id,
        checkInAt: s.check_in_at,
        checkOutAt: s.check_out_at,
        recordStatus: s.record_status,
        checkInMethod: s.check_in_method,
        checkOutMethod: s.check_out_method,
        supersedesId: s.supersedes_id,
      })),
      { toleranceMinutes: row.arrival_tolerance_minutes, openSessionGraceMinutes: rules.graceMinutes, now },
    );

    let checkInBlock: CheckInBlock | null = null;
    if (openSession) checkInBlock = "already_open";
    else if (cancelled) checkInBlock = "cancelled";
    else if (!active) checkInBlock = "inactive";
    else if (globalOpen) checkInBlock = "open_elsewhere";
    else if (nowMs < opensAt.getTime()) checkInBlock = "not_yet_open";
    else if (nowMs >= endMs) checkInBlock = "ended";

    let checkOutBlock: CheckOutBlock | null = null;
    if (!openSession) checkOutBlock = "no_open_session";
    else if (nowMs > endMs + Math.max(0, rules.graceMinutes) * MINUTE) checkOutBlock = "needs_review";

    views.push({
      row,
      summary,
      sessions: own,
      openSession,
      timing,
      opensAt,
      active,
      canCheckIn: checkInBlock == null,
      checkInBlock,
      canCheckOut: checkOutBlock == null,
      checkOutBlock,
    });
  }
  return views.sort((a, b) => Date.parse(a.row.starts_at) - Date.parse(b.row.starts_at));
}

/**
 * «Mi guardia de hoy», en este orden:
 * 1) la que tiene entrada abierta y no ha terminado;
 * 2) la que está en curso;
 * 3) la que tiene entrada abierta aunque ya terminó (para registrar la salida);
 * 4) la próxima.
 * Una entrada abierta en otra guardia se muestra aparte (openElsewhere).
 */
export function pickFeatured(views: MyShiftView[]): MyShiftView | null {
  const openCurrent = views.find((v) => v.openSession && v.timing !== "terminada");
  if (openCurrent) return openCurrent;
  const inProgress = views.find((v) => v.active && v.timing === "en_curso");
  if (inProgress) return inProgress;
  const openEnded = views.find((v) => v.openSession);
  if (openEnded) return openEnded;
  return views.find((v) => v.active && v.timing === "proxima") ?? null;
}

/** Asignaciones que se pueden registrar ahora (entrada abierta o ventana de entrada abierta). */
export function registrableViews(views: MyShiftView[]): MyShiftView[] {
  const rank = (v: MyShiftView) => (v.openSession ? 0 : v.timing === "en_curso" ? 1 : 2);
  return views
    .filter((v) => v.openSession || v.canCheckIn)
    .sort((a, b) => rank(a) - rank(b) || Date.parse(a.row.starts_at) - Date.parse(b.row.starts_at));
}

/** Entrada abierta en una asignación distinta de la indicada. */
export function openElsewhere(views: MyShiftView[], currentAssignmentId: string | null): MyShiftView | null {
  return views.find((v) => v.openSession && v.row.assignment_id !== currentAssignmentId) ?? null;
}

/** Próximas asignaciones (no terminadas), sin la destacada. */
export function upcomingViews(views: MyShiftView[], excludeId: string | null): MyShiftView[] {
  return views.filter((v) => v.row.assignment_id !== excludeId && v.timing !== "terminada");
}

/** Guardias que terminaron dentro de la ventana consultada (últimas 24 h aprox.). */
export function recentViews(views: MyShiftView[], excludeId: string | null): MyShiftView[] {
  return views
    .filter((v) => v.row.assignment_id !== excludeId && v.timing === "terminada")
    .sort((a, b) => Date.parse(b.row.starts_at) - Date.parse(a.row.starts_at));
}

export function checkInBlockText(view: MyShiftView): string | null {
  const tz = view.row.facility_timezone;
  switch (view.checkInBlock) {
    case null:
      return null;
    case "already_open":
      return view.checkOutBlock === "needs_review"
        ? "Esta guardia tiene una entrada sin salida que requiere revisión; no se puede registrar otra entrada."
        : "Ya tienes una entrada registrada en esta guardia. Registra tu salida al terminar.";
    case "cancelled":
      return "La guardia o tu asignación está cancelada; no se puede registrar entrada.";
    case "inactive":
      return `Tu asignación tiene el estado «${ASSIGNMENT_STATUS_LABELS[view.row.assignment_status]}»; no se puede registrar entrada.`;
    case "open_elsewhere":
      return "Tienes una entrada abierta en otra guardia. Registra primero la salida de esa guardia.";
    case "not_yet_open":
      return `El registro de entrada abre el ${formatDate(view.opensAt, tz)} a las ${formatTime(view.opensAt, tz)} (hora de la sede).`;
    case "ended":
      return "La guardia ya terminó. Si no pudiste registrar, solicita una corrección en «Mi historial».";
  }
}

export function checkOutBlockText(view: MyShiftView): string | null {
  switch (view.checkOutBlock) {
    case null:
      return null;
    case "no_open_session":
      return "No hay una entrada abierta en esta guardia.";
    case "needs_review":
      return "Esta entrada quedó sin salida y requiere revisión. Solicita una corrección en «Mi historial».";
  }
}
