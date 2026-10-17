import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { DirectoryExplorer } from "@/components/directory/directory-explorer";
import { parseDirectoryParams, reconcileFilters } from "@/lib/directory/params";
import { loadDirectoryData } from "@/lib/directory/queries";
import type { DirectoryLookups, DirectoryParams } from "@/lib/directory/types";

export const metadata: Metadata = {
  title: "Directorio de instalaciones",
  description: "Directorio público y mapa de instalaciones. Plataforma independiente: no es una aplicación oficial del IMSS.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Directorio público (sin inicio de sesión). Solo lee la vista
 * public_facilities y catálogos públicos con el cliente con RLS.
 */
export default async function DirectorioPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const { facilities, categories, states, municipalities } = await loadDirectoryData();
  const lookups: DirectoryLookups = { categories, states, municipalities };
  const parsed = parseDirectoryParams(raw);
  const initialParams: DirectoryParams = { ...parsed, ...reconcileFilters(parsed, lookups) };
  // Clave nueva en cada render del servidor: una navegación real a /directorio
  // reinicia el explorador. Los cambios de filtros con history.replaceState no
  // vuelven a pedir la página, así que no lo reinician.
  const renderKey = crypto.randomUUID();

  return (
    <>
      <PageHeader
        title="Directorio de instalaciones"
        description="Busca por nombre, clave de unidad, municipio, estado o dirección. Verifica los datos con la fuente indicada en cada ficha antes de acudir."
      />
      <DirectoryExplorer key={renderKey} facilities={facilities} lookups={lookups} initialParams={initialParams} />
    </>
  );
}
