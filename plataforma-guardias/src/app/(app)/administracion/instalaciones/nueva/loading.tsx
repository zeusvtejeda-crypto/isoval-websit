import { LoadingState } from "@/components/ui/states";

export default function NuevaInstalacionLoading() {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando formulario…" rows={6} />
    </div>
  );
}
