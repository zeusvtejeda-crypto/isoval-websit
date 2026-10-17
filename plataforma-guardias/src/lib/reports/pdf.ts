import "server-only";
import { jsPDF } from "jspdf";
import { autoTable, type RowInput } from "jspdf-autotable";
import {
  DETAIL_COLUMNS,
  EXPORT_NOTICES,
  GROUP_COLUMNS,
  formatHoursMinutes,
  headerLines,
  pdfCell,
  pdfSafe,
  totalsEntries,
  type ReportDocument,
} from "./document";
import type { GroupSummary } from "./rows";

const BRAND: [number, number, number] = [20, 83, 45];
const MARGIN = 24;

type DocWithTable = jsPDF & { lastAutoTable?: { finalY?: number } };

function lastY(pdf: jsPDF, fallback: number): number {
  return (pdf as DocWithTable).lastAutoTable?.finalY ?? fallback;
}

/** Escribe líneas con ajuste de ancho; devuelve la nueva posición vertical. */
function writeLines(pdf: jsPDF, lines: string[], y: number, size: number, style: "normal" | "bold" = "normal"): number {
  const width = pdf.internal.pageSize.getWidth() - MARGIN * 2;
  pdf.setFont("helvetica", style);
  pdf.setFontSize(size);
  const lineHeight = size * 1.3;
  for (const line of lines) {
    const parts = pdf.splitTextToSize(pdfSafe(line), width) as string[];
    for (const part of parts) {
      if (y > pdf.internal.pageSize.getHeight() - 48) {
        pdf.addPage();
        y = MARGIN + size;
      }
      pdf.text(part, MARGIN, y);
      y += lineHeight;
    }
  }
  return y;
}

function ensureSpace(pdf: jsPDF, y: number, needed: number): number {
  if (y + needed > pdf.internal.pageSize.getHeight() - 48) {
    pdf.addPage();
    return MARGIN + 12;
  }
  return y;
}

function groupTable(pdf: jsPDF, title: string, firstHeader: string, groups: GroupSummary[], note: string, y: number): number {
  y = ensureSpace(pdf, y + 10, 60);
  y = writeLines(pdf, [title], y, 11, "bold");
  y = writeLines(pdf, [note], y, 8);
  const body: RowInput[] = groups.length
    ? groups.map((g) => [
        pdfSafe(g.detail ? `${g.label} (${g.detail})` : g.label),
        ...GROUP_COLUMNS.map((c) => (c.kind === "hours" ? formatHoursMinutes(c.value(g.totals)) : String(c.value(g.totals)))),
      ])
    : [[{ content: "Sin datos para los filtros seleccionados.", colSpan: GROUP_COLUMNS.length + 1 }]];
  autoTable(pdf, {
    startY: y,
    head: [[firstHeader, ...GROUP_COLUMNS.map((c) => pdfSafe(c.short))]],
    body,
    theme: "grid",
    margin: { left: MARGIN, right: MARGIN, bottom: 40 },
    styles: { font: "helvetica", fontSize: 7, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: Object.fromEntries([[0, { cellWidth: 200 }], ...GROUP_COLUMNS.map((_, i) => [i + 1, { halign: "right" as const }])]),
  });
  return lastY(pdf, y) + 8;
}

/** PDF horizontal (carta) con el mismo contenido que el Excel. */
export function renderPdf(doc: ReportDocument): Uint8Array<ArrayBuffer> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter", compress: true });
  pdf.setProperties({
    title: pdfSafe(doc.meta.title),
    subject: "Asistencia registrada por guardia",
    creator: "Plataforma de guardias (no oficial)",
  });

  let y = MARGIN + 14;
  pdf.setTextColor(BRAND[0], BRAND[1], BRAND[2]);
  y = writeLines(pdf, [doc.meta.title], y, 14, "bold");
  pdf.setTextColor(17, 24, 39);
  y = writeLines(pdf, headerLines(doc.meta), y + 2, 8);
  y = writeLines(pdf, EXPORT_NOTICES, y + 2, 8, "bold");
  y = writeLines(
    pdf,
    [
      "Horas en la zona horaria de cada sede (desfase debajo del horario). Tiempos en formato h:mm; retraso y salida anticipada en minutos.",
      "«Entre salida y regreso (no cuenta)»: tiempo fuera entre una salida y el regreso dentro de la guardia; no suma al tiempo registrado.",
    ],
    y + 2,
    7.5,
  );

  // Detalle
  const columns = DETAIL_COLUMNS.filter((c) => c.pdf);
  y = ensureSpace(pdf, y + 6, 60);
  y = writeLines(pdf, [`Detalle por asignación (${doc.rows.length} fila${doc.rows.length === 1 ? "" : "s"})`], y, 11, "bold");
  const detailBody: RowInput[] = doc.rows.length
    ? doc.rows.map((r) => columns.map((c) => pdfSafe(pdfCell(c, r))))
    : [[{ content: "Sin guardias para los filtros seleccionados.", colSpan: columns.length }]];
  const columnStyles: Record<string, { cellWidth?: number; halign?: "right" | "center" }> = {};
  columns.forEach((c, i) => {
    if (c.key === "fecha") columnStyles[i] = { cellWidth: 34 };
    else if (c.key === "trabajador") columnStyles[i] = { cellWidth: 62 };
    else if (c.key === "sede") columnStyles[i] = { cellWidth: 64 };
    else if (c.key === "estado") columnStyles[i] = { cellWidth: 48 };
    else if (c.key === "horario") columnStyles[i] = { cellWidth: 36 };
    else if (c.key === "entre_salidas") columnStyles[i] = { cellWidth: 38, halign: "right" };
    else if (c.key === "observaciones") columnStyles[i] = { cellWidth: 66 };
    else if (c.key === "justificacion") columnStyles[i] = { cellWidth: 78 };
    else if (c.kind === "hours" || c.kind === "minutes") columnStyles[i] = { halign: "right" };
    else if (c.kind === "flag") columnStyles[i] = { halign: "center" };
  });
  autoTable(pdf, {
    startY: y,
    head: [columns.map((c) => pdfSafe(c.short))],
    body: detailBody,
    theme: "grid",
    margin: { left: MARGIN, right: MARGIN, bottom: 40 },
    styles: { font: "helvetica", fontSize: 6, cellPadding: 1.2, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold", fontSize: 6 },
    alternateRowStyles: { fillColor: [243, 244, 246] },
    columnStyles,
    showHead: "everyPage",
  });
  y = lastY(pdf, y) + 12;

  // Resumen
  y = ensureSpace(pdf, y, 80);
  y = writeLines(pdf, ["Resumen del periodo"], y, 11, "bold");
  autoTable(pdf, {
    startY: y,
    head: [["Concepto", "Valor"]],
    body: totalsEntries(doc.totals).map((e) => [pdfSafe(e.label), e.kind === "hours" ? `${formatHoursMinutes(e.value)} h` : String(e.value)]),
    theme: "grid",
    tableWidth: 360,
    margin: { left: MARGIN, right: MARGIN, bottom: 40 },
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" } },
  });
  y = lastY(pdf, y) + 6;
  y = groupTable(pdf, "Resumen por sede", "Sede", doc.byFacility, "Orden alfabético por sede.", y);
  groupTable(pdf, "Resumen por trabajador", "Trabajador", doc.byWorker, "Orden alfabético por nombre. No es una clasificación ni un ranking de personas.", y);

  // Pie de página en todas las hojas
  const pages = pdf.getNumberOfPages();
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(75, 85, 99);
    pdf.text(pdfSafe(`${EXPORT_NOTICES[0]} ${EXPORT_NOTICES[1]} ${EXPORT_NOTICES[2]}`), MARGIN, height - 22, { maxWidth: width - MARGIN * 2 - 70 });
    pdf.text(pdfSafe(`Página ${i} de ${pages}`), width - MARGIN, height - 22, { align: "right" });
  }

  return new Uint8Array(pdf.output("arraybuffer"));
}
