import { LoadingState } from "@/components/ui/states";

export default function ConfiguracionLoading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando configuración…" rows={4} />
    </div>
  );
}
