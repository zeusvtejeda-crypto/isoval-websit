import { LoadingState } from "@/components/ui/states";

export default function BitacoraLoading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-gray-200" />
      <div className="h-40 animate-pulse rounded-xl bg-gray-200" />
      <LoadingState label="Cargando bitácora…" rows={5} />
    </div>
  );
}
