import { LoadingState } from "@/components/ui/states";

export default function EditarCategoriaLoading() {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando categoría…" rows={4} />
    </div>
  );
}
