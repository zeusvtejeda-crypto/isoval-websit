import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, auditTableLabel } from "@/lib/admin/audit-labels";
import { AUDIT_PATH, type AuditFilters } from "@/lib/admin/audit-filters";
import { shortId } from "@/lib/admin/audit-diff";

type Option = { id: string; name: string };

/** Filtros por URL (GET): funcionan sin JavaScript y se pueden compartir. */
export function AuditFiltersForm({
  filters,
  tables,
  facilities,
  authors,
  timeZoneLabel,
}: {
  filters: AuditFilters;
  tables: string[];
  facilities: Option[];
  authors: (Option & { roleLabel: string })[];
  timeZoneLabel: string;
}) {
  const authorMissing = filters.actorId && !authors.some((a) => a.id === filters.actorId);
  const facilityMissing = filters.facilityId && !facilities.some((f) => f.id === filters.facilityId);
  const sortedTables = [...tables].sort((a, b) => auditTableLabel(a).localeCompare(auditTableLabel(b), "es"));

  return (
    <form method="get" action={AUDIT_PATH} className="rounded-[--radius-card] border border-gray-200 bg-white p-4" aria-label="Filtros de la bitácora">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Tabla" htmlFor="b-tabla">
          <Select id="b-tabla" name="tabla" defaultValue={filters.table}>
            <option value="">Todas las tablas</option>
            {sortedTables.map((t) => (
              <option key={t} value={t}>
                {auditTableLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Acción" htmlFor="b-accion">
          <Select id="b-accion" name="accion" defaultValue={filters.action}>
            <option value="">Todas las acciones</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Autor" htmlFor="b-autor">
          <Select id="b-autor" name="autor" defaultValue={filters.actorId}>
            <option value="">Todas las personas</option>
            {authorMissing ? <option value={filters.actorId}>Usuario {shortId(filters.actorId)}</option> : null}
            {authors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.roleLabel}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Desde" htmlFor="b-desde" hint={timeZoneLabel}>
          <Input id="b-desde" name="desde" type="date" defaultValue={filters.from} />
        </Field>
        <Field label="Hasta" htmlFor="b-hasta" hint="Incluye el día completo.">
          <Input id="b-hasta" name="hasta" type="date" defaultValue={filters.to} />
        </Field>
        {facilities.length > 0 ? (
          <Field label="Sede" htmlFor="b-sede">
            <Select id="b-sede" name="sede" defaultValue={filters.facilityId}>
              <option value="">Todas las sedes</option>
              {facilityMissing ? <option value={filters.facilityId}>Sede {shortId(filters.facilityId)}</option> : null}
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Link href={AUDIT_PATH} className={buttonClasses("outline")}>
          Limpiar
        </Link>
        <Button type="submit">Aplicar filtros</Button>
      </div>
    </form>
  );
}
