// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { inflateSync } from "node:zlib";
import { summarizeAttendance, type AssignmentStatus, type SessionInput, type ShiftStatus } from "@/lib/attendance/calc";
import type { AssignmentRow, ShiftRow, ShiftWithAttendance } from "@/lib/attendance/load";
import { buildReportRows, reportTotals, summarizeBy, timeRangeLabel } from "@/lib/reports/rows";
import {
  DETAIL_COLUMNS,
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
import type { ReportFilters } from "@/lib/reports/params";

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
      sessions: [],
      summary,
    };
  });
  return {
    shift,
    effectiveStatus: shift.status,
    facility: { id: options.facility.id, official_name: options.facility.name, timezone: options.facility.tz, arrival_tolerance_minutes: 10, state_id: 18, municipality_id: null },
    responsible: null,
    assignments,
    coverage: { assigned: assignments.length, inService: 0, minStaff: 1, maxStaff: null, insufficient: false },
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

// ---------------------------------------------------------------------------
const FILTERS: ReportFilters = {
  desde: "2026-10-11",
  hasta: "2026-10-17",
  facilityId: FAC_A.id,
  stateId: 18,
  workerId: W1,
  attendance: "",
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
    assignments: [{ id: "x1", workerId: W1, workerName: "Ana Peña", sessions: [{ checkInAt: "2026-10-16T15:20:00Z", checkOutAt: "2026-10-16T23:30:00Z" }] }],
  });
  const meta: ReportMeta = {
    title: "Reporte de guardias: asistencia registrada",
    generatedAt: NOW,
    generatedTimeZone: MZT,
    requesterName: "Coordinación (demo)",
    requesterRole: "Coordinación",
    filterLines: describeFilters(FILTERS, { facility: FAC_A.name, state: "Nayarit", worker: "Ana Peña" }),
  };
  const doc = buildReportDocument(meta, buildReportRows([shift], { now: NOW }));

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
    // Total registrado 490 min = 8.17 h
    expect(texts).toContain("8.17");
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
  });
});
