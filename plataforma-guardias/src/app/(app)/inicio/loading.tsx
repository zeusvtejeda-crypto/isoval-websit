import { LoadingState } from "@/components/ui/states";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-9 w-40 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando el resumen de hoy…" rows={4} />
    </div>
  );
}
