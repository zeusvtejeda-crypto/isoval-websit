import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCategories, getMunicipalities, labelRepeatedMunicipalities, getStates } from "@/lib/data/catalogs";
import {
  FACILITIES_BASE_PATH,
  FACILITIES_PAGE_SIZE,
  OFFICIAL_SOURCES_NOTICE,
  facilitiesHref,
  hasActiveFilters,
  parseFacilityFilters,
  totalPages,
  type RawSearchParams,
} from "@/lib/validation/facility";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton, buttonClasses } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { FacilityFilters } from "./_components/facility-filters";
import { FacilityList } from "./_components/facility-list";
import { listFacilities } from "./_lib/queries";

export const metadata = { title: "Instalaciones" };

export default async function InstalacionesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireAdmin();
  const supabase = await createClient();
  const sp = await searchParams;
  const filters = parseFacilityFilters(sp);

  const [categories, states] = await Promise.all([getCategories(supabase), getStates(supabase)]);

  const notices: string[] = [];
  if (filters.categoryId && !categories.some((c) => c.id === filters.categoryId)) {
    notices.push("La categoría indicada no existe; se muestran todas las categorías.");
    filters.categoryId = null;
  }
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

  const { items, total, outOfRange } = await listFacilities(supabase, filters);
  const pages = totalPages(total);
  const firstShown = total === 0 ? 0 : (filters.page - 1) * FACILITIES_PAGE_SIZE + 1;
  const lastShown = Math.min(total, (filters.page - 1) * FACILITIES_PAGE_SIZE + items.length);
  const deleted = sp.eliminada === "1";
  const stateOptions = [...states.filter((s) => s.enabled), ...states.filter((s) => !s.enabled)].map((s) => ({ id: s.id, name: s.name }));

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 text-sm">
        <Link href="/administracion" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Administración
        </Link>
      </nav>
      <PageHeader
        title="Instalaciones"
        description="Alta, edición e importación de las instalaciones del directorio y de las sedes de guardias."
        actions={
          <>
            <LinkButton href="/administracion/categorias" variant="ghost">
              Categorías
            </LinkButton>
            <LinkButton href={`${FACILITIES_BASE_PATH}/importar`} variant="outline">
              Importar archivo
            </LinkButton>
            <LinkButton href={`${FACILITIES_BASE_PATH}/nueva`}>Nueva instalación</LinkButton>
          </>
        }
      />

      <div className="space-y-4">
        {deleted ? <Alert tone="success">Instalación eliminada. El cambio quedó en la bitácora.</Alert> : null}
        {notices.map((n) => (
          <Alert key={n} tone="warning">
            {n}
          </Alert>
        ))}
        <Alert tone="info" title="Fuentes oficiales">
          {OFFICIAL_SOURCES_NOTICE}
        </Alert>

        <FacilityFilters
          filters={filters}
          categories={categories.map((c) => ({ id: c.id, name: c.name, active: c.active }))}
          states={stateOptions}
          municipalities={municipalities.map((m) => ({ id: m.id, name: m.name }))}
        />

        <p className="text-sm text-gray-700" aria-live="polite">
          {total === 0
            ? "Sin resultados."
            : `${total} ${total === 1 ? "instalación" : "instalaciones"} · mostrando ${firstShown}–${lastShown} · página ${filters.page} de ${pages}`}
        </p>

        {outOfRange ? (
          <EmptyState
            title="Esa página no existe"
            description={`Hay ${total} ${total === 1 ? "resultado" : "resultados"} en ${pages} ${pages === 1 ? "página" : "páginas"}.`}
            action={<LinkButton href={facilitiesHref(filters, { page: pages })}>Ir a la última página</LinkButton>}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={hasActiveFilters(filters) ? "No hay instalaciones con estos filtros" : "Aún no hay instalaciones registradas"}
            description={
              hasActiveFilters(filters)
                ? "Prueba con otra búsqueda o limpia los filtros."
                : "Registra las instalaciones una por una o importa un archivo CSV o Excel con su fuente oficial."
            }
            action={
              hasActiveFilters(filters) ? (
                <LinkButton href={FACILITIES_BASE_PATH} variant="outline">
                  Limpiar filtros
                </LinkButton>
              ) : (
                <LinkButton href={`${FACILITIES_BASE_PATH}/nueva`}>Nueva instalación</LinkButton>
              )
            }
          />
        ) : (
          <FacilityList items={items} />
        )}

        {pages > 1 && !outOfRange ? (
          <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-2">
            {filters.page > 1 ? (
              <Link href={facilitiesHref(filters, { page: filters.page - 1 })} className={buttonClasses("outline")} rel="prev">
                Página anterior
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-gray-700">
              Página {filters.page} de {pages}
            </span>
            {filters.page < pages ? (
              <Link href={facilitiesHref(filters, { page: filters.page + 1 })} className={buttonClasses("outline")} rel="next">
                Página siguiente
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}

        <p className="text-sm text-gray-600">
          Desactiva en lugar de borrar: una instalación inactiva conserva su historial y deja de mostrarse en el directorio público. Solo se puede
          eliminar una instalación sin trabajadores, guardias ni registros relacionados.
        </p>
      </div>
    </>
  );
}
