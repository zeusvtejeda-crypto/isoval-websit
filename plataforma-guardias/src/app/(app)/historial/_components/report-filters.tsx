import Form from "next/form";
import Link from "next/link";
import type { FacilityOption, State } from "@/lib/data/catalogs";
import type { WorkerOption } from "@/lib/reports/load";
import { ATTENDANCE_FILTER_OPTIONS, INCIDENT_FILTER_OPTIONS, type ReportFilters } from "@/lib/reports/params";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

/** Filtros GET del historial (funcionan sin JavaScript). */
export function ReportFiltersForm({
  action,
  filters,
  today,
  facilities,
  states,
  workers,
  workersTruncated,
}: {
  action: string;
  filters: ReportFilters;
  today: string;
  facilities: FacilityOption[];
  states: Pick<State, "id" | "name">[];
  workers: WorkerOption[];
  workersTruncated: boolean;
}) {
  return (
    <Form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Desde" htmlFor="desde" required>
          <Input id="desde" name="desde" type="date" defaultValue={filters.desde} max={today} required />
        </Field>
        <Field label="Hasta" htmlFor="hasta" required>
          <Input id="hasta" name="hasta" type="date" defaultValue={filters.hasta} required />
        </Field>
        <Field label="Estado de asistencia" htmlFor="asistencia">
          <Select id="asistencia" name="asistencia" defaultValue={filters.attendance}>
            {ATTENDANCE_FILTER_OPTIONS.map((o) => (
              <option key={o.value || "todos"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Incidencia"
          htmlFor="incidencia"
          hint="Muestra solo las guardias con esa señal para revisión. No es una sanción ni una clasificación de personas."
        >
          <Select id="incidencia" name="incidencia" defaultValue={filters.incident}>
            {INCIDENT_FILTER_OPTIONS.map((o) => (
              <option key={o.value || "cualquiera"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sede" htmlFor="sede">
          <Select id="sede" name="sede" defaultValue={filters.facilityId ?? ""}>
            <option value="">Todas las sedes de tu alcance</option>
            {filters.facilityId && !facilities.some((f) => f.id === filters.facilityId) ? (
              <option value={filters.facilityId}>Sede seleccionada</option>
            ) : null}
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.official_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado (entidad)" htmlFor="estado">
          <Select id="estado" name="estado" defaultValue={filters.stateId ? String(filters.stateId) : ""}>
            <option value="">Todos</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Trabajador"
          htmlFor="trabajador"
          hint={
            workersTruncated
              ? "La lista muestra solo las primeras personas en orden alfabético; elige una sede y aplica los filtros para acotarla."
              : filters.facilityId
                ? "Se listan las personas adscritas a la sede seleccionada."
                : undefined
          }
        >
          <Select id="trabajador" name="trabajador" defaultValue={filters.workerId ?? ""}>
            <option value="">Todas las personas</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name} ({w.internal_code})
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Aplicar filtros</Button>
        <Link href={action} className={buttonClasses("ghost")}>
          Limpiar filtros
        </Link>
      </div>
    </Form>
  );
}
