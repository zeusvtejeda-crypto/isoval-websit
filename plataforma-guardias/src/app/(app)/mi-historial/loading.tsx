import { LoadingState } from "@/components/ui/states";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando tu historial…" rows={5} />
    </div>
  );
}
