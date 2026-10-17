import { LoadingState } from "@/components/ui/states";

export default function TrabajadorLoading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando ficha del trabajador…" rows={4} />
    </div>
  );
}
