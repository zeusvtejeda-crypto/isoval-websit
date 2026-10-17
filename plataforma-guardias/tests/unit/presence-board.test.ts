import { createElement, type ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  summarizeAttendance,
  type AssignmentStatus,
  type AttendanceMethod,
  type RecordStatus,
  type ShiftStatus,
} from "@/lib/attendance/calc";
import type { AssignmentRow, AssignmentWithAttendance, SessionRow, ShiftRow, ShiftWithAttendance } from "@/lib/attendance/load";
import { allFacilitiesLabel, buildPresenceBoard, incidentLabels, shiftMatchesFilters, workerHistoryHref } from "@/lib/presence/board";
import { guardiasQuickLinkDescription, summarizeHome } from "@/lib/presence/home";
import { AbsenceSection, InServiceSection, LeftSection, ResponsiblesSection } from "@/components/presence/board-sections";
import { PresenceFilters } from "@/components/presence/presence-filters";

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => h("a", { href, ...rest }, children),
  };
});
vi.mock("next/form", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ action, children, ...rest }: { action: string; children: ReactNode }) => h("form", { action, ...rest }, children),
  };
});
import { addDays, isIsoDay, overlapsLocalDay, parseShiftPeriod, shiftPeriodOf } from "@/lib/presence/periods";

// -----------------------------------------------------------------------------
// Datos de prueba: se construyen con summarizeAttendance (igual que load.ts).
// Sede en America/Mazatlan (UTC−7). Día local 2026-10-17 = 07:00Z a 07:00Z del 18.
// -----------------------------------------------------------------------------
const MZT = "America/Mazatlan";
const NOW = new Date("2026-10-17T16:00:00Z"); // 09:00 hora de Mazatlán
const GRACE = 240;

type SessSpec = { in: string; out?: string | null; method?: AttendanceMethod; status?: RecordStatus };
type AsgSpec = {
  id: string;
  workerId: string;
  name: string;
  status?: AssignmentStatus;
  statusReason?: string | null;
  point?: string | null;
  sessions?: SessSpec[];
  /** Persona a quien cubre; `name: null` simula que RLS oculta el nombre. */
  substituteFor?: { id: string; name: string | null };
};
type ShiftSpec = {
  id: string;
  facilityId?: string;
  facilityName?: string;
  tz?: string;
  start: string;
  end: string;
  minStaff?: number;
  status?: ShiftStatus;
  tolerance?: number;
  responsible?: { id: string; full_name: string } | null;
  assignments: AsgSpec[];
};

function build(spec: ShiftSpec, now: Date = NOW): ShiftWithAttendance {
  const facilityId = spec.facilityId ?? "F1";
  const tz = spec.tz ?? MZT;
  const tolerance = spec.tolerance ?? 10;
  const status = spec.status ?? "programada";
  const items: AssignmentWithAttendance[] = spec.assignments.map((a) => {
    const sessions: SessionRow[] = (a.sessions ?? []).map((s, i) => ({
      id: `${a.id}-s${i}`,
      assignment_id: a.id,
      shift_id: spec.id,
      worker_id: a.workerId,
      facility_id: facilityId,
      check_in_at: s.in,
      check_out_at: s.out ?? null,
      check_in_method: s.method ?? "propio",
      check_out_method: s.out ? (s.method ?? "propio") : null,
      check_in_by: "u1",
      check_out_by: s.out ? "u1" : null,
      check_in_reason: null,
      check_out_reason: null,
      check_in_request_id: `${a.id}-r${i}`,
      qr_check_in_token_id: null,
      qr_check_out_token_id: null,
      check_out_request_id: s.out ? `${a.id}-o${i}` : null,
      notes: null,
      record_status: s.status ?? "vigente",
      supersedes_id: null,
      status_reason: s.status && s.status !== "vigente" ? "motivo" : null,
      status_changed_at: null,
      status_changed_by: null,
      created_at: s.in,
    }));
    const assignmentStatus = a.status ?? "asignado";
    const summary = summarizeAttendance(
      { startsAt: spec.start, endsAt: spec.end, status },
      { status: assignmentStatus, substituteForWorkerId: a.substituteFor?.id ?? null },
      sessions.map((s) => ({
        id: s.id,
        checkInAt: s.check_in_at,
        checkOutAt: s.check_out_at,
        recordStatus: s.record_status,
        checkInMethod: s.check_in_method,
        checkOutMethod: s.check_out_method,
        supersedesId: s.supersedes_id,
      })),
      { toleranceMinutes: tolerance, openSessionGraceMinutes: GRACE, now },
    );
    const assignment = {
      id: a.id,
      shift_id: spec.id,
      worker_id: a.workerId,
      assigned_point: a.point ?? null,
      substitute_for_worker_id: a.substituteFor?.id ?? null,
      status: assignmentStatus,
      status_reason: a.statusReason ?? null,
      status_changed_by: null,
      status_changed_at: assignmentStatus === "asignado" ? null : "2026-10-17T15:30:00Z",
      notes: null,
      change_reason: null,
      created_by: null,
      created_at: spec.start,
      updated_at: spec.start,
    } as AssignmentRow;
    return {
      assignment,
      worker: { id: a.workerId, full_name: a.name, internal_code: `TRA-${a.workerId}`, area: null, position: null, facility_id: facilityId },
      substituteFor: a.substituteFor?.name ? { id: a.substituteFor.id, full_name: a.substituteFor.name } : null,
      sessions,
      summary,
    };
  });

  const nowMs = now.getTime();
  const effectiveStatus: ShiftStatus =
    status === "cancelada" || status === "finalizada"
      ? status
      : nowMs < Date.parse(spec.start)
        ? "programada"
        : nowMs < Date.parse(spec.end)
          ? "en_curso"
          : "finalizada";
  const minStaff = spec.minStaff ?? 1;
  const active = items.filter((i) => i.assignment.status === "asignado").length;
  const inService = items.filter((i) => i.summary.status === "en_servicio").length;
  const insufficient = effectiveStatus === "en_curso" ? inService < minStaff : effectiveStatus === "programada" ? active < minStaff : false;

  const shift = {
    id: spec.id,
    facility_id: facilityId,
    title: null,
    meeting_point: `Punto ${spec.id}`,
    starts_at: spec.start,
    ends_at: spec.end,
    responsible_worker_id: spec.responsible?.id ?? null,
    min_staff: minStaff,
    max_staff: null,
    instructions: null,
    status,
    cancel_reason: status === "cancelada" ? "motivo" : null,
    is_demo: true,
    change_reason: null,
    created_by: null,
    updated_by: null,
    created_at: spec.start,
    updated_at: spec.start,
    effective_status: effectiveStatus,
  } as ShiftRow;

  return {
    shift,
    effectiveStatus,
    facility: {
      id: facilityId,
      official_name: spec.facilityName ?? `Sede ${facilityId}`,
      timezone: tz,
      arrival_tolerance_minutes: tolerance,
      state_id: 18,
      municipality_id: null,
    },
    responsible: spec.responsible ?? null,
    assignments: items,
    coverage: { assigned: active, inService, minStaff, maxStaff: null, insufficient },
  };
}

// Guardia matutina en curso (06:00–14:00 local).
const shiftA = build({
  id: "A",
  start: "2026-10-17T13:00:00Z",
  end: "2026-10-17T21:00:00Z",
  minStaff: 4,
  responsible: { id: "wR", full_name: "Rosa Responsable" },
  assignments: [
    { id: "aR", workerId: "wR", name: "Rosa Responsable", sessions: [{ in: "2026-10-17T13:02:00Z" }] },
    { id: "aAna", workerId: "wAna", name: "Ana", point: "Puerta 2", sessions: [{ in: "2026-10-17T13:05:00Z" }] },
    { id: "aLuis", workerId: "wLuis", name: "Luis", sessions: [{ in: "2026-10-17T13:20:00Z", method: "coordinador" }] },
    { id: "aMaria", workerId: "wMaria", name: "María" },
    { id: "aJorge", workerId: "wJorge", name: "Jorge", sessions: [{ in: "2026-10-17T13:00:00Z", out: "2026-10-17T15:00:00Z" }] },
    { id: "aPedro", workerId: "wPedro", name: "Pedro", status: "cancelado" },
  ],
});

// Guardia vespertina por iniciar (14:00–22:00 local), cupo insuficiente. Responsable en servicio en otra guardia.
const shiftB = build({
  id: "B",
  start: "2026-10-17T21:00:00Z",
  end: "2026-10-18T05:00:00Z",
  minStaff: 2,
  responsible: { id: "wAna", full_name: "Ana" },
  assignments: [{ id: "aSofia", workerId: "wSofia", name: "Sofía" }],
});

// Guardia que cruzó medianoche (20:00 del 16 a 04:00 del 17 local), ya terminó hace más del margen.
const shiftC = build({
  id: "C",
  start: "2026-10-17T03:00:00Z",
  end: "2026-10-17T11:00:00Z",
  responsible: { id: "wNadie", full_name: "Persona sin asignación" },
  assignments: [
    { id: "aRaul", workerId: "wRaul", name: "Raúl", sessions: [{ in: "2026-10-17T03:10:00Z" }] },
    { id: "aElena", workerId: "wElena", name: "Elena" },
  ],
});

// Otra sede, mismo día.
const shiftD = build({
  id: "D",
  facilityId: "F2",
  start: "2026-10-17T14:00:00Z",
  end: "2026-10-17T20:00:00Z",
  assignments: [{ id: "aTomas", workerId: "wTomas", name: "Tomás", sessions: [{ in: "2026-10-17T14:01:00Z" }] }],
});

// Cancelada y de otro día: no deben aparecer.
const shiftE = build({
  id: "E",
  status: "cancelada",
  start: "2026-10-17T13:00:00Z",
  end: "2026-10-17T21:00:00Z",
  assignments: [{ id: "aX", workerId: "wX", name: "Xavier" }],
});
const shiftF = build({
  id: "F",
  start: "2026-10-19T13:00:00Z",
  end: "2026-10-19T21:00:00Z",
  assignments: [{ id: "aY", workerId: "wY", name: "Yolanda" }],
});

const ALL = [shiftA, shiftB, shiftC, shiftD, shiftE, shiftF];
const DAY = "2026-10-17";

describe("turnos y días locales", () => {
  it("clasifica el turno por la hora LOCAL de inicio en la zona de la sede", () => {
    expect(shiftPeriodOf("2026-10-17T13:00:00Z", MZT)).toBe("matutino"); // 06:00
    expect(shiftPeriodOf("2026-10-17T21:00:00Z", MZT)).toBe("vespertino"); // 14:00
    expect(shiftPeriodOf("2026-10-18T05:00:00Z", MZT)).toBe("nocturno"); // 22:00
    expect(shiftPeriodOf("2026-10-17T12:59:00Z", MZT)).toBe("nocturno"); // 05:59
    // La misma hora UTC cae en otro turno en Bahía de Banderas (hora del centro).
    expect(shiftPeriodOf("2026-10-17T20:30:00Z", MZT)).toBe("matutino"); // 13:30
    expect(shiftPeriodOf("2026-10-17T20:30:00Z", "America/Bahia_Banderas")).toBe("vespertino"); // 14:30
  });

  it("valida filtros de turno y fechas", () => {
    expect(parseShiftPeriod("nocturno")).toBe("nocturno");
    expect(parseShiftPeriod("otro")).toBe("todos");
    expect(parseShiftPeriod(["matutino"])).toBe("todos");
    expect(isIsoDay("2026-10-17")).toBe(true);
    expect(isIsoDay("2026-02-31")).toBe(false);
    expect(isIsoDay("17/10/2026")).toBe(false);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("detecta traslape con el día local (guardias que cruzan medianoche)", () => {
    expect(overlapsLocalDay("2026-10-17T03:00:00Z", "2026-10-17T11:00:00Z", "2026-10-17", MZT)).toBe(true);
    expect(overlapsLocalDay("2026-10-17T03:00:00Z", "2026-10-17T11:00:00Z", "2026-10-16", MZT)).toBe(true);
    // Termina justo a la medianoche local del 17: no pertenece al 17.
    expect(overlapsLocalDay("2026-10-16T23:00:00Z", "2026-10-17T07:00:00Z", "2026-10-17", MZT)).toBe(false);
  });
});

describe("buildPresenceBoard", () => {
  const board = buildPresenceBoard(ALL, NOW, { day: DAY, period: "todos" });

  it("excluye guardias canceladas y de otros días", () => {
    expect(board.shiftCount).toBe(4); // A, B, C, D
    expect(shiftMatchesFilters(shiftF, { day: DAY, period: "todos" })).toBe(false);
    const names = [...board.inService, ...board.expected, ...board.left, ...board.incomplete].map((x) => x.workerName);
    expect(names).not.toContain("Xavier");
    expect(names).not.toContain("Yolanda");
    expect(names).not.toContain("Pedro"); // asignación cancelada
  });

  it("lista quién está en servicio con hora de entrada, tiempo transcurrido y método", () => {
    const names = board.inService.map((i) => i.workerName);
    expect(names).toEqual(["Rosa Responsable", "Ana", "Luis", "Tomás"]); // por hora de entrada
    const ana = board.inService.find((i) => i.workerName === "Ana");
    expect(ana?.checkInAt).toBe("2026-10-17T13:05:00.000Z");
    expect(ana?.elapsedMinutes).toBe(175);
    expect(ana?.assignedPoint).toBe("Puerta 2");
    expect(ana?.registeredByStaff).toBe(false);
    const luis = board.inService.find((i) => i.workerName === "Luis");
    expect(luis?.registeredByStaff).toBe(true);
    expect(luis?.method).toBe("coordinador");
    expect(board.inService.find((i) => i.workerName === "Rosa Responsable")?.isResponsible).toBe(true);
  });

  it("marca «Retraso» solo cuando pasó inicio + tolerancia sin entrada", () => {
    const maria = board.expected.find((e) => e.workerName === "María");
    expect(maria?.late).toBe(true);
    expect(maria?.shiftInProgress).toBe(true);
    expect(maria?.minutesSinceStart).toBe(180);
    const sofia = board.expected.find((e) => e.workerName === "Sofía");
    expect(sofia?.late).toBe(false);
    expect(sofia?.shiftInProgress).toBe(false);
    expect(board.expected[0].workerName).toBe("María"); // los retrasos primero

    // Dentro de la tolerancia (06:08 local) no hay retraso.
    const early = buildPresenceBoard([build({ ...specOf("A2"), minStaff: 1 }, new Date("2026-10-17T13:08:00Z"))], new Date("2026-10-17T13:08:00Z"), {
      day: DAY,
      period: "todos",
    });
    expect(early.expected[0].late).toBe(false);
  });

  it("separa a quienes ya salieron con su hora de salida", () => {
    expect(board.left).toHaveLength(1);
    expect(board.left[0].workerName).toBe("Jorge");
    expect(board.left[0].checkOutAt).toBe("2026-10-17T15:00:00.000Z");
    expect(board.left[0].totalMinutes).toBe(120);
  });

  it("muestra responsables y si están en servicio (en su guardia o en otra)", () => {
    const byShift = Object.fromEntries(board.responsibles.map((r) => [r.shiftId, r]));
    expect(byShift.A.presence).toBe("en_servicio");
    expect(byShift.B.presence).toBe("en_servicio"); // Ana está en servicio en la guardia A
    expect(byShift.C.presence).toBe("sin_asignacion");
    expect(byShift.D).toBeUndefined();
  });

  it("señala guardias sin cobertura suficiente", () => {
    const ids = board.uncovered.map((c) => c.shiftId);
    expect(ids).toEqual(["A", "B"]);
    const a = board.uncovered.find((c) => c.shiftId === "A");
    expect(a?.inService).toBe(3);
    expect(a?.missing).toBe(1); // 3 en servicio de 4
    const b = board.uncovered.find((c) => c.shiftId === "B");
    expect(b?.missing).toBe(1); // 1 asignada de 2
  });

  it("lista registros incompletos pendientes de revisión", () => {
    const byName = Object.fromEntries(board.incomplete.map((i) => [i.workerName, i]));
    expect(byName["Raúl"].reason).toBe("entrada_sin_salida");
    expect(byName["Raúl"].checkInAt).toBe("2026-10-17T03:10:00.000Z");
    expect(byName["Elena"].reason).toBe("sin_registros");
    expect(board.inService.map((i) => i.workerName)).not.toContain("Raúl");
  });

  it("filtra por sede y por turno", () => {
    const f2 = buildPresenceBoard(ALL, NOW, { day: DAY, period: "todos", facilityId: "F2" });
    expect(f2.shiftCount).toBe(1);
    expect(f2.inService.map((i) => i.workerName)).toEqual(["Tomás"]);

    const morning = buildPresenceBoard(ALL, NOW, { day: DAY, period: "matutino" });
    expect(morning.shiftCount).toBe(2); // A (06:00) y D (07:00)
    expect(morning.expected.map((e) => e.workerName)).toEqual(["María"]);

    const evening = buildPresenceBoard(ALL, NOW, { day: DAY, period: "vespertino" });
    // B inicia 14:00 local; C inició 20:00 local del día anterior.
    expect(evening.shiftCount).toBe(2);
    expect(evening.inService).toHaveLength(0);
  });

  it("una guardia cerrada manualmente no deja personas «pendientes de llegar»", () => {
    const closed = build({ ...specOf("CERRADA"), status: "finalizada" });
    const b = buildPresenceBoard([closed], NOW, { day: DAY, period: "todos" });
    expect(closed.effectiveStatus).toBe("finalizada");
    expect(b.shiftCount).toBe(1);
    expect(b.expected).toHaveLength(0);
    expect(b.incomplete).toHaveLength(0); // aún no termina su horario: no hay señal de revisión
    expect(summarizeHome([closed], NOW, 7).shiftsInProgress).toBe(0);
  });

  it("con incompleteSince lista entradas olvidadas de días anteriores sin contarlas como guardias del día", () => {
    // Guardia de ayer (06:00–14:00 local del 16) con entrada sin salida y otra persona sin registros.
    const yesterday = build({
      id: "AYER",
      start: "2026-10-16T13:00:00Z",
      end: "2026-10-16T21:00:00Z",
      assignments: [
        { id: "aOlvido", workerId: "wOlvido", name: "Olga", sessions: [{ in: "2026-10-16T13:01:00Z" }] },
        { id: "aFalta", workerId: "wFalta", name: "Fausto" },
      ],
    });
    // Otra sede, misma situación.
    const otherFacility = build({
      id: "AYER2",
      facilityId: "F2",
      start: "2026-10-16T13:00:00Z",
      end: "2026-10-16T21:00:00Z",
      assignments: [{ id: "aOtra", workerId: "wOtra", name: "Otilia", sessions: [{ in: "2026-10-16T13:01:00Z" }] }],
    });
    // Hace 10 días: fuera de la ventana.
    const old = build({
      id: "VIEJA",
      start: "2026-10-07T13:00:00Z",
      end: "2026-10-07T21:00:00Z",
      assignments: [{ id: "aVieja", workerId: "wVieja", name: "Vicente", sessions: [{ in: "2026-10-07T13:01:00Z" }] }],
    });
    const input = [...ALL, yesterday, otherFacility, old];
    const since = new Date(NOW.getTime() - 7 * 86_400_000);

    const without = buildPresenceBoard(input, NOW, { day: DAY, period: "todos" });
    expect(without.incomplete.map((i) => i.workerName)).not.toContain("Olga");

    const withLookback = buildPresenceBoard(input, NOW, { day: DAY, period: "todos", incompleteSince: since });
    const byName = Object.fromEntries(withLookback.incomplete.map((i) => [i.workerName, i]));
    expect(byName["Olga"].reason).toBe("entrada_sin_salida");
    expect(byName["Fausto"].reason).toBe("sin_registros");
    expect(byName["Otilia"]).toBeDefined();
    expect(byName["Vicente"]).toBeUndefined();
    expect(byName["Raúl"]).toBeDefined(); // los del día se conservan
    expect(withLookback.shiftCount).toBe(4); // solo cuenta guardias del día
    expect(withLookback.expected.map((e) => e.workerName)).not.toContain("Fausto");

    // Respeta el filtro de sede y de turno.
    const f1 = buildPresenceBoard(input, NOW, { day: DAY, period: "todos", facilityId: "F1", incompleteSince: since });
    expect(f1.incomplete.map((i) => i.workerName)).not.toContain("Otilia");
    const evening = buildPresenceBoard(input, NOW, { day: DAY, period: "vespertino", incompleteSince: since });
    expect(evening.incomplete.map((i) => i.workerName)).not.toContain("Olga");
  });

  it("devuelve un tablero vacío sin guardias", () => {
    const empty = buildPresenceBoard([], NOW, { day: DAY, period: "todos" });
    expect(empty).toEqual({
      shiftCount: 0,
      rosterCount: 0,
      inService: [],
      responsibles: [],
      expected: [],
      left: [],
      absences: [],
      uncovered: [],
      incomplete: [],
      incidentCounts: { late: 0, earlyLeave: 0, afterEnd: 0, substitutions: 0 },
    });
  });

  it("cuenta quién tiene guardia (asignaciones no canceladas de las guardias del filtro)", () => {
    expect(board.rosterCount).toBe(9); // A: 5 (sin Pedro), B: 1, C: 2, D: 1
    expect(board.absences).toEqual([]);
  });

  it("agrega a «en servicio» la llegada tardía del resumen", () => {
    const luis = board.inService.find((i) => i.workerName === "Luis");
    expect(luis?.lateMinutes).toBe(20); // 13:20 con inicio 13:00 y tolerancia 10
    expect(luis?.earlyLeaveMinutes).toBeNull();
    expect(luis?.afterEndMinutes).toBe(0);
    expect(luis?.substituteFor).toBeNull();
    expect(luis?.shiftEnded).toBe(false);
    expect(luis?.checkOutDeadline).toBeNull();
    const ana = board.inService.find((i) => i.workerName === "Ana");
    expect(ana?.lateMinutes).toBeNull(); // 13:05, dentro de la tolerancia
    expect(board.incidentCounts).toEqual({ late: 1, earlyLeave: 0, afterEnd: 0, substitutions: 0 });
    // Jorge salió antes, pero la guardia sigue en curso: aún no es «salida anticipada».
    expect(board.left[0].earlyLeaveMinutes).toBeNull();
  });
});

describe("buildPresenceBoard: incidencias, sustituciones y ausencias", () => {
  // Guardia de madrugada (00:00–08:00 local = 07:00Z–15:00Z) que terminó hace 1 h.
  const ended = build({
    id: "G",
    start: "2026-10-17T07:00:00Z",
    end: "2026-10-17T15:00:00Z",
    minStaff: 1,
    responsible: { id: "wAus", full_name: "Aurora Ausente" },
    assignments: [
      { id: "aTemp", workerId: "wTemp", name: "Teresa", sessions: [{ in: "2026-10-17T06:58:00Z", out: "2026-10-17T14:30:00Z" }] },
      { id: "aTarde", workerId: "wTarde", name: "Tadeo", sessions: [{ in: "2026-10-17T07:20:00Z", out: "2026-10-17T15:45:00Z" }] },
      {
        id: "aCubre",
        workerId: "wCubre",
        name: "Carmen",
        substituteFor: { id: "wAus", name: "Aurora Ausente" },
        sessions: [{ in: "2026-10-17T06:55:00Z", out: "2026-10-17T15:00:00Z" }],
      },
      // Sigue con entrada abierta después del término, dentro del margen (240 min).
      { id: "aSigue", workerId: "wSigue", name: "Simón", substituteFor: { id: "wOculta", name: null }, sessions: [{ in: "2026-10-17T07:05:00Z" }] },
      { id: "aAus", workerId: "wAus", name: "Aurora Ausente", status: "ausencia_justificada", statusReason: "  Incapacidad médica  " },
      { id: "aFalto", workerId: "wFalto", name: "Fidel", status: "inasistencia_confirmada", statusReason: "No se presentó; confirmado con la sede" },
      { id: "aSinMotivo", workerId: "wSinMotivo", name: "Beatriz", status: "ausencia_justificada", statusReason: null },
      { id: "aCancel", workerId: "wCancel", name: "Cancelado", status: "cancelado" },
    ],
  });
  const b = buildPresenceBoard([ended], NOW, { day: DAY, period: "todos" }, { graceMinutes: GRACE });

  it("registra salida anticipada, llegada tardía y permanencia adicional de quienes ya salieron", () => {
    const byName = Object.fromEntries(b.left.map((l) => [l.workerName, l]));
    expect(byName["Teresa"]).toMatchObject({ lateMinutes: null, earlyLeaveMinutes: 30, afterEndMinutes: 0, substituteFor: null });
    expect(byName["Tadeo"]).toMatchObject({ lateMinutes: 20, earlyLeaveMinutes: null, afterEndMinutes: 45 });
    expect(byName["Carmen"]).toMatchObject({ lateMinutes: null, earlyLeaveMinutes: null, afterEndMinutes: 0, substituteFor: "Aurora Ausente" });
    expect(b.incidentCounts).toEqual({ late: 1, earlyLeave: 1, afterEnd: 1, substitutions: 2 });
  });

  it("marca a quien sigue en servicio después del término y hasta cuándo puede registrar salida", () => {
    expect(b.inService).toHaveLength(1);
    const simon = b.inService[0];
    expect(simon.workerName).toBe("Simón");
    expect(simon.shiftEnded).toBe(true);
    expect(simon.checkOutDeadline).toBe("2026-10-17T19:00:00.000Z"); // término + 240 min (mismo margen que check_out)
    expect(simon.substituteFor).toBe("otra persona"); // RLS ocultó el nombre
    // Sin margen conocido no se inventa una hora límite.
    const noGrace = buildPresenceBoard([ended], NOW, { day: DAY, period: "todos" });
    expect(noGrace.inService[0].shiftEnded).toBe(true);
    expect(noGrace.inService[0].checkOutDeadline).toBeNull();
  });

  it("lista ausencias justificadas e inasistencias con su motivo, fuera de pendientes e incompletos", () => {
    expect(b.absences.map((a) => [a.workerName, a.status, a.reason])).toEqual([
      ["Aurora Ausente", "ausencia_justificada", "Incapacidad médica"],
      ["Beatriz", "ausencia_justificada", null],
      ["Fidel", "inasistencia_confirmada", "No se presentó; confirmado con la sede"],
    ]);
    expect(b.absences[0].changedAt).toBe("2026-10-17T15:30:00.000Z");
    expect(b.absences[0].workerId).toBe("wAus");
    const others = [...b.expected, ...b.incomplete, ...b.left, ...b.inService].map((x) => x.workerName);
    expect(others).not.toContain("Fidel");
    expect(others).not.toContain("Aurora Ausente");
    expect(b.rosterCount).toBe(7); // sin la asignación cancelada
    expect(b.responsibles[0].presence).toBe("ausente");
  });

  it("no toma ausencias de guardias anteriores (solo aportan registros incompletos)", () => {
    const later = new Date("2026-10-18T16:00:00Z");
    const next = buildPresenceBoard([ended], later, { day: "2026-10-18", period: "todos", incompleteSince: new Date(later.getTime() - 7 * 86_400_000) });
    expect(next.absences).toEqual([]);
    expect(next.rosterCount).toBe(0);
  });
});

describe("textos del tablero", () => {
  it("etiqueta las incidencias con texto (señales, no sanciones)", () => {
    expect(incidentLabels({ lateMinutes: 12, earlyLeaveMinutes: 30, afterEndMinutes: 45, substituteFor: "Ana López" })).toEqual([
      "Llegada tardía 12 min",
      "Salida anticipada 30 min",
      "Permanencia adicional 45 min (tiempo registrado adicional)",
      "Cubre a Ana López",
    ]);
    expect(incidentLabels({ lateMinutes: null, earlyLeaveMinutes: null, afterEndMinutes: 0, substituteFor: null })).toEqual([]);
    expect(incidentLabels({ lateMinutes: 0, earlyLeaveMinutes: 0 })).toEqual([]);
  });

  it("filtro de sedes: «Todas las sedes» para administración, «Todas mis sedes» para los demás", () => {
    expect(allFacilitiesLabel(true)).toBe("Todas las sedes");
    expect(allFacilitiesLabel(false)).toBe("Todas mis sedes");
  });

  it("enlaza al historial del trabajador", () => {
    expect(workerHistoryHref("d1000000-0000-4000-8000-000000000001")).toBe("/historial/trabajador/d1000000-0000-4000-8000-000000000001");
  });

  it("acceso rápido a Guardias: auditoría solo consulta", () => {
    expect(guardiasQuickLinkDescription(false)).toBe("Consultar guardias");
    expect(guardiasQuickLinkDescription(true)).toBe("Programar, asignar y revisar guardias");
  });
});

describe("secciones del tablero (interfaz)", () => {
  const ended = build({
    id: "H",
    start: "2026-10-17T07:00:00Z",
    end: "2026-10-17T15:00:00Z",
    responsible: { id: "wTarde", full_name: "Tadeo" },
    assignments: [
      { id: "hTarde", workerId: "wTarde", name: "Tadeo", sessions: [{ in: "2026-10-17T07:20:00Z", out: "2026-10-17T15:45:00Z" }] },
      { id: "hTemp", workerId: "wTemp", name: "Teresa", substituteFor: { id: "wAus", name: "Aurora" }, sessions: [{ in: "2026-10-17T07:00:00Z", out: "2026-10-17T14:30:00Z" }] },
      { id: "hSigue", workerId: "wSigue", name: "Simón", sessions: [{ in: "2026-10-17T07:30:00Z" }] },
      { id: "hAus", workerId: "wAus", name: "Aurora", status: "ausencia_justificada", statusReason: "Cita médica" },
    ],
  });
  const b = buildPresenceBoard([ended], NOW, { day: DAY, period: "todos" }, { graceMinutes: GRACE });

  it("«Ya salieron» muestra incidencias y enlaza cada nombre a su historial", () => {
    render(createElement(LeftSection, { items: b.left, day: DAY }));
    const tadeo = screen.getByRole("link", { name: "Tadeo" });
    expect(tadeo).toHaveAttribute("href", "/historial/trabajador/wTarde");
    const row = tadeo.closest("tr") as HTMLElement;
    expect(within(row).getByText("Llegada tardía 20 min")).toBeInTheDocument();
    expect(within(row).getByText("Permanencia adicional 45 min (tiempo registrado adicional)")).toBeInTheDocument();
    const teresa = screen.getByRole("link", { name: "Teresa" }).closest("tr") as HTMLElement;
    expect(within(teresa).getByText("Salida anticipada 30 min")).toBeInTheDocument();
    expect(within(teresa).getByText("Cubre a Aurora")).toBeInTheDocument();
  });

  it("«En servicio» explica que la salida con la hora actual tiene límite tras el término", () => {
    render(createElement(InServiceSection, { items: b.inService, day: DAY }));
    expect(screen.getByRole("link", { name: "Simón" })).toHaveAttribute("href", "/historial/trabajador/wSigue");
    expect(screen.getByText("Llegada tardía 30 min")).toBeInTheDocument();
    expect(screen.getByText(/Su guardia ya terminó/)).toBeInTheDocument();
    // 19:00Z = 12:00 en Mazatlán.
    expect(screen.getByText(/hasta las 12:00; después requiere «Corregir registro» con la hora real/)).toBeInTheDocument();
  });

  it("«Ausencias justificadas e inasistencias» muestra estado y motivo", () => {
    render(createElement(AbsenceSection, { items: b.absences }));
    expect(screen.getByText("Ausencias justificadas e inasistencias (1)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aurora" })).toHaveAttribute("href", "/historial/trabajador/wAus");
    expect(screen.getByText("Ausencia justificada")).toBeInTheDocument();
    expect(screen.getByText("Motivo: Cita médica")).toBeInTheDocument();
  });

  it("el responsable también enlaza a su historial", () => {
    render(createElement(ResponsiblesSection, { items: b.responsibles, day: DAY }));
    expect(screen.getByRole("link", { name: "Tadeo" })).toHaveAttribute("href", "/historial/trabajador/wTarde");
    expect(screen.getByText("Ya registró salida")).toBeInTheDocument();
  });

  it("el filtro de sedes usa «Todas las sedes» solo para administración", () => {
    const props = { facilities: [{ id: "F1", official_name: "Sede F1" }], facilityId: null, day: DAY, period: "todos" as const };
    const { unmount } = render(createElement(PresenceFilters, { ...props, isAdmin: true }));
    expect(screen.getByRole("option", { name: "Todas las sedes" })).toBeInTheDocument();
    unmount();
    render(createElement(PresenceFilters, { ...props, isAdmin: false }));
    expect(screen.getByRole("option", { name: "Todas mis sedes" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Todas las sedes" })).toBeNull();
  });
});

describe("summarizeHome", () => {
  it("resume el día: guardias de hoy, personas en servicio, cobertura e incompletos de 7 días", () => {
    const s = summarizeHome(ALL, NOW, 7);
    expect(s.shiftsToday).toBe(4); // A, B, C, D (sin cancelada ni la del 19)
    expect(s.shiftsInProgress).toBe(2); // A y D
    expect(s.peopleInService).toBe(4); // Rosa, Ana, Luis, Tomás
    expect(s.insufficientCoverage).toBe(2); // A y B
    expect(s.incompleteRecent).toBe(1); // Raúl
    expect(s.noRecordsRecent).toBe(1); // Elena
  });

  it("no cuenta incompletos de guardias que terminaron hace más de 7 días", () => {
    const old = build({
      id: "OLD",
      start: "2026-10-01T13:00:00Z",
      end: "2026-10-01T21:00:00Z",
      assignments: [{ id: "aOld", workerId: "wOld", name: "Antigua", sessions: [{ in: "2026-10-01T13:00:00Z" }] }],
    });
    const s = summarizeHome([old], NOW, 7);
    expect(s.incompleteRecent).toBe(0);
    expect(s.shiftsToday).toBe(0);
  });

  it("cuenta una sola vez a la persona en servicio", () => {
    const s = summarizeHome([shiftA, shiftA], NOW, 7);
    expect(s.peopleInService).toBe(3);
  });
});

function specOf(id: string): ShiftSpec {
  return {
    id,
    start: "2026-10-17T13:00:00Z",
    end: "2026-10-17T21:00:00Z",
    assignments: [{ id: `${id}-a`, workerId: `${id}-w`, name: "Persona puntual" }],
  };
}
