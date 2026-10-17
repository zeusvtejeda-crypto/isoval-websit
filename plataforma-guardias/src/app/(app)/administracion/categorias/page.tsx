import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_CATEGORY_FORM, categoryIconLabel, firstParam, type RawSearchParams } from "@/lib/validation/facility";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { Table, Td, Th } from "@/components/ui/table";
import { CategoryForm } from "./_components/category-form";
import { saveCategory } from "./actions";
import { getCategoriesWithUsage, type CategoryWithUsage } from "./_lib/queries";

export const metadata = { title: "Categorías de instalaciones" };

function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block size-4 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color }} />;
}

function StatusBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "success" : "muted"}>{active ? "Activa" : "Inactiva"}</Badge>;
}

function usageText(c: CategoryWithUsage): string {
  return c.usage === 0 ? "Sin instalaciones" : `${c.usage} ${c.usage === 1 ? "instalación" : "instalaciones"}`;
}

export default async function CategoriasPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireAdmin();
  const supabase = await createClient();
  const sp = await searchParams;
  const categories = await getCategoriesWithUsage(supabase);

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 flex flex-wrap gap-x-4 text-sm">
        <Link href="/administracion" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Administración
        </Link>
        <Link href="/administracion/instalaciones" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          Instalaciones
        </Link>
      </nav>
      <PageHeader
        title="Categorías de instalaciones"
        description="Clasifican las instalaciones en el directorio y en el mapa. Valida los nombres de categoría antes de cargar datos reales."
      />

      <div className="space-y-4">
        {firstParam(sp.guardada) === "1" ? <Alert tone="success">Categoría guardada.</Alert> : null}
        {firstParam(sp.eliminada) === "1" ? <Alert tone="success">Categoría eliminada.</Alert> : null}

        {categories.length === 0 ? (
          <EmptyState title="Aún no hay categorías" description="Crea la primera categoría con el formulario de abajo." />
        ) : (
          <>
            <ul className="space-y-3 md:hidden" aria-label="Categorías">
              {categories.map((c) => (
                <li key={c.id} className="rounded-card border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="inline-flex items-center gap-2 font-semibold text-gray-900">
                      <Swatch color={c.color} />
                      {c.name}
                    </p>
                    <StatusBadge active={c.active} />
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <div>
                      <dt className="text-gray-500">Identificador</dt>
                      <dd className="font-mono text-gray-900">{c.slug}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Orden</dt>
                      <dd className="text-gray-900">{c.sort_order}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Icono</dt>
                      <dd className="text-gray-900">{categoryIconLabel(c.icon)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">En uso</dt>
                      <dd className="text-gray-900">{usageText(c)}</dd>
                    </div>
                  </dl>
                  {c.description ? <p className="mt-2 text-sm text-gray-700">{c.description}</p> : null}
                  <LinkButton href={`/administracion/categorias/${c.id}/editar`} className="mt-3">
                    Editar
                  </LinkButton>
                </li>
              ))}
            </ul>

            <Table caption="Categorías" className="hidden md:block">
              <thead>
                <tr>
                  <Th>Nombre</Th>
                  <Th>Identificador</Th>
                  <Th>Icono</Th>
                  <Th>Orden</Th>
                  <Th>En uso</Th>
                  <Th>Estado</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {categories.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <Td className="min-w-56">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <Swatch color={c.color} />
                        {c.name}
                      </span>
                      {c.description ? <span className="mt-0.5 block text-xs text-gray-600">{c.description}</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-sm">{c.slug}</Td>
                    <Td>{categoryIconLabel(c.icon)}</Td>
                    <Td>{c.sort_order}</Td>
                    <Td className="whitespace-nowrap">
                      {c.usage > 0 ? (
                        <Link
                          href={`/administracion/instalaciones?categoria=${c.id}&activa=todas`}
                          className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2"
                        >
                          {usageText(c)}
                        </Link>
                      ) : (
                        usageText(c)
                      )}
                    </Td>
                    <Td>
                      <StatusBadge active={c.active} />
                    </Td>
                    <Td>
                      <Link
                        href={`/administracion/categorias/${c.id}/editar`}
                        className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2"
                      >
                        Editar
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}

        <Card className="max-w-3xl">
          <CardHeader title="Nueva categoría" description="Una categoría en uso no se borra: se desactiva." />
          <CategoryForm action={saveCategory} defaults={EMPTY_CATEGORY_FORM} />
        </Card>
      </div>
    </>
  );
}
