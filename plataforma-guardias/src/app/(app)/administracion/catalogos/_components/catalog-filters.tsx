import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { CATALOGS_PATH, MUNICIPALITY_SEARCH_MAX, catalogsHref, stateCode, type CatalogFilters } from "@/lib/admin/catalogs";

/** Filtro por URL (GET): entidad y búsqueda de municipio. Funciona sin JavaScript. */
export function CatalogFiltersForm({ filters, states }: { filters: CatalogFilters; states: { id: number; name: string }[] }) {
  return (
    <form method="get" action={CATALOGS_PATH} className="rounded-card border border-gray-200 bg-white p-4" aria-label="Ver municipios de una entidad">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Entidad" htmlFor="cat-entidad" required>
          <Select id="cat-entidad" name="entidad" defaultValue={filters.stateId ? String(filters.stateId) : ""} required>
            <option value="" disabled>
              Elige la entidad…
            </option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {stateCode(s.id)} · {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Buscar municipio" htmlFor="cat-q" hint="Nombre o clave INEGI.">
          <Input id="cat-q" name="q" type="search" maxLength={MUNICIPALITY_SEARCH_MAX} defaultValue={filters.q} autoComplete="off" />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {filters.stateId ? (
          <Link href={filters.q ? catalogsHref({ stateId: filters.stateId }) : CATALOGS_PATH} className={buttonClasses("outline")}>
            {filters.q ? "Quitar búsqueda" : "Todas las entidades"}
          </Link>
        ) : null}
        <Button type="submit">Ver municipios</Button>
      </div>
    </form>
  );
}
