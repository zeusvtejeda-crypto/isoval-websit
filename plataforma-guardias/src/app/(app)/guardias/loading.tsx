import { LoadingState } from "@/components/ui/states";

export default function GuardiasLoading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando guardias…" rows={5} />
    </div>
  );
}
