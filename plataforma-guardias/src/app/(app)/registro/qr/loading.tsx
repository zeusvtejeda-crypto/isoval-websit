import { LoadingState } from "@/components/ui/states";

export default function RegistroQrLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-200" />
      <LoadingState label="Validando el código QR…" rows={2} />
    </div>
  );
}
