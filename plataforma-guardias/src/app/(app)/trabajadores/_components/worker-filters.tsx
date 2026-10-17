"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import {
  ACCOUNT_FILTER_OPTIONS,
  SEARCH_MAX,
  STATUS_FILTER_OPTIONS,
  TEXT_MAX,
  type WorkerListFilters,
} from "@/lib/validation/worker";

type StateOption = { id: number; name: string };
type MunicipalityOption = { id: number; name: string };
type FacilityOption = { id: string; official_name: string };

/**
 * Filtros por URL (GET): funcionan sin JavaScript y se pueden compartir.
 * Los municipios corresponden al estado aplicado; si se cambia el estado,
 * el municipio se elige después de aplicar el filtro.
 */
export function WorkerFilters({
  filters,
  states,
  municipalities,
  facilities,
  areas,
  allFacilities,
  canSearchPrivate,
}: {
  filters: WorkerListFilters;
  states: StateOption[];
  /** Municipios del estado aplicado en la URL. */
  municipalities: MunicipalityOption[];
  facilities: FacilityOption[];
  areas: string[];
  /** Administración: ve todas las sedes y todas las cuentas. */
  allFacilities: boolean;
  canSearchPrivate: boolean;
}) {
  const appliedState = filters.stateId ? String(filters.stateId) : "";
  const [stateId, setStateId] = useState(appliedState);
  const stateChanged = stateId !== appliedState;
  const municipalityDisabled = !stateId || stateChanged || municipalities.length === 0;

  return (
    <form method="get" action="/trabajadores" className="rounded-card border border-gray-200 bg-white p-4" aria-label="Filtros de trabajadores">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Buscar"
          htmlFor="f-q"
          className="sm:col-span-2"
          hint={canSearchPrivate ? "Nombre, identificador interno (TRA-…) o número de trabajador." : "Nombre o identificador interno (TRA-…)."}
        >
          <Input id="f-q" name="q" type="search" maxLength={SEARCH_MAX} defaultValue={filters.q} autoComplete="off" />
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
        <Field label="Sede de adscripción" htmlFor="f-sede">
          <Select id="f-sede" name="sede" defaultValue={filters.facility ?? ""}>
            <option value="">{allFacilities ? "Todas las sedes" : "Todas las sedes visibles"}</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.official_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Área" htmlFor="f-area">
          <Input id="f-area" name="area" list="f-area-opciones" maxLength={TEXT_MAX} defaultValue={filters.area} autoComplete="off" />
          <datalist id="f-area-opciones">
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
        <Field label="Situación" htmlFor="f-activo">
          <Select id="f-activo" name="activo" defaultValue={filters.status}>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cuenta de acceso" htmlFor="f-cuenta" hint={allFacilities ? undefined : "Solo considera al personal adscrito a tus sedes."}>
          <Select id="f-cuenta" name="cuenta" defaultValue={filters.account}>
            {ACCOUNT_FILTER_OPTIONS.map((o) => (
              <option key={o.value || "todas"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Link href="/trabajadores" className={buttonClasses("outline")}>
          Limpiar
        </Link>
        <Button type="submit">Aplicar filtros</Button>
      </div>
    </form>
  );
}
