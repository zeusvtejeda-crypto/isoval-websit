/**
 * Resumen del día para el inicio de coordinación (funciones puras).
 * Usa los resúmenes de loadShiftsWithAttendance(); no recalcula horas.
 */
import type { ShiftWithAttendance } from "@/lib/attendance/load";
import { DEFAULT_TIMEZONE, todayInTz } from "@/lib/time";
import { overlapsLocalDay } from "./periods";

export type HomeSummary = {
  /** Guardias (no canceladas) que se traslapan con el día de hoy en la zona de su sede. */
  shiftsToday: number;
  shiftsInProgress: number;
  /** Personas distintas con entrada abierta vigente (en servicio). */
  peopleInService: number;
  insufficientCoverage: number;
  /** Asignaciones con entrada sin salida (pendientes de revisión) en guardias que terminaron en los últimos N días. */
  incompleteRecent: number;
  /** Asignados sin registro en guardias que ya terminaron (pendientes de revisión) en los últimos N días. */
  noRecordsRecent: number;
};

const DAY = 86_400_000;

export function summarizeHome(shifts: ShiftWithAttendance[], now: Date, recentDays = 7): HomeSummary {
  const nowMs = now.getTime();
  const recentFrom = nowMs - recentDays * DAY;
  let shiftsToday = 0;
  let shiftsInProgress = 0;
  let insufficientCoverage = 0;
  let incompleteRecent = 0;
  let noRecordsRecent = 0;
  const inService = new Set<string>();

  for (const item of shifts) {
    if (item.shift.status === "cancelada" || item.effectiveStatus === "cancelada") continue;
    const tz = item.facility?.timezone ?? DEFAULT_TIMEZONE;
    const today = todayInTz(tz, now);
    const isToday = overlapsLocalDay(item.shift.starts_at, item.shift.ends_at, today, tz);
    const endMs = Date.parse(item.shift.ends_at);
    const startMs = Date.parse(item.shift.starts_at);

    if (isToday) {
      shiftsToday += 1;
      if (item.coverage.insufficient) insufficientCoverage += 1;
    }
    if (startMs <= nowMs && nowMs < endMs) shiftsInProgress += 1;

    for (const a of item.assignments) {
      if (a.assignment.status === "cancelado") continue;
      if (a.summary.status === "en_servicio") {
        inService.add(a.worker?.id ?? a.assignment.worker_id ?? a.assignment.id);
      }
      const endedRecently = endMs <= nowMs && endMs >= recentFrom;
      if (a.summary.status === "registro_incompleto" && endMs >= recentFrom) incompleteRecent += 1;
      if (endedRecently && a.summary.status === "pendiente" && a.summary.needsReview) noRecordsRecent += 1;
    }
  }

  return {
    shiftsToday,
    shiftsInProgress,
    peopleInService: inService.size,
    insufficientCoverage,
    incompleteRecent,
    noRecordsRecent,
  };
}
