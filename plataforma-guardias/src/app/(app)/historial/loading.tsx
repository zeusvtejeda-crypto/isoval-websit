import { LoadingState } from "@/components/ui/states";

export default function HistorialLoading() {
  return (
    <div className="space-y-5">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-200" />
      <div className="h-40 animate-pulse rounded-xl bg-gray-200" />
      <LoadingState label="Cargando historial…" rows={6} />
    </div>
  );
}
