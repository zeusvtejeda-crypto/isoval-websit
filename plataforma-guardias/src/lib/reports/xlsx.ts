import "server-only";
import ExcelJS from "exceljs";
import { minutesToHours } from "@/lib/time";
import { DETAIL_COLUMNS, EXPORT_NOTICES, GROUP_COLUMNS, headerLines, totalsEntries, xlsxCell, type ReportDocument } from "./document";
import type { GroupSummary } from "./rows";

const BRAND = "FF14532D"; // verde oscuro
const NOTICE_FILL = "FFFEF3C7";

/** Escribe el encabezado común y devuelve el número de la siguiente fila libre. */
function writeHeader(ws: ExcelJS.Worksheet, doc: ReportDocument, subtitle: string): number {
  const title = ws.addRow([doc.meta.title]);
  title.font = { bold: true, size: 14, color: { argb: BRAND } };
  ws.addRow([subtitle]).font = { bold: true, size: 12 };
  for (const line of headerLines(doc.meta)) ws.addRow([line]);
  for (const notice of EXPORT_NOTICES) {
    const r = ws.addRow([notice]);
    r.font = { bold: true };
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NOTICE_FILL } };
  }
  ws.addRow([]);
  return ws.rowCount + 1;
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 32;
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF9CA3AF" } } };
  });
}

function writeGroupTable(ws: ExcelJS.Worksheet, title: string, firstHeader: string, groups: GroupSummary[], note: string) {
  ws.addRow([]);
  ws.addRow([title]).font = { bold: true, size: 12 };
  ws.addRow([note]).font = { italic: true, color: { argb: "FF4B5563" } };
  const header = ws.addRow([firstHeader, "Clave", ...GROUP_COLUMNS.map((c) => c.header)]);
  styleHeaderRow(header);
  if (groups.length === 0) {
    ws.addRow(["Sin datos para los filtros seleccionados."]);
    return;
  }
  for (const g of groups) {
    const row = ws.addRow([g.label, g.detail ?? "", ...GROUP_COLUMNS.map((c) => (c.kind === "hours" ? minutesToHours(c.value(g.totals)) : c.value(g.totals)))]);
    GROUP_COLUMNS.forEach((c, i) => {
      if (c.kind === "hours") row.getCell(i + 3).numFmt = "0.00";
    });
  }
}

/** Libro de Excel con hojas «Detalle» y «Resumen». */
export async function renderXlsx(doc: ReportDocument): Promise<Uint8Array<ArrayBuffer>> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plataforma de guardias (no oficial)";
  wb.title = doc.meta.title;
  wb.subject = "Asistencia registrada por guardia";
  wb.created = doc.meta.generatedAt;

  // Hoja «Detalle»
  const detail = wb.addWorksheet("Detalle", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  detail.columns = DETAIL_COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  const headerRowNumber = writeHeader(detail, doc, `Detalle por asignación (${doc.rows.length} fila${doc.rows.length === 1 ? "" : "s"}). Horas en la zona horaria de cada sede.`);
  const header = detail.addRow(DETAIL_COLUMNS.map((c) => c.header));
  styleHeaderRow(header);
  for (const r of doc.rows) {
    const row = detail.addRow(DETAIL_COLUMNS.map((c) => xlsxCell(c, r)));
    DETAIL_COLUMNS.forEach((c, i) => {
      if (c.kind === "hours") row.getCell(i + 1).numFmt = "0.00";
      if (c.kind === "minutes") row.getCell(i + 1).numFmt = "0";
    });
  }
  if (doc.rows.length === 0) {
    detail.addRow(["Sin guardias para los filtros seleccionados."]);
  } else {
    detail.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber + doc.rows.length, column: DETAIL_COLUMNS.length },
    };
  }
  detail.views = [{ state: "frozen", ySplit: headerRowNumber, xSplit: 2 }];
  detail.addRow([]);
  detail.addRow(["Horas en formato decimal (7.50 = 7 h 30 min). Retraso y salida anticipada en minutos."]).font = { italic: true };

  // Hoja «Resumen»
  const summary = wb.addWorksheet("Resumen", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  summary.columns = [{ width: 52 }, { width: 16 }, ...GROUP_COLUMNS.map(() => ({ width: 14 }))];
  writeHeader(summary, doc, "Resumen del periodo");
  const totalsHeader = summary.addRow(["Concepto", "Valor", "Unidad"]);
  styleHeaderRow(totalsHeader);
  for (const e of totalsEntries(doc.totals)) {
    const row = summary.addRow([e.label, e.kind === "hours" ? minutesToHours(e.value) : e.value, e.kind === "hours" ? "horas" : "guardias"]);
    if (e.kind === "hours") row.getCell(2).numFmt = "0.00";
  }
  writeGroupTable(summary, "Resumen por sede", "Sede", doc.byFacility, "Orden alfabético por sede.");
  writeGroupTable(
    summary,
    "Resumen por trabajador",
    "Trabajador",
    doc.byWorker,
    "Orden alfabético por nombre. No es una clasificación ni un ranking de personas.",
  );

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
