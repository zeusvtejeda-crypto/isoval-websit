import { LoadingState } from "@/components/ui/states";

export default function FichaLoading() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
      <div className="h-9 w-96 max-w-full animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando la ficha de la instalación…" rows={5} />
    </div>
  );
}
