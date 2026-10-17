import { LoadingState } from "@/components/ui/states";

export default function DirectorioLoading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-72 max-w-full animate-pulse rounded-lg bg-gray-200" />
      <div className="h-36 animate-pulse rounded-card bg-gray-200" />
      <div className="lg:grid lg:grid-cols-2 lg:gap-6">
        <LoadingState label="Cargando el directorio de instalaciones…" rows={4} />
        <div className="hidden h-[28rem] animate-pulse rounded-card bg-gray-200 lg:block" />
      </div>
    </div>
  );
}
