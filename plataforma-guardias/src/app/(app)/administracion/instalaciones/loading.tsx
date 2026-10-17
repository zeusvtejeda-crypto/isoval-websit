import { LoadingState } from "@/components/ui/states";

export default function InstalacionesLoading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-gray-200" />
      <div className="h-40 animate-pulse rounded-[--radius-card] bg-gray-100" />
      <LoadingState label="Cargando instalaciones…" rows={5} />
    </div>
  );
}
