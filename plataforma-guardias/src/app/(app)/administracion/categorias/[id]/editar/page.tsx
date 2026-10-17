import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CategoryFormDefaults } from "@/lib/validation/facility";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { CategoryForm } from "../../_components/category-form";
import { CategoryActiveForm, CategoryDeleteForm } from "../../_components/category-actions";
import { deleteCategory, saveCategory, setCategoryActive } from "../../actions";
import { getCategoryWithUsage } from "../../_lib/queries";

export const metadata = { title: "Editar categoría" };

export default async function EditarCategoriaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id: rawId } = await params;
  if (!/^\d{1,5}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const supabase = await createClient();
  const category = await getCategoryWithUsage(supabase, id);
  if (!category) notFound();

  const defaults: CategoryFormDefaults = {
    name: category.name,
    slug: category.slug,
    description: category.description ?? "",
    icon: category.icon,
    color: /^#[0-9a-fA-F]{6}$/.test(category.color) ? category.color.toLowerCase() : "#166534",
    sort_order: String(category.sort_order),
    active: category.active,
  };

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 text-sm">
        <Link href="/administracion/categorias" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Categorías
        </Link>
      </nav>
      <PageHeader title="Editar categoría" description={category.name} />

      <div className="max-w-3xl space-y-4">
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={category.active ? "success" : "muted"}>{category.active ? "Activa" : "Inactiva"}</Badge>
            <span className="text-gray-700">
              {category.usage === 0 ? (
                "Ninguna instalación la usa."
              ) : (
                <Link
                  href={`/administracion/instalaciones?categoria=${category.id}&activa=todas`}
                  className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2"
                >
                  La usan {category.usage} {category.usage === 1 ? "instalación" : "instalaciones"}
                </Link>
              )}
            </span>
          </div>
          {category.usage > 0 ? (
            <Alert tone="info" className="mb-4">
              Cambiar el identificador (slug) afecta los enlaces del directorio filtrados por esta categoría y los archivos de importación que lo usen.
            </Alert>
          ) : null}
          <CategoryForm key={category.updated_at} action={saveCategory} categoryId={category.id} defaults={defaults} cancelHref="/administracion/categorias" />
        </Card>

        <Card>
          <CardHeader
            title={category.active ? "Desactivar categoría" : "Activar categoría"}
            description={
              category.active
                ? "Una categoría inactiva no se ofrece para nuevas instalaciones; las que ya la usan la conservan."
                : "Vuelve a ofrecerse para nuevas instalaciones."
            }
          />
          <CategoryActiveForm action={setCategoryActive} categoryId={category.id} active={category.active} inUse={category.usage} />
        </Card>

        <Card className="border-red-200">
          <CardHeader title="Eliminar categoría" description="Solo es posible si ninguna instalación la usa." />
          {category.usage > 0 ? (
            <Alert tone="warning" title="No se puede eliminar">
              La usan {category.usage} {category.usage === 1 ? "instalación" : "instalaciones"}. Desactívala en su lugar.
            </Alert>
          ) : (
            <CategoryDeleteForm action={deleteCategory} categoryId={category.id} />
          )}
        </Card>
      </div>
    </>
  );
}
