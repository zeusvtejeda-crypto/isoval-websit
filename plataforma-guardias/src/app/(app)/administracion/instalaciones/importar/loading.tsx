import { LoadingState } from "@/components/ui/states";

export default function ImportarInstalacionesLoading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-72 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando importación…" rows={4} />
    </div>
  );
}
