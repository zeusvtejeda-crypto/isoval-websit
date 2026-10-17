// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { inflateSync } from "node:zlib";
import { summarizeAttendance, type AssignmentStatus, type SessionInput, type ShiftStatus } from "@/lib/attendance/calc";
import type { AssignmentRow, SessionRow, ShiftRow, ShiftWithAttendance } from "@/lib/attendance/load";
import {
  attachIncidentNotes,
  buildReportRows,
  justificationText,
  reportTotals,
  sessionObservations,
  summarizeBy,
  timeRangeLabel,
  type IncidentNoteLite,
} from "@/lib/reports/rows";
import {
  DETAIL_COLUMNS,
  GAP_LABEL,
  buildReportDocument,
  contentDisposition,
  describeFilters,
  exportFileName,
  formatHoursMinutes,
  pdfCell,
  pdfSafe,
  slugify,
  xlsxCell,
  type ReportMeta,
} from "@/lib/reports/document";
import { renderXlsx } from "@/lib/reports/xlsx";
import { renderPdf } from "@/lib/reports/pdf";
import type { IncidentFilter, ReportFilters } from "@/lib/reports/params";

// ---------------------------------------------------------------------------
// Datos de prueba: mismo cálculo que la aplicación (summarizeAttendance).
// ---------------------------------------------------------------------------
const MZT = "America/Mazatlan"; // UTC-7 (sin horario de verano)
const BDB = "America/Bahia_Banderas"; // UTC-6

type FacilityFixture = { id: string; name: string; tz: string };
const FAC_A: FacilityFixture = { id: "f0000000-0000-4000-8000-00000000000a", name: "[DEMO] Hospital A", tz: MZT };
const FAC_B: FacilityFixture = { id: "f0000000-0000-4000-8000-00000000000b", name: "[DEMO] Hospital B (Bahía)", tz: BDB };

type AssignmentFixture = {
  id: string;
  workerId: string;
  workerName: string;
  status?: AssignmentStatus;
  substituteFor?: { id: string; full_name: string } | null;
  sessions?: Array<Omit<SessionInput, "id">>;
  /** Notas de cada sesión (mismo índice que `sessions`). */
  sessionNotes?: Array<string | null>;
};

let seq = 0;

function makeShift(options: {
  facility: FacilityFixture;
  startsAt: string;
  endsAt: string;
  status?: ShiftStatus;
  assignments: AssignmentFixture[];
  now: Date;
}): ShiftWithAttendance {
  const shiftId = `s${++seq}`;
  const shift: ShiftRow = {
    id: shiftId,
    facility_id: options.facility.id,
    title: null,
    meeting_point: "Acceso principal",
    starts_at: options.startsAt,
    ends_at: options.endsAt,
    responsible_worker_id: null,
    min_staff: 1,
    max_staff: null,
    instructions: null,
    status: options.status ?? "programada",
    cancel_reason: options.status === "cancelada" ? "Prueba" : null,
    is_demo: true,
    change_reason: null,
    created_by: null,
    updated_by: null,
    created_at: options.startsAt,
    updated_at: options.startsAt,
    effective_status: null,
  };
  const assignments = options.assignments.map((a) => {
    const assignment: AssignmentRow = {
      id: a.id,
      shift_id: shiftId,
      worker_id: a.workerId,
      assigned_point: null,
      substitute_for_worker_id: a.substituteFor?.id ?? null,
      status: a.status ?? "asignado",
      status_reason: null,
      status_changed_by: null,
      status_changed_at: null,
      notes: null,
      change_reason: null,
      created_by: null,
      created_at: options.startsAt,
      updated_at: options.startsAt,
    };
    const sessions: SessionInput[] = (a.sessions ?? []).map((s, i) => ({ ...s, id: `${a.id}-${i}` }));
    const sessionRows: SessionRow[] = sessions.map((s, i) => ({
      id: s.id,
      assignment_id: a.id,
      shift_id: shiftId,
      worker_id: a.workerId,
      facility_id: options.facility.id,
      check_in_at: new Date(s.checkInAt).toISOString(),
      check_in_by: "u-demo",
      check_in_method: s.checkInMethod ?? "propio",
      check_in_reason: null,
      check_in_request_id: `${s.id}-in`,
      qr_check_in_token_id: null,
      qr_check_out_token_id: null,
      check_out_at: s.checkOutAt ? new Date(s.checkOutAt).toISOString() : null,
      check_out_by: s.checkOutAt ? "u-demo" : null,
      check_out_method: s.checkOutAt ? (s.checkOutMethod ?? "propio") : null,
      check_out_reason: null,
      check_out_request_id: s.checkOutAt ? `${s.id}-out` : null,
      created_at: new Date(s.checkInAt).toISOString(),
      notes: a.sessionNotes?.[i] ?? null,
      record_status: s.recordStatus ?? "vigente",
      status_changed_at: null,
      status_changed_by: null,
      status_reason: null,
      supersedes_id: s.supersedesId ?? null,
    }));
    const summary = summarizeAttendance(
      { startsAt: options.startsAt, endsAt: options.endsAt, status: shift.status },
      { status: assignment.status, substituteForWorkerId: assignment.substitute_for_worker_id },
      sessions,
      { toleranceMinutes: 10, openSessionGraceMinutes: 240, now: options.now },
    );
    return {
      assignment,
      worker: { id: a.workerId, full_name: a.workerName, internal_code: `TRA-${a.id}`, area: null, position: null, facility_id: options.facility.id },
      substituteFor: a.substituteFor ?? null,
      sessions: sessionRows,
      summary,
    };
  });
  return {
    shift,
    effectiveStatus: shift.status,
    facility: { id: options.facility.id, official_name: options.facility.name, timezone: options.facility.tz, arrival_tolerance_minutes: 10, state_id: 18, municipality_id: null },
    responsible: null,
    assignments,
    coverage: { assigned: assignments.length, inService: 0, attended: 0, minStaff: 1, maxStaff: null, insufficient: false },
  };
}

const NOW = new Date("2026-10-18T20:00:00Z");
const W1 = "a0000000-0000-4000-8000-000000000001";
const W2 = "a0000000-0000-4000-8000-000000000002";
const W3 = "a0000000-0000-4000-8000-000000000003";

// ---------------------------------------------------------------------------
describe("buildReportRows: zonas horarias", () => {
  it("muestra horas y fecha en la zona de cada sede e indica +1 día", () => {
    // Misma hora UTC: 06:30Z = 23:30 del 16 en Mazatlán y 00:30 del 17 en Bahía de Banderas.
    const a = makeShift({
      facility: FAC_A,
      startsAt: "2026-10-17T06:30:00Z",
      endsAt: "2026-10-17T14:30:00Z",
      now: NOW,
      assignments: [{ id: "a1", workerId: W1, workerName: "Ana Demo" }],
    });
    const b = makeShift({
      facility: FAC_B,
      startsAt: "2026-10-17T06:30:00Z",
      endsAt: "2026-10-17T14:30:00Z",
      now: NOW,
      assignments: [{ id: "b1", workerId: W2, workerName: "Beto Demo" }],
    });
    const rows = buildReportRows([a, b], { now: NOW });
    const ra = rows.find((r) => r.assignmentId === "a1");
    const rb = rows.find((r) => r.assignmentId === "b1");
    expect(ra?.localDate).toBe("2026-10-16");
    expect(ra?.scheduleLabel).toBe("23:30 – 07:30 (+1 día)");
    expect(ra?.startLocal).toBe("16/10/2026 23:30");
    expect(ra?.zoneOffset).toBe("GMT-7");
    expect(rb?.localDate).toBe("2026-10-17");
    expect(rb?.scheduleLabel).toBe("00:30 – 08:30");
    expect(rb?.startLocal).toBe("17/10/2026 00:30");
    expect(rb?.timeZone).toBe(BDB);
  });

  it("filtra por la fecha LOCAL de inicio de cada sede", () => {
    const a = makeShift({ facility: FAC_A, startsAt: "2026-10-17T06:30:00Z", endsAt: "2026-10-17T14:30:00Z", now: NOW, assignments: [{ id: "a1", workerId: W1, workerName: "Ana" }] });
    const b = makeShift({ facility: FAC_B, startsAt: "2026-10-17T06:30:00Z", endsAt: "2026-10-17T14:30:00Z", now: NOW, assignments: [{ id: "b1", workerId: W2, workerName: "Beto" }] });
    const rows = buildReportRows([a, b], { desde: "2026-10-17", hasta: "2026-10-17", now: NOW });
    expect(rows.map((r) => r.assignmentId)).toEqual(["b1"]);
  });

  it("las horas de entrada y salida se muestran en la zona de la sede", () => {
    const b = makeShift({
      facility: FAC_B,
      startsAt: "2026-10-17T14:00:00Z", // 08:00 en Bahía
      endsAt: "2026-10-17T22:00:00Z",
      now: NOW,
      assignments: [{ id: "b1", workerId: W2, workerName: "Beto", sessions: [{ checkInAt: "2026-10-17T13:55:00Z", checkOutAt: "2026-10-17T22:05:00Z" }] }],
    });
    const [row] = buildReportRows([b], { now: NOW });
    expect(row.firstCheckInLocal).toBe("17/10/2026 07:55");
    expect(row.lastCheckOutLocal).toBe("17/10/2026 16:05");
  });

  it("timeRangeLabel indica varios días", () => {
    expect(timeRangeLabel("2026-10-17T05:00:00Z", "2026-10-19T03:00:00Z", MZT)).toBe("22:00 – 20:00 (+2 días)");
  });
});

describe("buildReportRows: totales y estados", () => {
  const finished = makeShift({
    facility: FAC_A,
    startsAt: "2026-10-16T15:00:00Z", // 08:00–16:00 Mazatlán
    endsAt: "2026-10-16T23:00:00Z",
    now: NOW,
    assignments: [
      // Llega 20 min tarde y se queda 30 min más: 7 h 40 dentro + 30 fuera.
      { id: "f1", workerId: W1, workerName: "Ana", sessions: [{ checkInAt: "2026-10-16T15:20:00Z", checkOutAt: "2026-10-16T23:30:00Z" }] },
      // Sale 1 h antes; sustitución.
      {
        id: "f2",
        workerId: W2,
        workerName: "Beto",
        substituteFor: { id: W3, full_name: "Carla" },
        sessions: [{ checkInAt: "2026-10-16T14:55:00Z", checkOutAt: "2026-10-16T22:00:00Z" }],
      },
      // Cancelada: no suma.
      { id: "f3", workerId: W3, workerName: "Carla", status: "cancelado" },
    ],
  });

  it("copia los minutos del cálculo y suma con totalize (sin canceladas)", () => {
    const rows = buildReportRows([finished], { attendance: "todas", now: NOW });
    expect(rows).toHaveLength(3);
    const f1 = rows.find((r) => r.assignmentId === "f1")!;
    expect(f1.scheduledMinutes).toBe(480);
    expect(f1.withinScheduleMinutes).toBe(460);
    expect(f1.outsideScheduleMinutes).toBe(30);
    expect(f1.totalMinutes).toBe(490);
    expect(f1.differenceMinutes).toBe(10);
    expect(f1.lateMinutes).toBe(20);
    expect(f1.extraStayMinutes).toBe(30);
    const f2 = rows.find((r) => r.assignmentId === "f2")!;
    expect(f2.earlyLeaveMinutes).toBe(60);
    expect(f2.substitution).toBe(true);
    expect(f2.substituteForName).toBe("Carla");
    expect(f2.outsideScheduleMinutes).toBe(5);

    // El PDF (con menos columnas) conserva la clave y a quién se sustituye.
    const trabajador = DETAIL_COLUMNS.find((c) => c.key === "trabajador")!;
    const sustitucion = DETAIL_COLUMNS.find((c) => c.key === "sustitucion")!;
    expect(pdfCell(trabajador, f1)).toBe("Ana\nTRA-f1");
    expect(xlsxCell(trabajador, f1)).toBe("Ana");
    expect(pdfCell(sustitucion, f2)).toBe("Sí (de Carla)");
    expect(pdfCell(sustitucion, f1)).toBe("No");
    expect(xlsxCell(sustitucion, f2)).toBe("Sí");

    const totals = reportTotals(rows);
    expect(totals.assignments).toBe(2); // la cancelada no cuenta
    expect(totals.scheduledMinutes).toBe(960);
    expect(totals.totalMinutes).toBe(490 + 425);
    expect(totals.afterEndMinutes).toBe(30);
    expect(totals.late).toBe(1);
    expect(totals.earlyLeave).toBe(1);
    expect(totals.substitutions).toBe(1);
  });

  it("por omisión excluye canceladas; 'todas' las incluye; filtra por estado", () => {
    expect(buildReportRows([finished], { now: NOW }).map((r) => r.assignmentId)).toEqual(["f1", "f2"]);
    expect(buildReportRows([finished], { attendance: "cancelada", now: NOW }).map((r) => r.assignmentId)).toEqual(["f3"]);
    expect(buildReportRows([finished], { attendance: "finalizada", now: NOW })).toHaveLength(2);
  });

  it("filtra por trabajador", () => {
    expect(buildReportRows([finished], { workerId: W2, now: NOW }).map((r) => r.workerName)).toEqual(["Beto"]);
  });

  it("los registros incompletos no suman horas", () => {
    const shift = makeShift({
      facility: FAC_A,
      startsAt: "2026-10-17T15:00:00Z",
      endsAt: "2026-10-17T23:00:00Z",
      now: NOW, // terminó hace 21 h: más que el margen de 4 h
      assignments: [{ id: "i1", workerId: W1, workerName: "Ana", sessions: [{ checkInAt: "2026-10-17T15:00:00Z", checkOutAt: null }] }],
    });
    const [row] = buildReportRows([shift], { now: NOW });
    expect(row.status).toBe("registro_incompleto");
    expect(row.incomplete).toBe(true);
    expect(row.openSession).toBe(true);
    expect(row.totalMinutes).toBe(0);
    expect(row.withinScheduleMinutes).toBe(0);
    expect(row.lastCheckOutLocal).toBeNull();
    expect(row.firstCheckInLocal).toBe("17/10/2026 08:00");
    const salida = DETAIL_COLUMNS.find((c) => c.key === "salida")!;
    const total = DETAIL_COLUMNS.find((c) => c.key === "total")!;
    expect(pdfCell(salida, row)).toBe("Sin salida");
    expect(xlsxCell(total, row)).toBe(0);
    const totals = reportTotals([row]);
    expect(totals.incomplete).toBe(1);
    expect(totals.totalMinutes).toBe(0);
    expect(totals.scheduledMinutes).toBe(480);
    // Filtro de pendientes de revisión.
    expect(buildReportRows([shift], { attendance: "revision", now: NOW })).toHaveLength(1);
    expect(buildReportRows([shift], { attendance: "registro_incompleto", now: NOW })).toHaveLength(1);
  });

  it("excluye guardias que no han iniciado cuando onlyStarted", () => {
    const future = makeShift({ facility: FAC_A, startsAt: "2026-10-19T15:00:00Z", endsAt: "2026-10-19T23:00:00Z", now: NOW, assignments: [{ id: "p1", workerId: W1, workerName: "Ana" }] });
    expect(buildReportRows([future], { onlyStarted: true, now: NOW })).toHaveLength(0);
    expect(buildReportRows([future], { onlyStarted: false, now: NOW })).toHaveLength(1);
  });

  it("ordena por fecha, luego sede y nombre (nunca por desempeño)", () => {
    const early = makeShift({
      facility: FAC_B,
      startsAt: "2026-10-15T15:00:00Z",
      endsAt: "2026-10-15T23:00:00Z",
      now: NOW,
      assignments: [
        { id: "e2", workerId: W2, workerName: "Zoe" },
        { id: "e1", workerId: W1, workerName: "Ángel" },
      ],
    });
    const rows = buildReportRows([finished, early], { now: NOW });
    expect(rows.map((r) => r.assignmentId)).toEqual(["e1", "e2", "f1", "f2"]);
  });

  it("resume por sede y por trabajador en orden alfabético", () => {
    const rows = buildReportRows([finished], { now: NOW });
    const byWorker = summarizeBy(rows, "worker");
    expect(byWorker.map((g) => g.label)).toEqual(["Ana", "Beto"]);
    expect(byWorker[0].totals.totalMinutes).toBe(490);
    const byFacility = summarizeBy(rows, "facility");
    expect(byFacility).toHaveLength(1);
    expect(byFacility[0].totals.assignments).toBe(2);
  });
});

describe("buildReportRows: filtro por incidencia", () => {
  const shift = makeShift({
    facility: FAC_A,
    startsAt: "2026-10-16T15:00:00Z", // 08:00–16:00 Mazatlán
    endsAt: "2026-10-16T23:00:00Z",
    now: NOW,
    assignments: [
      // Llegada tardía (20 min) y permanencia adicional (30 min).
      { id: "t1", workerId: W1, workerName: "Ana", sessions: [{ checkInAt: "2026-10-16T15:20:00Z", checkOutAt: "2026-10-16T23:30:00Z" }] },
      // Salida anticipada (1 h) y sustitución.
      {
        id: "t2",
        workerId: W2,
        workerName: "Beto",
        substituteFor: { id: W3, full_name: "Carla" },
        sessions: [{ checkInAt: "2026-10-16T14:55:00Z", checkOutAt: "2026-10-16T22:00:00Z" }],
      },
      // Sin incidencias.
      { id: "t3", workerId: W3, workerName: "Carla", sessions: [{ checkInAt: "2026-10-16T14:58:00Z", checkOutAt: "2026-10-16T23:00:00Z" }] },
    ],
  });
  const earlier = makeShift({
    facility: FAC_B,
    startsAt: "2026-10-15T14:00:00Z",
    endsAt: "2026-10-15T22:00:00Z",
    now: NOW,
    assignments: [{ id: "t0", workerId: W3, workerName: "Carla", sessions: [{ checkInAt: "2026-10-15T14:40:00Z", checkOutAt: "2026-10-15T22:00:00Z" }] }],
  });

  it("deja solo las asignaciones con esa incidencia calculada", () => {
    const ids = (incident: IncidentFilter | null) => buildReportRows([shift, earlier], { incident, now: NOW }).map((r) => r.assignmentId);
    expect(ids("llegada_tardia")).toEqual(["t0", "t1"]);
    expect(ids("permanencia_adicional")).toEqual(["t1"]);
    expect(ids("salida_anticipada")).toEqual(["t2"]);
    expect(ids("sustitucion")).toEqual(["t2"]);
    expect(ids("correccion_administrativa")).toEqual([]);
    expect(ids("registro_incompleto")).toEqual([]);
    // Sin filtro: todas, con o sin incidencias.
    expect(ids("")).toEqual(["t0", "t1", "t2", "t3"]);
    expect(ids(null)).toEqual(["t0", "t1", "t2", "t3"]);
  });

  it("conserva el orden por fecha (nunca de «mejor» a «peor») y se combina con los demás filtros", () => {
    const late = buildReportRows([shift, earlier], { incident: "llegada_tardia", now: NOW });
    // t0 (15/oct) antes que t1 (16/oct) aunque t1 tenga menos retraso.
    expect(late.map((r) => [r.assignmentId, r.lateMinutes])).toEqual([
      ["t0", 40],
      ["t1", 20],
    ]);
    expect(buildReportRows([shift, earlier], { incident: "llegada_tardia", workerId: W1, now: NOW }).map((r) => r.assignmentId)).toEqual(["t1"]);
    expect(buildReportRows([shift, earlier], { incident: "llegada_tardia", desde: "2026-10-16", now: NOW }).map((r) => r.assignmentId)).toEqual(["t1"]);
    expect(buildReportRows([shift, earlier], { incident: "llegada_tardia", attendance: "cancelada", now: NOW })).toEqual([]);
  });

  it("filtra registros incompletos y correcciones administrativas", () => {
    const mixed = makeShift({
      facility: FAC_A,
      startsAt: "2026-10-17T15:00:00Z",
      endsAt: "2026-10-17T23:00:00Z",
      now: NOW,
      assignments: [
        { id: "m1", workerId: W1, workerName: "Ana", sessions: [{ checkInAt: "2026-10-17T15:00:00Z", checkOutAt: null }] },
        {
          id: "m2",
          workerId: W2,
          workerName: "Beto",
          sessions: [{ checkInAt: "2026-10-17T15:00:00Z", checkOutAt: "2026-10-17T23:00:00Z", checkInMethod: "correccion", checkOutMethod: "correccion" }],
        },
      ],
    });
    expect(buildReportRows([mixed], { incident: "registro_incompleto", now: NOW }).map((r) => r.assignmentId)).toEqual(["m1"]);
    expect(buildReportRows([mixed], { incident: "correccion_administrativa", now: NOW }).map((r) => r.assignmentId)).toEqual(["m2"]);
  });
});

describe("buildReportRows: tiempo entre salida y regreso, observaciones y justificaciones", () => {
  const shift = makeShift({
    facility: FAC_A,
    startsAt: "2026-10-16T15:00:00Z", // 08:00–16:00 Mazatlán
    endsAt: "2026-10-16T23:00:00Z",
    now: NOW,
    assignments: [
      {
        id: "g1",
        workerId: W1,
        workerName: "Ana",
        // 08:00–12:00 y 13:00–16:00: sale 1 h y regresa (no cuenta).
        sessions: [
          { checkInAt: "2026-10-16T15:00:00Z", checkOutAt: "2026-10-16T19:00:00Z" },
          { checkInAt: "2026-10-16T20:00:00Z", checkOutAt: "2026-10-16T23:00:00Z" },
          // Versión corregida (no vigente): ni suma ni aporta observaciones.
          { checkInAt: "2026-10-16T19:30:00Z", checkOutAt: "2026-10-16T19:45:00Z", recordStatus: "corregido" },
        ],
        sessionNotes: ["Salida a comer", "  Regreso por acceso norte  ", "Nota de una versión corregida"],
      },
      { id: "g2", workerId: W2, workerName: "Beto", sessions: [{ checkInAt: "2026-10-16T15:20:00Z", checkOutAt: "2026-10-16T23:00:00Z" }] },
    ],
  });
  const rows = buildReportRows([shift], { now: NOW });
  const g1 = rows.find((r) => r.assignmentId === "g1")!;
  const g2 = rows.find((r) => r.assignmentId === "g2")!;

  it("copia gapMinutes del cálculo: el hueco no suma al total", () => {
    expect(g1.gapMinutes).toBe(60);
    expect(g1.totalMinutes).toBe(420);
    expect(g1.withinScheduleMinutes).toBe(420);
    expect(g2.gapMinutes).toBe(0);
    const gap = DETAIL_COLUMNS.find((c) => c.key === "entre_salidas")!;
    expect(gap.header).toBe(`${GAP_LABEL} (h)`);
    expect(GAP_LABEL).toBe("Tiempo entre salida y regreso (no cuenta)");
    expect(gap.pdf).toBe(true);
    expect(xlsxCell(gap, g1)).toBe(1);
    expect(pdfCell(gap, g1)).toBe("1:00");
    expect(pdfCell(gap, g2)).toBe("0:00");
  });

  it("las observaciones son las notas de las sesiones vigentes, en orden", () => {
    expect(g1.observations).toEqual(["Salida a comer", "Regreso por acceso norte"]);
    expect(g2.observations).toEqual([]);
    const obs = DETAIL_COLUMNS.find((c) => c.key === "observaciones")!;
    expect(xlsxCell(obs, g1)).toBe("Salida a comer\nRegreso por acceso norte");
    expect(xlsxCell(obs, g2)).toBeNull();
    expect(pdfCell(obs, g2)).toBe("—");
    // Sin repetir notas iguales; ignora vacías.
    expect(
      sessionObservations([
        { notes: "Igual", record_status: "vigente", check_in_at: "2026-10-16T15:00:00Z" },
        { notes: "Igual", record_status: "vigente", check_in_at: "2026-10-16T16:00:00Z" },
        { notes: "   ", record_status: "vigente", check_in_at: "2026-10-16T17:00:00Z" },
        { notes: "Anulada", record_status: "anulado", check_in_at: "2026-10-16T14:00:00Z" },
      ]),
    ).toEqual(["Igual"]);
  });

  it("agrega las justificaciones (incident_notes) por asignación, en el orden del catálogo", () => {
    expect(g2.justifications).toEqual([]);
    const notes: IncidentNoteLite[] = [
      { assignment_id: "g2", incident_type: "salida_anticipada", note: "Ya no aplica", justified: false },
      { assignment_id: "g2", incident_type: "llegada_tardia", note: " Tráfico en la carretera ", justified: true },
      { assignment_id: "otra", incident_type: "llegada_tardia", note: "De otra asignación", justified: true },
    ];
    const withNotes = attachIncidentNotes(rows, notes);
    expect(withNotes.find((r) => r.assignmentId === "g1")!.justifications).toEqual([]);
    const j = withNotes.find((r) => r.assignmentId === "g2")!.justifications;
    expect(j.map((x) => [x.type, x.note, x.justified, x.stale])).toEqual([
      ["llegada_tardia", "Tráfico en la carretera", true, false],
      // g2 no tiene salida anticipada calculada: se marca como «ya no se calcula».
      ["salida_anticipada", "Ya no aplica", false, true],
    ]);
    expect(justificationText(j[0])).toBe("Llegada tardía: Tráfico en la carretera");
    expect(justificationText(j[1])).toBe("Salida anticipada (ya no se calcula; nota sin justificar): Ya no aplica");
    const col = DETAIL_COLUMNS.find((c) => c.key === "justificacion")!;
    const row = withNotes.find((r) => r.assignmentId === "g2")!;
    expect(xlsxCell(col, row)).toBe("Llegada tardía: Tráfico en la carretera\nSalida anticipada (ya no se calcula; nota sin justificar): Ya no aplica");
    expect(pdfCell(col, withNotes.find((r) => r.assignmentId === "g1")!)).toBe("—");
    // Sin notas no se copian las filas.
    expect(attachIncidentNotes(rows, [])).toBe(rows);
  });
});

// ---------------------------------------------------------------------------
const FILTERS: ReportFilters = {
  desde: "2026-10-11",
  hasta: "2026-10-17",
  facilityId: FAC_A.id,
  stateId: 18,
  workerId: W1,
  attendance: "",
  incident: "",
};

describe("contenido de la exportación", () => {
  it("formatea horas, nombres de archivo y encabezados", () => {
    expect(formatHoursMinutes(450)).toBe("7:30");
    expect(formatHoursMinutes(-45)).toBe("-0:45");
    expect(formatHoursMinutes(null)).toBe("—");
    expect(slugify("[DEMO] Unidad de Medicina Familiar Núm. 1")).toBe("demo-unidad-de-medicina-familiar-num-1");
    expect(exportFileName(FILTERS, { facility: "[DEMO] Hospital A", worker: "José Peña" }, "xlsx")).toBe(
      "reporte-guardias_2026-10-11_a_2026-10-17_demo-hospital-a_jose-pena.xlsx",
    );
    expect(exportFileName({ ...FILTERS, facilityId: null, workerId: null }, {}, "pdf")).toBe("reporte-guardias_2026-10-11_a_2026-10-17.pdf");
    expect(contentDisposition("reporte.xlsx")).toBe(`attachment; filename="reporte.xlsx"; filename*=UTF-8''reporte.xlsx`);
  });

  it("describe los filtros, incluido el registro propio forzado", () => {
    const lines = describeFilters(FILTERS, { facility: "[DEMO] Hospital A", state: "Nayarit", worker: "Ana" }, true);
    expect(lines).toContain("Periodo: del 11/10/2026 al 17/10/2026");
    expect(lines).toContain("Sede: [DEMO] Hospital A");
    expect(lines).toContain("Estado (entidad): Nayarit");
    expect(lines).toContain("Trabajador: Ana (solo tus propios registros)");
    expect(lines).toContain("Estado de asistencia: Todos (sin cancelados)");
    expect(lines).toContain("Incidencia: Cualquiera (con o sin incidencias)");
    expect(describeFilters({ ...FILTERS, incident: "llegada_tardia" }, {})).toContain("Incidencia: Llegada tardía");
  });

  it("pdfSafe sustituye caracteres que la fuente del PDF no puede dibujar", () => {
    expect(pdfSafe("Diferencia −0:30 · Peña «ok» – sí")).toBe("Diferencia -0:30 · Peña «ok» – sí");
    expect(pdfSafe("Doğan 漢")).toBe("Dogan ?");
  });
});

describe("render de Excel y PDF", () => {
  const shift = makeShift({
    facility: FAC_A,
    startsAt: "2026-10-16T15:00:00Z",
    endsAt: "2026-10-16T23:00:00Z",
    now: NOW,
    assignments: [
      {
        id: "x1",
        workerId: W1,
        workerName: "Ana Peña",
        // 08:20–12:00 y 12:45–16:30: 45 min entre salida y regreso (no cuentan).
        sessions: [
          { checkInAt: "2026-10-16T15:20:00Z", checkOutAt: "2026-10-16T19:00:00Z" },
          { checkInAt: "2026-10-16T19:45:00Z", checkOutAt: "2026-10-16T23:30:00Z" },
        ],
        sessionNotes: ["Salió a farmacia", null],
      },
    ],
  });
  const meta: ReportMeta = {
    title: "Reporte de guardias: asistencia registrada",
    generatedAt: NOW,
    generatedTimeZone: MZT,
    requesterName: "Coordinación (demo)",
    requesterRole: "Coordinación",
    filterLines: describeFilters(FILTERS, { facility: FAC_A.name, state: "Nayarit", worker: "Ana Peña" }),
  };
  const doc = buildReportDocument(
    meta,
    attachIncidentNotes(buildReportRows([shift], { now: NOW }), [
      { assignment_id: "x1", incident_type: "llegada_tardia", note: "Retraso del transporte", justified: true },
    ]),
  );

  it("genera un libro con hojas Detalle y Resumen y los avisos obligatorios", async () => {
    const bytes = await renderXlsx(doc);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Detalle", "Resumen"]);
    const detail = wb.getWorksheet("Detalle")!;
    const texts: string[] = [];
    detail.eachRow((row) => row.eachCell((cell) => texts.push(String(cell.value ?? ""))));
    const all = texts.join("\n");
    expect(all).toContain("No es una aplicación oficial del IMSS.");
    expect(all).toContain("Permanencia adicional = tiempo registrado adicional, no horas extra pagadas.");
    expect(all).toContain("Entrada registrada no equivale a presencia física verificada.");
    expect(all).toContain("Exportado por: Coordinación (demo) (Coordinación)");
    expect(all).toContain("Generado: 18/10/2026 13:00");
    expect(all).toContain("Ana Peña");
    expect(all).toContain("08:00 – 16:00");
    // Total registrado 445 min = 7.42 h; 45 min entre salida y regreso = 0.75 h.
    expect(texts).toContain("7.42");
    expect(texts).toContain("0.75");
    expect(all).toContain("Tiempo entre salida y regreso (no cuenta) (h)");
    expect(all).toContain("Observaciones (notas de los registros vigentes)");
    expect(all).toContain("Justificación (incidencia: nota)");
    expect(all).toContain("Salió a farmacia");
    expect(all).toContain("Llegada tardía: Retraso del transporte");
    expect(all).toContain("Incidencia: Cualquiera (con o sin incidencias)");
    const summary = wb.getWorksheet("Resumen")!;
    const summaryTexts: string[] = [];
    summary.eachRow((row) => row.eachCell((cell) => summaryTexts.push(String(cell.value ?? ""))));
    expect(summaryTexts.join("\n")).toContain("Resumen por trabajador");
  });

  it("genera un PDF horizontal con el mismo contenido", () => {
    const bytes = renderPdf(doc);
    const file = Buffer.from(bytes);
    // El PDF va comprimido (FlateDecode): se descomprimen los flujos para buscar el texto.
    const parts: string[] = [file.toString("latin1")];
    let pos = 0;
    for (;;) {
      const start = file.indexOf("stream\n", pos);
      if (start < 0) break;
      const end = file.indexOf("\nendstream", start);
      try {
        parts.push(inflateSync(file.subarray(start + 7, end)).toString("latin1"));
      } catch {
        // flujo sin comprimir
      }
      pos = end + 10;
    }
    const raw = parts.join("\n");
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw).toMatch(/\/MediaBox \[0 0 792\.\d* 612\.\d*\]/); // carta horizontal (ancho > alto)
    expect(raw).toContain("No es una aplicaci");
    expect(raw).toContain("Permanencia adicional = tiempo registrado adicional, no horas extra pagadas.");
    expect(raw).toContain("Ana Pe\xf1a");
    expect(raw).toContain("Resumen por trabajador");
    expect(raw).toContain("Observaciones");
    expect(raw).toContain("Justificaci\xf3n");
    expect(raw).toContain("Sali\xf3 a farmacia");
    // La celda puede partirse en varias líneas.
    expect(raw).toContain("Llegada tard\xeda: Retraso");
    expect(raw).toContain("0:45");
  });
});
