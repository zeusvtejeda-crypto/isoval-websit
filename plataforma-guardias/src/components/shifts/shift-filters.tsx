import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import type { FacilityOption } from "@/lib/data/catalogs";
import { STATUS_FILTER_OPTIONS, type ShiftListFilters } from "@/lib/shifts/filters";

/**
 * Filtros por URL (método GET): funcionan sin JavaScript y se pueden compartir
 * o guardar como marcador.
 */
export function ShiftFilters({ filters, facilities }: { filters: ShiftListFilters; facilities: FacilityOption[] }) {
  const isCalendar = filters.view === "calendario";
  return (
    <form method="get" action="/guardias" className="rounded-[--radius-card] border border-gray-200 bg-white p-4" aria-label="Filtros de guardias">
      {isCalendar ? <input type="hidden" name="vista" value="calendario" /> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Sede" htmlFor="f-sede">
          <Select id="f-sede" name="sede" defaultValue={filters.facilityId ?? ""}>
            <option value="">{facilities.length === 1 ? facilities[0].official_name : "Todas mis sedes"}</option>
            {facilities.length > 1
              ? facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.official_name}
                  </option>
                ))
              : null}
          </Select>
        </Field>
        <Field label={isCalendar ? "Semana que incluye" : "Desde"} htmlFor="f-desde">
          <Input id="f-desde" name="desde" type="date" defaultValue={filters.from} />
        </Field>
        {isCalendar ? null : (
          <Field label="Hasta" htmlFor="f-hasta">
            <Input id="f-hasta" name="hasta" type="date" defaultValue={filters.to} />
          </Field>
        )}
        <Field label="Estado" htmlFor="f-estado">
          <Select id="f-estado" name="estado" defaultValue={filters.status}>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value || "activas"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Checkbox name="cobertura" value="1" defaultChecked={filters.onlyInsufficient} label="Solo cobertura insuficiente" />
        <div className="flex flex-wrap gap-2">
          <Link href={isCalendar ? "/guardias?vista=calendario" : "/guardias"} className={buttonClasses("outline")}>
            Limpiar
          </Link>
          <Button type="submit">Aplicar filtros</Button>
        </div>
      </div>
    </form>
  );
}
