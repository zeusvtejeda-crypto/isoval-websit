import Link from "next/link";
import { ROLE_LABELS } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import type { WorkerListItem } from "../_lib/queries";

function StatusBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "success" : "muted"}>{active ? "Activo" : "Inactivo"}</Badge>;
}

function AccountLabel({ account, visible }: { account: WorkerListItem["account"]; visible: boolean }) {
  if (!account && !visible) {
    return (
      <span className="text-gray-600">
        No disponible
        <span className="block text-xs">No adscrito a tus sedes</span>
      </span>
    );
  }
  if (!account) return <span className="text-gray-600">Sin cuenta</span>;
  return (
    <span>
      {ROLE_LABELS[account.role]}
      {account.active ? null : <span className="block text-xs text-gray-600">Cuenta desactivada</span>}
    </span>
  );
}

const dash = <span className="text-gray-400">—</span>;

/** Sin sede, o con una sede que RLS no deja ver (p. ej. inactiva y fuera del alcance). */
function facilityFallback(w: WorkerListItem): string {
  return w.facilityId ? "Instalación no visible para tu cuenta" : "Sin instalación";
}

/** Tabla en escritorio y tarjetas en móvil. No muestra teléfono ni número de trabajador. */
export function WorkerList({ items }: { items: WorkerListItem[] }) {
  return (
    <>
      <ul className="space-y-3 md:hidden" aria-label="Trabajadores">
        {items.map((w) => (
          <li key={w.id}>
            <Link
              href={`/trabajadores/${w.id}`}
              className="block rounded-[--radius-card] border border-gray-200 bg-white p-4 shadow-sm hover:border-brand-700 focus-visible:border-brand-700"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-brand-900 underline-offset-2">{w.full_name}</p>
                  <p className="text-sm text-gray-600">{w.internal_code}</p>
                </div>
                <StatusBadge active={w.active} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div className="col-span-2">
                  <dt className="text-gray-500">Sede</dt>
                  <dd className="text-gray-900">{w.facility?.official_name ?? facilityFallback(w)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Área</dt>
                  <dd className="text-gray-900">{w.area ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Puesto</dt>
                  <dd className="text-gray-900">{w.position ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Turno habitual</dt>
                  <dd className="text-gray-900">{w.usual_shift ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Rol en la aplicación</dt>
                  <dd className="text-gray-900">
                    <AccountLabel account={w.account} visible={w.accountVisible} />
                  </dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>

      <Table caption="Trabajadores" className="hidden md:block">
        <thead>
          <tr>
            <Th>Nombre</Th>
            <Th>Identificador interno</Th>
            <Th>Sede</Th>
            <Th>Área</Th>
            <Th>Puesto</Th>
            <Th>Turno habitual</Th>
            <Th>Estado</Th>
            <Th>Rol en la aplicación</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((w) => (
            <tr key={w.id} className="hover:bg-gray-50">
              <Td className="min-w-48">
                <Link href={`/trabajadores/${w.id}`} className="inline-flex min-h-11 items-center font-semibold text-brand-800 underline underline-offset-2">
                  {w.full_name}
                </Link>
              </Td>
              <Td className="whitespace-nowrap">{w.internal_code}</Td>
              <Td className="min-w-48">{w.facility?.official_name ?? <span className="text-gray-600">{facilityFallback(w)}</span>}</Td>
              <Td>{w.area ?? dash}</Td>
              <Td>{w.position ?? dash}</Td>
              <Td className="whitespace-nowrap">{w.usual_shift ?? dash}</Td>
              <Td>
                <StatusBadge active={w.active} />
              </Td>
              <Td>
                <AccountLabel account={w.account} visible={w.accountVisible} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
