import type { NextRequest } from "next/server";
import { getSessionUser, ROLE_LABELS } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE, todayInTz } from "@/lib/time";
import { parseExportParams } from "@/lib/reports/params";
import { loadReport, resolveFilterLabels } from "@/lib/reports/load";
import { buildReportDocument, contentDisposition, DEFAULT_REPORT_TITLE, describeFilters, exportFileName } from "@/lib/reports/document";
import { renderXlsx } from "@/lib/reports/xlsx";
import { renderPdf } from "@/lib/reports/pdf";

/**
 * Exportación del historial a Excel (.xlsx) o PDF.
 * GET /api/exportar?formato=xlsx|pdf&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&sede=&estado=&asistencia=&incidencia=&trabajador=uuid|yo
 *
 * - Requiere sesión (401 si no hay). Los datos se leen con el cliente del
 *   usuario: RLS limita lo que cada rol puede exportar.
 * - Rol trabajador: SIEMPRE se exportan solo sus propios registros.
 * - Rango máximo de 93 días (400 si se excede).
 * - Incluye observaciones (notas de la asignación y de los registros vigentes) y justificaciones
 *   (incident_notes, leídas también con RLS).
 */
const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/**
 * Error legible: página HTML mínima si se abrió desde el navegador (enlace de
 * descarga) o texto plano para otros clientes.
 */
function errorResponse(request: NextRequest, message: string, status: number, backHref: string): Response {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!(request.headers.get("accept") ?? "").includes("text/html")) {
    return new Response(message, { status, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  }
  const html = `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>No se pudo exportar</title></head><body style="font-family:system-ui,sans-serif;margin:0;padding:24px;color:#111827;background:#f9fafb"><main style="max-width:40rem;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px"><h1 style="font-size:1.25rem;color:#14532d;margin:0 0 8px">No se pudo exportar</h1><p style="margin:0 0 16px">${escapeHtml(message)}</p><a href="${escapeHtml(backHref)}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 16px;border-radius:12px;background:#166534;color:#fff;font-weight:600;text-decoration:none">Volver</a><p style="margin:16px 0 0;font-size:12px;color:#4b5563">Esta plataforma no es una aplicación oficial del IMSS.</p></main></body></html>`;
  return new Response(html, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return errorResponse(request, "Tu sesión terminó o no has iniciado sesión. Vuelve a iniciar sesión para exportar.", 401, "/login");
  const backHref = user.isStaff ? "/historial" : "/mi-historial";

  const now = new Date();
  const parsed = parseExportParams(request.nextUrl.searchParams, { role: user.role, workerId: user.workerId }, todayInTz(DEFAULT_TIMEZONE, now));
  if (!parsed.ok) return errorResponse(request, parsed.message, parsed.status, backHref);

  const supabase = await createClient();
  try {
    const [{ rows }, labels] = await Promise.all([
      loadReport(supabase, parsed.filters, now, { withIncidentNotes: true }),
      resolveFilterLabels(supabase, parsed.filters),
    ]);
    const doc = buildReportDocument(
      {
        title: DEFAULT_REPORT_TITLE,
        generatedAt: now,
        generatedTimeZone: DEFAULT_TIMEZONE,
        requesterName: user.displayName ?? user.email ?? "Usuario",
        requesterRole: ROLE_LABELS[user.role],
        filterLines: describeFilters(parsed.filters, labels, parsed.forcedOwn),
      },
      rows,
    );
    const body = parsed.format === "xlsx" ? await renderXlsx(doc) : renderPdf(doc);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": MIME[parsed.format],
        "Content-Disposition": contentDisposition(exportFileName(parsed.filters, labels, parsed.format)),
        "Content-Length": String(body.byteLength),
        "Cache-Control": "no-store, private, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Error al exportar el historial", error);
    const message = error instanceof Error && /acota los filtros/i.test(error.message)
      ? error.message
      : "No se pudo generar el archivo. Inténtalo de nuevo o acota los filtros.";
    return errorResponse(request, message, 500, backHref);
  }
}
