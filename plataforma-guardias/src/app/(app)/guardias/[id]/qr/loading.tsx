import { LoadingState } from "@/components/ui/states";

export default function GuardiaQrLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-200" />
      <div className="mx-auto aspect-square w-full max-w-[min(100%,70vh)] animate-pulse rounded-xl bg-gray-200" />
      <LoadingState label="Cargando código QR…" rows={1} />
    </div>
  );
}
