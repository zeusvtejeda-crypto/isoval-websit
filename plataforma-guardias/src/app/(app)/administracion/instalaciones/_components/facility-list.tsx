import Link from "next/link";
import { Table, Td, Th } from "@/components/ui/table";
import { FACILITIES_BASE_PATH, formatYmd } from "@/lib/validation/facility";
import type { FacilityListItem } from "../_lib/queries";
import { ActiveBadge, CategoryLabel, DataKindBadge, PublicBadge, VerificationBadge } from "./facility-badges";

const dash = <span className="text-gray-400">—</span>;

function placeOf(f: FacilityListItem): string {
  const state = f.state?.name ?? "";
  return f.municipality ? `${f.municipality.name}, ${state}` : state || "—";
}

function PublicLink({ f, className }: { f: FacilityListItem; className?: string }) {
  if (!f.is_public || !f.active) return <span className="text-sm text-gray-500">Sin ficha pública</span>;
  return (
    <Link href={`/directorio/${f.id}`} className={className ?? "inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2"}>
      Ficha pública
    </Link>
  );
}

/** Tabla en escritorio y tarjetas en móvil. */
export function FacilityList({ items }: { items: FacilityListItem[] }) {
  return (
    <>
      <ul className="space-y-3 md:hidden" aria-label="Instalaciones">
        {items.map((f) => (
          <li key={f.id} className="rounded-card border border-gray-200 bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900">{f.official_name}</p>
              <p className="text-sm text-gray-600">
                {f.internal_code}
                {f.unit_key ? ` · Clave ${f.unit_key}` : ""}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <ActiveBadge active={f.active} />
              <VerificationBadge status={f.verification_status} />
              <DataKindBadge isDemo={f.is_demo} />
              <PublicBadge isPublic={f.is_public} active={f.active} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div className="col-span-2">
                <dt className="text-gray-500">Categoría</dt>
                <dd className="text-gray-900">{f.category ? <CategoryLabel name={f.category.name} color={f.category.color} /> : "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-500">Ubicación</dt>
                <dd className="text-gray-900">{placeOf(f)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Última verificación</dt>
                <dd className="text-gray-900">{formatYmd(f.last_verified_at)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Coordenadas</dt>
                <dd className="text-gray-900">{f.latitude !== null && f.longitude !== null ? "Capturadas" : "Sin coordenadas"}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link
                href={`${FACILITIES_BASE_PATH}/${f.id}/editar`}
                className="inline-flex min-h-11 items-center rounded-xl bg-brand-800 px-4 font-semibold text-white hover:bg-brand-900"
              >
                Editar
              </Link>
              <PublicLink f={f} />
            </div>
          </li>
        ))}
      </ul>

      <Table caption="Instalaciones" className="hidden md:block">
        <thead>
          <tr>
            <Th>Nombre oficial</Th>
            <Th>Categoría</Th>
            <Th>Ubicación</Th>
            <Th>Verificación</Th>
            <Th>Datos</Th>
            <Th>Estado</Th>
            <Th>
              <span className="sr-only">Acciones</span>
            </Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((f) => (
            <tr key={f.id} className="hover:bg-gray-50">
              <Td className="min-w-56">
                <Link
                  href={`${FACILITIES_BASE_PATH}/${f.id}/editar`}
                  className="inline-flex min-h-11 items-center font-semibold text-brand-800 underline underline-offset-2"
                >
                  {f.official_name}
                </Link>
                <span className="block text-xs text-gray-600">
                  {f.internal_code}
                  {f.unit_key ? ` · Clave ${f.unit_key}` : ""}
                  {f.latitude === null || f.longitude === null ? " · Sin coordenadas" : ""}
                </span>
              </Td>
              <Td className="min-w-40">{f.category ? <CategoryLabel name={f.category.name} color={f.category.color} /> : dash}</Td>
              <Td className="min-w-40">{placeOf(f)}</Td>
              <Td className="min-w-40">
                <VerificationBadge status={f.verification_status} />
                {f.last_verified_at ? <span className="mt-1 block text-xs text-gray-600">{formatYmd(f.last_verified_at)}</span> : null}
              </Td>
              <Td>
                <DataKindBadge isDemo={f.is_demo} />
              </Td>
              <Td className="min-w-40">
                <span className="flex flex-col items-start gap-1">
                  <ActiveBadge active={f.active} />
                  <PublicBadge isPublic={f.is_public} active={f.active} />
                </span>
              </Td>
              <Td className="whitespace-nowrap">
                <span className="flex flex-col items-start">
                  <Link
                    href={`${FACILITIES_BASE_PATH}/${f.id}/editar`}
                    className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2"
                  >
                    Editar
                  </Link>
                  <PublicLink f={f} />
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
