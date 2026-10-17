import { LoadingState } from "@/components/ui/states";

export default function CorreccionesLoading() {
  return (
    <div className="space-y-5">
      <div className="h-9 w-72 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando solicitudes de corrección…" rows={4} />
    </div>
  );
}
