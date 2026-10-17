import { LoadingState } from "@/components/ui/states";

export default function EditarInstalacionLoading() {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-200" />
      <div className="h-28 animate-pulse rounded-[--radius-card] bg-gray-100" />
      <LoadingState label="Cargando instalación…" rows={6} />
    </div>
  );
}
