/**
 * Contenido de las exportaciones (Excel y PDF), independiente del formato.
 * Funciones puras: encabezado, columnas, totales, nombre de archivo.
 */
import type { TotalsSummary } from "@/lib/attendance/calc";
import { formatDateTime, formatOffset, minutesToHours } from "@/lib/time";
import { attendanceFilterLabel, incidentFilterLabel, type ExportFormat, type ReportFilters } from "./params";
import { justificationText, reportTotals, summarizeBy, type GroupSummary, type ReportRow } from "./rows";
import { EXTRA_TIME_NOTICE, NO_RANKING_NOTICE, NOT_OFFICIAL_NOTICE, ONLY_STARTED_NOTICE, PRESENCE_NOTICE, REPORT_TITLE } from "./texts";

export type FilterLabels = {
  facility?: string | null;
  state?: string | null;
  worker?: string | null;
};

export type ReportMeta = {
  title: string;
  generatedAt: Date;
  /** Zona en la que se expresa la fecha de generación. */
  generatedTimeZone: string;
  requesterName: string;
  requesterRole: string;
  filterLines: string[];
};

export type ReportDocument = {
  meta: ReportMeta;
  rows: ReportRow[];
  totals: TotalsSummary;
  byFacility: GroupSummary[];
  byWorker: GroupSummary[];
};

/** dd/MM/yyyy a partir de yyyy-MM-dd (sin conversión de zona). */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

/** Descripción legible de los filtros aplicados. */
export function describeFilters(filters: ReportFilters, labels: FilterLabels, forcedOwn = false): string[] {
  const worker = filters.workerId
    ? `${labels.worker ?? "Persona seleccionada"}${forcedOwn ? " (solo tus propios registros)" : ""}`
    : "Todas las personas visibles para tu cuenta";
  return [
    `Periodo: del ${dayLabel(filters.desde)} al ${dayLabel(filters.hasta)}`,
    `Sede: ${filters.facilityId ? (labels.facility ?? "Sede seleccionada") : "Todas las sedes de tu alcance"}`,
    `Estado (entidad): ${filters.stateId ? (labels.state ?? `Clave ${filters.stateId}`) : "Todos"}`,
    `Trabajador: ${worker}`,
    `Estado de asistencia: ${attendanceFilterLabel(filters.attendance)}`,
    `Incidencia: ${incidentFilterLabel(filters.incident)}`,
  ];
}

export function buildReportDocument(meta: ReportMeta, rows: ReportRow[]): ReportDocument {
  return {
    meta,
    rows,
    totals: reportTotals(rows),
    byFacility: summarizeBy(rows, "facility"),
    byWorker: summarizeBy(rows, "worker"),
  };
}

/** Líneas del encabezado común (Excel y PDF). */
export function headerLines(meta: ReportMeta): string[] {
  return [
    `Generado: ${formatDateTime(meta.generatedAt, meta.generatedTimeZone)} (${meta.generatedTimeZone}, ${formatOffset(meta.generatedAt, meta.generatedTimeZone)})`,
    `Exportado por: ${meta.requesterName} (${meta.requesterRole})`,
    ...meta.filterLines,
    ONLY_STARTED_NOTICE,
  ];
}

/** Avisos obligatorios de cada exportación. */
export const EXPORT_NOTICES: string[] = [NOT_OFFICIAL_NOTICE, PRESENCE_NOTICE, EXTRA_TIME_NOTICE, NO_RANKING_NOTICE];

export const DEFAULT_REPORT_TITLE = REPORT_TITLE;

/** "7:30", "-0:45", "0:00". Para PDF (horas y minutos). */
export function formatHoursMinutes(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

export type CellKind = "text" | "hours" | "minutes" | "flag";
export type ColumnDef = {
  key: string;
  header: string;
  /** Encabezado corto para PDF. */
  short: string;
  kind: CellKind;
  /** Ancho aproximado en caracteres (Excel). */
  width: number;
  /** Se incluye en el PDF (que tiene menos espacio). */
  pdf: boolean;
  value: (r: ReportRow) => string | number | boolean | null;
  /** Texto alternativo (más corto) para PDF. */
  pdfValue?: (r: ReportRow) => string;
  /** Texto largo: se ajusta en varias líneas (Excel). */
  wrap?: boolean;
};

/** Texto que acompaña al tiempo fuera entre salidas: nunca suma al tiempo registrado. */
export const GAP_LABEL = "Tiempo entre salida y regreso (no cuenta)";

/** Columnas del detalle por asignación. */
export const DETAIL_COLUMNS: ColumnDef[] = [
  { key: "fecha", header: "Fecha (inicio)", short: "Fecha", kind: "text", width: 16, pdf: true, value: (r) => r.dateLabel },
  {
    key: "trabajador",
    header: "Trabajador",
    short: "Trabajador",
    kind: "text",
    width: 30,
    pdf: true,
    value: (r) => r.workerName,
    // El PDF no tiene columna de clave: se muestra debajo del nombre.
    pdfValue: (r) => (r.workerCode ? `${r.workerName}\n${r.workerCode}` : r.workerName),
  },
  { key: "clave", header: "Clave interna", short: "Clave", kind: "text", width: 14, pdf: false, value: (r) => r.workerCode },
  { key: "sede", header: "Sede", short: "Sede", kind: "text", width: 34, pdf: true, value: (r) => r.facilityName },
  { key: "inicio", header: "Inicio programado", short: "Inicio", kind: "text", width: 17, pdf: false, value: (r) => r.startLocal },
  { key: "termino", header: "Término programado", short: "Término", kind: "text", width: 17, pdf: false, value: (r) => r.endLocal },
  {
    key: "horario",
    header: "Horario",
    short: "Horario (zona)",
    kind: "text",
    width: 22,
    pdf: true,
    value: (r) => r.scheduleLabel,
    // El PDF no tiene columna de zona: el desfase va debajo del horario.
    pdfValue: (r) => `${r.scheduleLabel}\n${r.zoneOffset}`,
  },
  { key: "zona", header: "Zona horaria de la sede", short: "Zona", kind: "text", width: 30, pdf: false, value: (r) => `${r.timeZone} (${r.zoneOffset})` },
  { key: "estado", header: "Estado", short: "Estado", kind: "text", width: 26, pdf: true, value: (r) => r.statusLabel },
  { key: "entrada", header: "Primera entrada registrada", short: "Entrada", kind: "text", width: 17, pdf: true, value: (r) => r.firstCheckInLocal },
  { key: "salida", header: "Última salida registrada", short: "Salida", kind: "text", width: 17, pdf: true, value: (r) => (r.openSession ? "Sin salida" : r.lastCheckOutLocal) },
  { key: "programado", header: "Programado (h)", short: "Prog.", kind: "hours", width: 12, pdf: true, value: (r) => r.scheduledMinutes },
  { key: "dentro", header: "Dentro del horario (h)", short: "Dentro", kind: "hours", width: 12, pdf: true, value: (r) => r.withinScheduleMinutes },
  { key: "fuera", header: "Fuera del horario (h)", short: "Fuera", kind: "hours", width: 12, pdf: true, value: (r) => r.outsideScheduleMinutes },
  { key: "total", header: "Total registrado (h)", short: "Total", kind: "hours", width: 12, pdf: true, value: (r) => r.totalMinutes },
  { key: "entre_salidas", header: `${GAP_LABEL} (h)`, short: "Entre salida y regreso (no cuenta)", kind: "hours", width: 16, pdf: true, value: (r) => r.gapMinutes },
  { key: "diferencia", header: "Diferencia: registrado − programado (h)", short: "Dif.", kind: "hours", width: 14, pdf: true, value: (r) => r.differenceMinutes },
  { key: "retraso", header: "Retraso (min)", short: "Retraso", kind: "minutes", width: 10, pdf: true, value: (r) => r.lateMinutes },
  { key: "anticipada", header: "Salida anticipada (min)", short: "Sal. antic.", kind: "minutes", width: 12, pdf: true, value: (r) => r.earlyLeaveMinutes },
  {
    key: "adicional",
    header: "Permanencia adicional: tiempo registrado adicional (h)",
    short: "Perm. adic.",
    kind: "hours",
    width: 16,
    pdf: true,
    value: (r) => r.extraStayMinutes,
  },
  {
    key: "sustitucion",
    header: "Sustitución",
    short: "Sust.",
    kind: "flag",
    width: 11,
    pdf: true,
    value: (r) => r.substitution,
    // El PDF no tiene columna «Sustituye a»: se indica en la misma celda.
    pdfValue: (r) => (r.substitution ? (r.substituteForName ? `Sí (de ${r.substituteForName})` : "Sí") : "No"),
  },
  { key: "sustituye_a", header: "Sustituye a", short: "Sustituye a", kind: "text", width: 26, pdf: false, value: (r) => r.substituteForName },
  { key: "correccion", header: "Corrección administrativa", short: "Corr.", kind: "flag", width: 12, pdf: true, value: (r) => r.corrected },
  { key: "incompleto", header: "Registro incompleto", short: "Incomp.", kind: "flag", width: 12, pdf: true, value: (r) => r.incomplete },
  { key: "revision", header: "Pendiente de revisión", short: "Revisión", kind: "flag", width: 12, pdf: true, value: (r) => r.needsReview },
  { key: "incidencias", header: "Incidencias (señales para revisión)", short: "Incidencias", kind: "text", width: 40, pdf: false, value: (r) => r.incidentLabels.join("; ") || null },
  {
    key: "observaciones",
    header: "Observaciones (notas de la asignación y de los registros vigentes)",
    short: "Observaciones",
    kind: "text",
    width: 40,
    pdf: true,
    wrap: true,
    value: (r) => r.observations.join("\n") || null,
  },
  {
    key: "justificacion",
    header: "Justificación (incidencia: nota)",
    short: "Justificación",
    kind: "text",
    width: 48,
    pdf: true,
    wrap: true,
    value: (r) => r.justifications.map(justificationText).join("\n") || null,
  },
];

export function flagText(value: boolean): string {
  return value ? "Sí" : "No";
}

/** Valor de celda para Excel: horas decimales, minutos enteros, Sí/No o texto. */
export function xlsxCell(column: ColumnDef, row: ReportRow): string | number | null {
  const v = column.value(row);
  if (v == null) return null;
  switch (column.kind) {
    case "hours":
      return minutesToHours(Number(v));
    case "minutes":
      return Math.trunc(Number(v));
    case "flag":
      return flagText(Boolean(v));
    default:
      return String(v);
  }
}

/** Valor de celda para PDF (texto compacto: horas en h:mm). */
export function pdfCell(column: ColumnDef, row: ReportRow): string {
  if (column.pdfValue) return column.pdfValue(row);
  const v = column.value(row);
  if (column.kind === "flag") return flagText(Boolean(v));
  if (v == null) return "—";
  switch (column.kind) {
    case "hours":
      return formatHoursMinutes(Number(v));
    case "minutes":
      return String(Math.trunc(Number(v)));
    default:
      return String(v);
  }
}

export type TotalsEntry = { label: string; kind: "hours" | "count"; value: number };

/** Conceptos del resumen general (mismo orden en Excel y PDF). */
export function totalsEntries(t: TotalsSummary): TotalsEntry[] {
  return [
    { label: "Guardias (asignaciones, sin canceladas)", kind: "count", value: t.assignments },
    { label: "Tiempo programado", kind: "hours", value: t.scheduledMinutes },
    { label: "Registrado dentro del horario", kind: "hours", value: t.withinScheduleMinutes },
    { label: "Registrado fuera del horario", kind: "hours", value: t.outsideScheduleMinutes },
    { label: "Total registrado", kind: "hours", value: t.totalMinutes },
    { label: "Diferencia (registrado − programado)", kind: "hours", value: t.differenceMinutes },
    { label: "Permanencia adicional (tiempo registrado adicional)", kind: "hours", value: t.afterEndMinutes },
    { label: "Guardias con permanencia adicional", kind: "count", value: t.extraStay },
    { label: "Llegadas tardías", kind: "count", value: t.late },
    { label: "Salidas anticipadas", kind: "count", value: t.earlyLeave },
    { label: "Sustituciones", kind: "count", value: t.substitutions },
    { label: "Correcciones administrativas", kind: "count", value: t.corrections },
    { label: "Registros incompletos", kind: "count", value: t.incomplete },
    { label: "Ausencias justificadas", kind: "count", value: t.justifiedAbsences },
    { label: "Inasistencias confirmadas tras revisión", kind: "count", value: t.confirmedAbsences },
    { label: "Pendientes de revisión", kind: "count", value: t.pendingReview },
  ];
}

export type GroupColumn = { header: string; short: string; kind: "hours" | "count"; value: (t: TotalsSummary) => number };

/** Columnas de los resúmenes por sede y por trabajador. */
export const GROUP_COLUMNS: GroupColumn[] = [
  { header: "Guardias", short: "Guardias", kind: "count", value: (t) => t.assignments },
  { header: "Programado (h)", short: "Prog.", kind: "hours", value: (t) => t.scheduledMinutes },
  { header: "Dentro del horario (h)", short: "Dentro", kind: "hours", value: (t) => t.withinScheduleMinutes },
  { header: "Fuera del horario (h)", short: "Fuera", kind: "hours", value: (t) => t.outsideScheduleMinutes },
  { header: "Total registrado (h)", short: "Total", kind: "hours", value: (t) => t.totalMinutes },
  { header: "Diferencia (h)", short: "Dif.", kind: "hours", value: (t) => t.differenceMinutes },
  { header: "Permanencia adicional (h)", short: "Perm. adic.", kind: "hours", value: (t) => t.afterEndMinutes },
  { header: "Llegadas tardías", short: "Tardías", kind: "count", value: (t) => t.late },
  { header: "Salidas anticipadas", short: "Sal. antic.", kind: "count", value: (t) => t.earlyLeave },
  { header: "Sustituciones", short: "Sust.", kind: "count", value: (t) => t.substitutions },
  { header: "Correcciones", short: "Corr.", kind: "count", value: (t) => t.corrections },
  { header: "Registros incompletos", short: "Incomp.", kind: "count", value: (t) => t.incomplete },
];

/** Texto ASCII seguro para nombres de archivo. */
export function slugify(value: string, max = 40): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\[demo\]/g, "demo")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** reporte-guardias_2026-10-11_a_2026-10-17[_sede][_persona].xlsx */
export function exportFileName(filters: ReportFilters, labels: FilterLabels, format: ExportFormat): string {
  const parts = ["reporte-guardias", `${filters.desde}_a_${filters.hasta}`];
  if (filters.facilityId && labels.facility) parts.push(slugify(labels.facility));
  if (filters.workerId && labels.worker) parts.push(slugify(labels.worker));
  return `${parts.filter(Boolean).join("_")}.${format}`;
}

/** Content-Disposition con nombre ASCII y variante UTF-8 (RFC 6266). */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Caracteres que XML 1.0 no admite (controles salvo tabulador y saltos de línea,
 * U+FFFE/U+FFFF y sustitutos sueltos): un solo carácter así en una nota dejaría
 * el Excel exportado ilegible para muchas herramientas.
 */
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function xmlSafeText(text: string): string {
  return text.replace(XML_INVALID, "");
}

const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/**
 * Las fuentes estándar de PDF solo cubren WinAnsi. Sustituye lo que no se
 * puede dibujar (p. ej. el signo menos «−») para no mostrar caracteres rotos.
 */
export function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC").replace(/\u2212/g, "-")) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch) || ch === "\n") {
      out += ch;
      continue;
    }
    const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const baseCode = base.codePointAt(0) ?? 0;
    out += base.length === 1 && baseCode >= 0x20 && baseCode <= 0xff ? base : "?";
  }
  return out;
}
