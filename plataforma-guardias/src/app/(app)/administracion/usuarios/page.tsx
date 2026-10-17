import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  USERS_BASE_PATH,
  accountStatus,
  facilitiesSummary,
  filterAccounts,
  hasAccountFilters,
  parseAccountFilters,
  roleUsesFacilityScopes,
  type AccountRow,
} from "@/lib/admin/accounts";
import { loadAccountsOverview, roleOptions } from "@/lib/admin/accounts-server";
import { DEFAULT_TIMEZONE, formatDateTime } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { Table, Td, Th } from "@/components/ui/table";
import { AccountFiltersForm } from "./_components/account-filters";
import { RoleBadge, StatusBadge } from "./_components/account-badges";

export const metadata: Metadata = { title: "Usuarios y permisos" };

type SearchParams = Record<string, string | string[] | undefined>;

function WorkerCell({ row }: { row: AccountRow }) {
  if (row.worker) {
    return (
      <span>
        {row.worker.fullName} <span className="whitespace-nowrap text-gray-500">({row.worker.internalCode})</span>
      </span>
    );
  }
  if (row.workerId) return <span className="text-gray-600">Vinculado (registro no disponible)</span>;
  if (row.role === "trabajador") return <Badge tone="warning">Sin vincular</Badge>;
  return <span className="text-gray-500">—</span>;
}

function FacilitiesCell({ row }: { row: AccountRow }) {
  if (row.role === "admin") return <span className="text-gray-700">Todas (administración)</span>;
  if (!roleUsesFacilityScopes(row.role)) return <span className="text-gray-500">—</span>;
  if (row.facilities.length === 0) return <Badge tone="warning">Sin sedes asignadas</Badge>;
  return <span title={row.facilities.map((f) => f.name).join(", ")}>{facilitiesSummary(row.facilities.map((f) => f.name))}</span>;
}

function lastSignIn(row: AccountRow): string {
  return row.lastSignInAt ? formatDateTime(row.lastSignInAt, DEFAULT_TIMEZONE) : row.authMissing ? "—" : "Nunca";
}

export default async function UsuariosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireAdmin();
  const supabase = await createClient();
  const filters = parseAccountFilters(await searchParams);
  const { rows, authError } = await loadAccountsOverview(supabase, actor);
  const visible = filterAccounts(rows, filters);
  const options = roleOptions();
  const now = new Date();
  const activeAdmins = rows.filter((r) => r.role === "admin" && r.active).length;

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 text-sm">
        <Link href="/administracion" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Administración
        </Link>
      </nav>
      <PageHeader
        title="Usuarios y permisos"
        description="Cuentas de acceso, rol, sedes asignadas y trabajador vinculado. Un trabajador puede existir sin cuenta."
        actions={
          <LinkButton href={`${USERS_BASE_PATH}/nueva`} size="lg">
            Crear cuenta
          </LinkButton>
        }
      />

      <div className="space-y-4">
        {authError ? (
          <Alert tone="warning" title="Correos no disponibles">
            {authError} La lista muestra los perfiles, pero sin correo ni estado de bloqueo.
          </Alert>
        ) : null}
        {activeAdmins === 1 ? (
          <Alert tone="info" title="Una sola cuenta de administración activa">
            Se recomienda tener al menos dos cuentas de administración activas para no perder el acceso. La plataforma impide desactivar o cambiar de rol a la última.
          </Alert>
        ) : null}

        <AccountFiltersForm filters={filters} roleOptions={options} />

        <p className="text-sm text-gray-700" aria-live="polite">
          {visible.length === rows.length
            ? `${rows.length} ${rows.length === 1 ? "cuenta" : "cuentas"}`
            : `${visible.length} de ${rows.length} cuentas con los filtros aplicados`}
          {rows.length > 0 ? ` · Horas de inicio de sesión en ${DEFAULT_TIMEZONE}.` : ""}
        </p>

        {rows.length === 0 ? (
          <EmptyState
            title="Aún no hay cuentas"
            description="Crea la primera cuenta de acceso."
            action={<LinkButton href={`${USERS_BASE_PATH}/nueva`}>Crear cuenta</LinkButton>}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Ninguna cuenta coincide con los filtros"
            description={hasAccountFilters(filters) ? "Cambia o limpia los filtros para ver más cuentas." : undefined}
            action={<LinkButton href={USERS_BASE_PATH} variant="outline">Limpiar filtros</LinkButton>}
          />
        ) : (
          <>
            <ul className="space-y-3 md:hidden" aria-label="Cuentas">
              {visible.map((row) => {
                const status = accountStatus(row, now);
                return (
                  <li key={row.id} className="rounded-card border border-gray-200 bg-white p-4 shadow-sm">
                    <p className="font-semibold text-gray-900">{row.displayName ?? row.email ?? "Sin nombre"}</p>
                    <p className="break-all text-sm text-gray-600">{row.email ?? "Correo no disponible"}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <RoleBadge role={row.role} />
                      <StatusBadge row={row} now={now} />
                    </div>
                    {status.hint ? <p className="mt-1 text-xs text-gray-600">{status.hint}</p> : null}
                    <dl className="mt-3 space-y-1 text-sm">
                      <div>
                        <dt className="text-gray-500">Trabajador vinculado</dt>
                        <dd>
                          <WorkerCell row={row} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Sedes asignadas</dt>
                        <dd>
                          <FacilitiesCell row={row} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Último inicio de sesión</dt>
                        <dd>{lastSignIn(row)}</dd>
                      </div>
                    </dl>
                    <LinkButton href={`${USERS_BASE_PATH}/${row.id}`} variant="outline" className="mt-3 w-full">
                      Ver y editar
                    </LinkButton>
                  </li>
                );
              })}
            </ul>

            <Table caption="Cuentas de acceso" className="hidden md:block">
              <thead>
                <tr>
                  <Th>Correo</Th>
                  <Th>Nombre visible</Th>
                  <Th>Rol</Th>
                  <Th>Estado</Th>
                  <Th>Trabajador vinculado</Th>
                  <Th>Sedes asignadas</Th>
                  <Th>Último inicio de sesión</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <Td className="break-all">{row.email ?? <span className="text-gray-500">No disponible</span>}</Td>
                    <Td className="min-w-40">{row.displayName ?? <span className="text-gray-500">—</span>}</Td>
                    <Td>
                      <RoleBadge role={row.role} />
                    </Td>
                    <Td>
                      <StatusBadge row={row} now={now} />
                    </Td>
                    <Td className="min-w-48">
                      <WorkerCell row={row} />
                    </Td>
                    <Td className="min-w-48">
                      <FacilitiesCell row={row} />
                    </Td>
                    <Td className="whitespace-nowrap">{lastSignIn(row)}</Td>
                    <Td>
                      <Link
                        href={`${USERS_BASE_PATH}/${row.id}`}
                        className="inline-flex min-h-11 items-center whitespace-nowrap font-medium text-brand-800 underline underline-offset-2"
                      >
                        Ver y editar
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </div>
    </>
  );
}
