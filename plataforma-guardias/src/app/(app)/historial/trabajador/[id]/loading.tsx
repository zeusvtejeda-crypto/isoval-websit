import { LoadingState } from "@/components/ui/states";

export default function HistorialTrabajadorLoading() {
  return (
    <div className="space-y-5">
      <div className="h-9 w-72 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando historial del trabajador…" rows={5} />
    </div>
  );
}
