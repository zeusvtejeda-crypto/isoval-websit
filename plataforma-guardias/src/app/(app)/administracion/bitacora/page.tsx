import type { Metadata } from "next";
import Link from "next/link";
import { ROLE_LABELS, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AUDIT_PAGE_SIZE, auditHref, hasAuditFilters, pageCount, parseAuditFilters } from "@/lib/admin/audit-filters";
import { auditTablesFor } from "@/lib/admin/audit-labels";
import { loadAuditLookups, loadAuditPage, type AuditEventRow } from "@/lib/admin/audit-server";
import { collectRefIds, type ValueContext } from "@/lib/admin/audit-diff";
import { DEFAULT_TIMEZONE, formatOffset } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { AuditFiltersForm } from "./_components/audit-filters-form";
import { AuditEventCard } from "./_components/audit-event-card";
import { AuditPagination } from "./_components/audit-pagination";

export const metadata: Metadata = { title: "Bitácora" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function BitacoraPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireStaff();
  const supabase = await createClient();
  const tables = auditTablesFor(user.isAdmin);
  const filters = parseAuditFilters(await searchParams, { tables });
  const timeZone = DEFAULT_TIMEZONE;
  const noScope = !user.isAdmin && user.facilityIds.length === 0;

  const page: { events: AuditEventRow[]; total: number; outOfRange: boolean } = noScope
    ? { events: [], total: 0, outOfRange: false }
    : await loadAuditPage(supabase, filters, timeZone);
  const lookups = await loadAuditLookups(
    supabase,
    user,
    [...page.events.map((e) => e.facility_id).filter((id): id is string => Boolean(id)), ...collectRefIds(page.events, "facility")],
    collectRefIds(page.events, "worker"),
    collectRefIds(page.events, "municipality"),
  );

  const ctx: ValueContext = {
    timeZone,
    roleLabels: ROLE_LABELS,
    refs: {
      facility: lookups.facilityNames,
      category: lookups.categoryNames,
      state: lookups.stateNames,
      municipality: lookups.municipalityNames,
      profile: lookups.profileNames,
      worker: lookups.workerNames,
    },
  };
  const pages = pageCount(page.total, AUDIT_PAGE_SIZE);
  const filtered = hasAuditFilters(filters);
  const timeZoneLabel = `Fechas y horas en ${timeZone} (${formatOffset(new Date(), timeZone)}).`;

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 text-sm">
        <Link href="/administracion" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Administración
        </Link>
      </nav>
      <PageHeader
        title="Bitácora"
        description={
          user.isAdmin
            ? "Registro inmutable de cambios: quién, cuándo, qué cambió (valor anterior y nuevo) y por qué."
            : "Cambios registrados en tus sedes asignadas: quién, cuándo, qué cambió y por qué."
        }
      />

      <div className="space-y-4">
        {!user.isAdmin ? (
          <Alert tone="info" title="Alcance de la consulta">
            Ves solo eventos de tus sedes asignadas. Los cambios de cuentas de acceso, sedes asignadas y datos privados de contacto solo los ve
            administración.
          </Alert>
        ) : null}
        {noScope ? (
          <Alert tone="warning" title="Sin sedes asignadas">
            Tu cuenta no tiene sedes asignadas, por lo que no hay eventos que mostrar. Pide a administración que te asigne sedes.
          </Alert>
        ) : null}

        <AuditFiltersForm
          filters={filters}
          tables={tables}
          facilities={lookups.facilityOptions}
          authors={lookups.authorOptions.map((a) => ({ id: a.id, name: a.name, roleLabel: ROLE_LABELS[a.role] }))}
          timeZoneLabel={timeZoneLabel}
        />

        {page.outOfRange ? (
          <EmptyState
            title="No hay eventos en esta página"
            description="La página solicitada ya no existe con estos filtros."
            action={<LinkButton href={auditHref(filters, { page: 1 })}>Ir a la primera página</LinkButton>}
          />
        ) : page.events.length === 0 ? (
          <EmptyState
            title={filtered ? "Ningún evento coincide con los filtros" : "Aún no hay eventos en la bitácora"}
            description={filtered ? "Cambia o limpia los filtros para ver más eventos." : "Los cambios en instalaciones, guardias, registros y cuentas aparecerán aquí."}
            action={
              filtered ? (
                <LinkButton href={auditHref(filters, { table: "", action: "", from: "", to: "", facilityId: "", actorId: "", page: 1 })} variant="outline">
                  Limpiar filtros
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="text-sm text-gray-700" aria-live="polite">
              {page.total.toLocaleString("es-MX")} {page.total === 1 ? "evento" : "eventos"}
              {filtered ? " con los filtros aplicados" : ""}, del más reciente al más antiguo. {timeZoneLabel}
            </p>
            <ol className="space-y-3" aria-label="Eventos de la bitácora">
              {page.events.map((event) => (
                <AuditEventCard
                  key={event.id}
                  event={event}
                  ctx={ctx}
                  currentUserId={user.id}
                  profileNames={lookups.profileNames}
                  facilityNames={lookups.facilityNames}
                  facilityTimezones={lookups.facilityTimezones}
                  roleLabels={ROLE_LABELS}
                />
              ))}
            </ol>
            <AuditPagination page={filters.page} pageCount={pages} total={page.total} pageSize={AUDIT_PAGE_SIZE} hrefFor={(p) => auditHref(filters, { page: p })} />
          </>
        )}
      </div>
    </>
  );
}
