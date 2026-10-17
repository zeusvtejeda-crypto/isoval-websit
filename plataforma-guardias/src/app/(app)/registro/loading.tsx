import { LoadingState } from "@/components/ui/states";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Cargando tus guardias…" rows={3} />
    </div>
  );
}
