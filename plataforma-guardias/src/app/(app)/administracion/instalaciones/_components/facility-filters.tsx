"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import {
  ACTIVE_FILTER_OPTIONS,
  DATA_KIND_OPTIONS,
  FACILITIES_BASE_PATH,
  SEARCH_MAX,
  VERIFICATION_FILTER_OPTIONS,
  type FacilityListFilters,
} from "@/lib/validation/facility";

type Option = { id: number; name: string };
type CategoryOption = { id: number; name: string; active: boolean };

/**
 * Filtros por URL (GET): funcionan sin JavaScript y se pueden compartir.
 * Los municipios corresponden al estado aplicado; si se cambia el estado, el
 * municipio se elige después de aplicar el filtro.
 */
export function FacilityFilters({
  filters,
  categories,
  states,
  municipalities,
}: {
  filters: FacilityListFilters;
  categories: CategoryOption[];
  states: Option[];
  /** Municipios del estado aplicado en la URL. */
  municipalities: Option[];
}) {
  const appliedState = filters.stateId ? String(filters.stateId) : "";
  const [stateId, setStateId] = useState(appliedState);
  const stateChanged = stateId !== appliedState;
  const municipalityDisabled = !stateId || stateChanged || municipalities.length === 0;

  return (
    <form method="get" action={FACILITIES_BASE_PATH} className="rounded-[--radius-card] border border-gray-200 bg-white p-4" aria-label="Filtros de instalaciones">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Buscar" htmlFor="f-q" className="sm:col-span-2" hint="Nombre oficial, clave de unidad o identificador interno (INS-…).">
          <Input id="f-q" name="q" type="search" maxLength={SEARCH_MAX} defaultValue={filters.q} autoComplete="off" />
        </Field>
        <Field label="Categoría" htmlFor="f-categoria">
          <Select id="f-categoria" name="categoria" defaultValue={filters.categoryId ? String(filters.categoryId) : ""}>
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.active ? c.name : `${c.name} (inactiva)`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado" htmlFor="f-estado">
          <Select id="f-estado" name="estado" value={stateId} onChange={(e) => setStateId(e.currentTarget.value)}>
            <option value="">Todos los estados</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Municipio"
          htmlFor="f-municipio"
          hint={!stateId ? "Elige primero el estado." : stateChanged ? "Aplica el filtro de estado para elegir municipio." : undefined}
        >
          <Select id="f-municipio" name="municipio" defaultValue={filters.municipalityId ? String(filters.municipalityId) : ""} disabled={municipalityDisabled}>
            <option value="">Todos los municipios</option>
            {stateChanged
              ? null
              : municipalities.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
          </Select>
        </Field>
        <Field label="Verificación" htmlFor="f-verificacion">
          <Select id="f-verificacion" name="verificacion" defaultValue={filters.verification}>
            {VERIFICATION_FILTER_OPTIONS.map((o) => (
              <option key={o.value || "todas"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo de datos" htmlFor="f-datos">
          <Select id="f-datos" name="datos" defaultValue={filters.dataKind}>
            {DATA_KIND_OPTIONS.map((o) => (
              <option key={o.value || "todos"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Situación" htmlFor="f-activa">
          <Select id="f-activa" name="activa" defaultValue={filters.active}>
            {ACTIVE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Link href={FACILITIES_BASE_PATH} className={buttonClasses("outline")}>
          Limpiar
        </Link>
        <Button type="submit">Aplicar filtros</Button>
      </div>
    </form>
  );
}
