import { LoadingState } from "@/components/ui/states";

export default function CatalogosLoading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-72 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando catálogos geográficos…" rows={5} />
    </div>
  );
}
