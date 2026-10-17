import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ACCOUNT_SEARCH_MAX, USERS_BASE_PATH, type AccountFilters } from "@/lib/admin/accounts";
import type { AppRole } from "@/lib/auth";

/** Filtros por URL (GET): funcionan sin JavaScript y se pueden compartir. */
export function AccountFiltersForm({ filters, roleOptions }: { filters: AccountFilters; roleOptions: { value: AppRole; label: string }[] }) {
  return (
    <form method="get" action={USERS_BASE_PATH} className="rounded-[--radius-card] border border-gray-200 bg-white p-4" aria-label="Filtros de cuentas">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Buscar" htmlFor="u-q" className="sm:col-span-2" hint="Correo, nombre visible o trabajador vinculado.">
          <Input id="u-q" name="q" type="search" maxLength={ACCOUNT_SEARCH_MAX} defaultValue={filters.q} autoComplete="off" />
        </Field>
        <Field label="Rol" htmlFor="u-rol">
          <Select id="u-rol" name="rol" defaultValue={filters.role}>
            <option value="">Todos los roles</option>
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado" htmlFor="u-estado">
          <Select id="u-estado" name="estado" defaultValue={filters.status}>
            <option value="todas">Activas e inactivas</option>
            <option value="activas">Solo activas</option>
            <option value="inactivas">Solo inactivas</option>
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Link href={USERS_BASE_PATH} className={buttonClasses("outline")}>
          Limpiar
        </Link>
        <Button type="submit">Aplicar filtros</Button>
      </div>
    </form>
  );
}
