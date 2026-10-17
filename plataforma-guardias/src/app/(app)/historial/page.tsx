import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFacilityOptions, getStates } from "@/lib/data/catalogs";
import { DEFAULT_TIMEZONE, todayInTz } from "@/lib/time";
import { filtersToSearchParams, parseReportFilters, type RawParams } from "@/lib/reports/params";
import { getWorkerOptions, loadIncidentNotes, loadReport } from "@/lib/reports/load";
import { attachIncidentNotes, reportTotals } from "@/lib/reports/rows";
import { dayLabel } from "@/lib/reports/document";
import { ONLY_STARTED_NOTICE, PRESENCE_NOTICE } from "@/lib/reports/texts";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { LastUpdated } from "@/components/layout/connection-status";
import { ReportFiltersForm } from "./_components/report-filters";
import { ReportTotals } from "./_components/totals-grid";
import { ReportTable } from "./_components/report-table";
import { ExportLinks } from "./_components/export-links";
import { Pagination } from "./_components/pagination";

export const metadata: Metadata = { title: "Historial y reportes" };

const PAGE_SIZE = 100;

export default async function HistorialPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const now = new Date();
  const today = todayInTz(DEFAULT_TIMEZONE, now);
  const { filters, notices, page: requestedPage } = parseReportFilters(sp, today);

  const supabase = await createClient();
  const [report, facilities, allStates, workerOptions] = await Promise.all([
    loadReport(supabase, filters, now),
    getFacilityOptions(supabase, user.isAdmin ? null : user.facilityIds),
    getStates(supabase),
    getWorkerOptions(supabase, { selectedId: filters.workerId, facilityId: filters.facilityId }),
  ]);

  const visibleStateIds = new Set(facilities.map((f) => f.state_id));
  if (filters.stateId) visibleStateIds.add(filters.stateId);
  const states = allStates.filter((s) => visibleStateIds.has(s.id));

  const rows = report.rows;
  const totals = reportTotals(rows);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const pageSlice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // Justificaciones (incident_notes, con RLS) solo de las filas de esta página.
  const pageRows = attachIncidentNotes(pageSlice, await loadIncidentNotes(supabase, pageSlice.map((r) => r.assignmentId)));
  const hrefFor = (n: number) => `/historial?${filtersToSearchParams(filters, { pagina: n }).toString()}`;
  const workerHref = (workerId: string) =>
    `/historial/trabajador/${workerId}?${new URLSearchParams({ desde: filters.desde, hasta: filters.hasta }).toString()}`;
  const noScope = !user.isAdmin && user.facilityIds.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Historial y reportes"
        description="Asistencia registrada por guardia y persona. Horarios en la zona horaria de cada sede."
        actions={<ExportLinks filters={filters} compact />}
      />

      {noScope ? (
        <Alert tone="warning" title="Sin sedes asignadas">
          Tu cuenta no tiene sedes asignadas, por lo que no verás registros de otras personas. Pide a administración que te asigne sedes.
        </Alert>
      ) : null}

      <Card>
        <ReportFiltersForm
          action="/historial"
          filters={filters}
          today={today}
          facilities={facilities}
          states={states}
          workers={workerOptions.workers}
          workersTruncated={workerOptions.truncated}
        />
        <div className="mt-4 border-t border-gray-100 pt-4">
          <ExportLinks filters={filters} />
        </div>
        {notices.length ? (
          <Alert tone="info" title="Filtros ajustados" className="mt-3">
            {notices.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </Alert>
        ) : null}
      </Card>

      <section aria-labelledby="totales" className="space-y-2">
        <h2 id="totales" className="text-lg font-semibold text-gray-900">
          Totales del {dayLabel(filters.desde)} al {dayLabel(filters.hasta)}
        </h2>
        <ReportTotals totals={totals} />
      </section>

      <section aria-labelledby="detalle" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="detalle" className="text-lg font-semibold text-gray-900">
              Detalle por asignación
            </h2>
            <p className="text-sm text-gray-600">
              {rows.length} fila{rows.length === 1 ? "" : "s"}, ordenadas por fecha. {ONLY_STARTED_NOTICE}
            </p>
          </div>
          <LastUpdated at={now.toISOString()} timeZone={DEFAULT_TIMEZONE} />
        </div>
        <p className="text-sm font-medium text-gray-800">{PRESENCE_NOTICE}</p>

        {rows.length === 0 ? (
          <EmptyState
            title="Sin guardias con estos filtros"
            description="No hay guardias iniciadas que coincidan. Cambia el periodo, la sede, el estado de asistencia o la incidencia."
            action={
              <LinkButton href="/historial" variant="outline">
                Ver los últimos 7 días
              </LinkButton>
            }
          />
        ) : (
          <>
            <Pagination page={page} pageCount={pageCount} total={rows.length} pageSize={PAGE_SIZE} hrefFor={hrefFor} />
            <ReportTable rows={pageRows} workerHref={workerHref} />
            <Pagination page={page} pageCount={pageCount} total={rows.length} pageSize={PAGE_SIZE} hrefFor={hrefFor} />
          </>
        )}
      </section>
    </div>
  );
}
