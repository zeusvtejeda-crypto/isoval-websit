import { LoadingState } from "@/components/ui/states";

export default function NuevoTrabajadorLoading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando formulario…" rows={6} />
    </div>
  );
}
