import { describe, expect, it } from "vitest";
import { mergeIntervals, summarizeAttendance, totalize, type SessionInput } from "@/lib/attendance/calc";

const T = (iso: string) => new Date(iso);
const base = { status: "asignado" as const };
const opts = (now: string, toleranceMinutes = 10) => ({ toleranceMinutes, openSessionGraceMinutes: 240, now: T(now) });

describe("mergeIntervals", () => {
  it("une intervalos superpuestos sin contarlos dos veces", () => {
    expect(mergeIntervals([[0, 10], [5, 20], [30, 40]])).toEqual([[0, 20], [30, 40]]);
  });
  it("ignora intervalos vacíos o invertidos", () => {
    expect(mergeIntervals([[10, 10], [20, 5]])).toEqual([]);
  });
});

describe("summarizeAttendance", () => {
  // Guardia 08:00–14:00 UTC
  const shift = { startsAt: "2026-10-17T08:00:00Z", endsAt: "2026-10-17T14:00:00Z" };

  it("calcula una guardia completa a tiempo", () => {
    const s = summarizeAttendance(shift, base, [
      { id: "a", checkInAt: "2026-10-17T08:05:00Z", checkOutAt: "2026-10-17T14:00:00Z" },
    ], opts("2026-10-17T15:00:00Z"));
    expect(s.status).toBe("finalizada");
    expect(s.scheduledMinutes).toBe(360);
    expect(s.withinScheduleMinutes).toBe(355);
    expect(s.outsideScheduleMinutes).toBe(0);
    expect(s.totalMinutes).toBe(355);
    expect(s.differenceMinutes).toBe(-5);
    expect(s.lateMinutes).toBeNull(); // dentro de la tolerancia
    expect(s.incidents).toEqual([]);
  });

  it("detecta llegada tardía según la tolerancia de la sede", () => {
    const sessions: SessionInput[] = [{ id: "a", checkInAt: "2026-10-17T08:15:00Z", checkOutAt: "2026-10-17T14:00:00Z" }];
    expect(summarizeAttendance(shift, base, sessions, opts("2026-10-17T15:00:00Z", 10)).lateMinutes).toBe(15);
    expect(summarizeAttendance(shift, base, sessions, opts("2026-10-17T15:00:00Z", 20)).lateMinutes).toBeNull();
  });

  it("criterio 7: salida y regreso sin contar el tiempo ausente", () => {
    const s = summarizeAttendance(shift, base, [
      { id: "a", checkInAt: "2026-10-17T08:00:00Z", checkOutAt: "2026-10-17T10:00:00Z" },
      { id: "b", checkInAt: "2026-10-17T11:30:00Z", checkOutAt: "2026-10-17T14:00:00Z" },
    ], opts("2026-10-17T15:00:00Z"));
    expect(s.totalMinutes).toBe(270); // 120 + 150; la hora y media de ausencia no cuenta
    expect(s.gapMinutes).toBe(90);
    expect(s.sessionsCount).toBe(2);
    expect(s.status).toBe("finalizada");
  });

  it("no cuenta dos veces intervalos superpuestos", () => {
    const s = summarizeAttendance(shift, base, [
      { id: "a", checkInAt: "2026-10-17T08:00:00Z", checkOutAt: "2026-10-17T12:00:00Z" },
      { id: "b", checkInAt: "2026-10-17T11:00:00Z", checkOutAt: "2026-10-17T14:00:00Z" },
    ], opts("2026-10-17T15:00:00Z"));
    expect(s.totalMinutes).toBe(360);
  });

  it("criterio 8: una entrada sin salida no suma horas y queda pendiente de revisión", () => {
    const sessions: SessionInput[] = [{ id: "a", checkInAt: "2026-10-17T08:00:00Z", checkOutAt: null }];
    const during = summarizeAttendance(shift, base, sessions, opts("2026-10-17T10:00:00Z"));
    expect(during.status).toBe("en_servicio");
    expect(during.totalMinutes).toBe(0);
    expect(during.openElapsedMinutes).toBe(120);

    const later = summarizeAttendance(shift, base, sessions, opts("2026-10-17T19:00:00Z"));
    expect(later.status).toBe("registro_incompleto");
    expect(later.needsReview).toBe(true);
    expect(later.totalMinutes).toBe(0);
    expect(later.lastCheckOut).toBeNull(); // no se inventa salida
    expect(later.incidents.map((i) => i.type)).toContain("registro_incompleto");
  });

  it("criterio 6: guardia que cruza medianoche (22:00–06:00)", () => {
    const night = { startsAt: "2026-10-18T05:00:00Z", endsAt: "2026-10-18T13:00:00Z" }; // 22:00–06:00 en Mazatlán (UTC-7)
    const s = summarizeAttendance(night, base, [
      { id: "a", checkInAt: "2026-10-18T05:00:00Z", checkOutAt: "2026-10-18T13:30:00Z" },
    ], opts("2026-10-18T14:00:00Z"));
    expect(s.scheduledMinutes).toBe(480);
    expect(s.withinScheduleMinutes).toBe(480);
    expect(s.afterEndMinutes).toBe(30);
    expect(s.totalMinutes).toBe(510);
    expect(s.incidents.map((i) => i.type)).toContain("permanencia_adicional");
  });

  it("detecta salida anticipada solo cuando la guardia terminó", () => {
    const sessions: SessionInput[] = [{ id: "a", checkInAt: "2026-10-17T08:00:00Z", checkOutAt: "2026-10-17T12:00:00Z" }];
    const before = summarizeAttendance(shift, base, sessions, opts("2026-10-17T12:30:00Z"));
    expect(before.earlyLeaveMinutes).toBeNull();
    expect(before.hasLeft).toBe(true);
    const after = summarizeAttendance(shift, base, sessions, opts("2026-10-17T14:30:00Z"));
    expect(after.earlyLeaveMinutes).toBe(120);
  });

  it("separa tiempo fuera del horario antes del inicio", () => {
    const s = summarizeAttendance(shift, base, [
      { id: "a", checkInAt: "2026-10-17T07:30:00Z", checkOutAt: "2026-10-17T14:00:00Z" },
    ], opts("2026-10-17T15:00:00Z"));
    expect(s.beforeStartMinutes).toBe(30);
    expect(s.outsideScheduleMinutes).toBe(30);
    expect(s.withinScheduleMinutes).toBe(360);
  });

  it("ignora versiones corregidas y marca la corrección administrativa", () => {
    const s = summarizeAttendance(shift, base, [
      { id: "orig", checkInAt: "2026-10-17T09:00:00Z", checkOutAt: "2026-10-17T10:00:00Z", recordStatus: "corregido" },
      { id: "new", checkInAt: "2026-10-17T08:00:00Z", checkOutAt: "2026-10-17T14:00:00Z", supersedesId: "orig", checkInMethod: "correccion" },
    ], opts("2026-10-17T15:00:00Z"));
    expect(s.totalMinutes).toBe(360);
    expect(s.incidents.map((i) => i.type)).toContain("correccion_administrativa");
  });

  it("un registro anulado no cuenta tiempo pero sí marca la corrección administrativa", () => {
    const only = summarizeAttendance(shift, base, [
      { id: "x", checkInAt: "2026-10-17T08:00:00Z", checkOutAt: "2026-10-17T14:00:00Z", recordStatus: "anulado" },
    ], opts("2026-10-17T15:00:00Z"));
    expect(only.totalMinutes).toBe(0);
    expect(only.status).toBe("pendiente");
    expect(only.incidents.map((i) => i.type)).toEqual(["correccion_administrativa"]);

    const second = summarizeAttendance(shift, base, [
      { id: "a", checkInAt: "2026-10-17T08:00:00Z", checkOutAt: "2026-10-17T11:00:00Z" },
      { id: "b", checkInAt: "2026-10-17T11:30:00Z", checkOutAt: "2026-10-17T14:00:00Z", recordStatus: "anulado" },
    ], opts("2026-10-17T15:00:00Z"));
    expect(second.totalMinutes).toBe(180);
    expect(second.incidents.map((i) => i.type)).toEqual(["salida_anticipada", "correccion_administrativa"]);
  });

  it("respeta ausencias justificadas e inasistencias confirmadas", () => {
    expect(summarizeAttendance(shift, { status: "ausencia_justificada" }, [], opts("2026-10-17T15:00:00Z")).status).toBe("ausencia_justificada");
    expect(summarizeAttendance(shift, { status: "inasistencia_confirmada" }, [], opts("2026-10-17T15:00:00Z")).status).toBe("inasistencia_confirmada");
    const pending = summarizeAttendance(shift, base, [], opts("2026-10-17T15:00:00Z"));
    expect(pending.status).toBe("pendiente");
    expect(pending.needsReview).toBe(true); // sin registro tras el término: revisar, no sancionar
  });

  it("marca sustitución", () => {
    const s = summarizeAttendance(shift, { status: "asignado", substituteForWorkerId: "w2" }, [], opts("2026-10-17T07:00:00Z"));
    expect(s.incidents).toEqual([{ type: "sustitucion" }]);
  });

  it("totaliza resúmenes", () => {
    const a = summarizeAttendance(shift, base, [
      { id: "a", checkInAt: "2026-10-17T08:20:00Z", checkOutAt: "2026-10-17T14:00:00Z" },
    ], opts("2026-10-17T15:00:00Z"));
    const b = summarizeAttendance(shift, { status: "ausencia_justificada" }, [], opts("2026-10-17T15:00:00Z"));
    const t = totalize([a, b]);
    expect(t.assignments).toBe(2);
    expect(t.late).toBe(1);
    expect(t.justifiedAbsences).toBe(1);
    expect(t.totalMinutes).toBe(340);
  });
});
