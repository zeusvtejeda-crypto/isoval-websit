import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMunicipalities, labelRepeatedMunicipalities, getStates } from "@/lib/data/catalogs";
import {
  NO_FACILITY,
  WORKERS_PAGE_SIZE,
  hasActiveFilters,
  parseWorkerFilters,
  totalPages,
  workersHref,
  type RawSearchParams,
} from "@/lib/validation/worker";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton, buttonClasses } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { WorkerFilters } from "./_components/worker-filters";
import { WorkerList } from "./_components/worker-list";
import { getAreaSuggestions, getVisibleFacilityOptions, listWorkers } from "./_lib/queries";

export const metadata = { title: "Trabajadores" };

export default async function TrabajadoresPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireStaff();
  const supabase = await createClient();
  const sp = await searchParams;

  const [facilities, states, areas] = await Promise.all([
    getVisibleFacilityOptions(supabase, user),
    getStates(supabase),
    getAreaSuggestions(supabase),
  ]);
  const filters = parseWorkerFilters(sp, {
    facilityIds: user.isAdmin ? null : facilities.map((f) => f.id),
    allowNoFacility: user.isAdmin,
  });

  const notices: string[] = [];
  if (filters.stateId && !states.some((s) => s.id === filters.stateId)) {
    notices.push("El estado indicado no existe; se muestran todos los estados.");
    filters.stateId = null;
    filters.municipalityId = null;
  }
  const municipalities = filters.stateId ? labelRepeatedMunicipalities(await getMunicipalities(supabase, filters.stateId)) : [];
  if (filters.municipalityId && !municipalities.some((m) => m.id === filters.municipalityId)) {
    notices.push("El municipio indicado no corresponde al estado elegido; se muestran todos los municipios.");
    filters.municipalityId = null;
  }

  const { items, total, outOfRange } = await listWorkers(supabase, filters, { searchPrivate: user.canManage, user });
  const pages = totalPages(total);
  const firstShown = total === 0 ? 0 : (filters.page - 1) * WORKERS_PAGE_SIZE + 1;
  const lastShown = Math.min(total, (filters.page - 1) * WORKERS_PAGE_SIZE + items.length);
  const deleted = sp.eliminado === "1";

  // Estados con cobertura activa primero; luego el resto.
  const stateOptions = [...states.filter((s) => s.enabled), ...states.filter((s) => !s.enabled)].map((s) => ({ id: s.id, name: s.name }));

  return (
    <>
      <PageHeader
        title="Trabajadores"
        description="Directorio privado organizado por entidad federativa. Solo para coordinación, administración y auditoría."
        actions={
          user.canManage ? (
            <>
              <LinkButton href="/trabajadores/importar" variant="outline">
                Importar archivo
              </LinkButton>
              <LinkButton href={filters.facility && filters.facility !== NO_FACILITY ? `/trabajadores/nuevo?sede=${filters.facility}` : "/trabajadores/nuevo"}>
                Nuevo trabajador
              </LinkButton>
            </>
          ) : null
        }
      />

      <div className="space-y-4">
        {deleted ? <Alert tone="success">Registro eliminado. El cambio quedó en la bitácora.</Alert> : null}
        {notices.map((n) => (
          <Alert key={n} tone="warning">
            {n}
          </Alert>
        ))}

        <WorkerFilters
          filters={filters}
          states={stateOptions}
          municipalities={municipalities.map((m) => ({ id: m.id, name: m.name }))}
          facilities={facilities.map((f) => ({ id: f.id, official_name: f.official_name }))}
          areas={areas}
          allowNoFacility={user.isAdmin}
          canSearchPrivate={user.canManage}
        />

        <p className="text-sm text-gray-700" aria-live="polite">
          {total === 0
            ? "Sin resultados."
            : `${total} ${total === 1 ? "trabajador" : "trabajadores"} · mostrando ${firstShown}–${lastShown} · página ${filters.page} de ${pages}`}
        </p>

        {!user.isAdmin && facilities.length === 0 ? (
          <EmptyState title="Sin sedes asignadas" description="Tu cuenta no tiene sedes asignadas. Pide a administración que te asigne una sede." />
        ) : outOfRange ? (
          <EmptyState
            title="Esa página no existe"
            description={`Hay ${total} ${total === 1 ? "resultado" : "resultados"} en ${pages} ${pages === 1 ? "página" : "páginas"}.`}
            action={<LinkButton href={workersHref(filters, { page: pages })}>Ir a la última página</LinkButton>}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={hasActiveFilters(filters) ? "No hay trabajadores con estos filtros" : "Aún no hay trabajadores registrados"}
            description={hasActiveFilters(filters) ? "Prueba con otra búsqueda o limpia los filtros." : "Registra al personal uno por uno o importa un archivo CSV o Excel."}
            action={
              hasActiveFilters(filters) ? (
                <LinkButton href="/trabajadores" variant="outline">
                  Limpiar filtros
                </LinkButton>
              ) : user.canManage ? (
                <LinkButton href="/trabajadores/nuevo">Nuevo trabajador</LinkButton>
              ) : undefined
            }
          />
        ) : (
          <WorkerList items={items} />
        )}

        {pages > 1 && !outOfRange ? (
          <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-2">
            {filters.page > 1 ? (
              <Link href={workersHref(filters, { page: filters.page - 1 })} className={buttonClasses("outline")} rel="prev">
                Página anterior
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-gray-700">
              Página {filters.page} de {pages}
            </span>
            {filters.page < pages ? (
              <Link href={workersHref(filters, { page: filters.page + 1 })} className={buttonClasses("outline")} rel="next">
                Página siguiente
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}

        <p className="text-sm text-gray-600">
          La lista no muestra teléfonos ni números de trabajador. Esos datos privados solo aparecen en la ficha para administración y la coordinación
          de la sede.
        </p>
      </div>
    </>
  );
}
