"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

/** Vuelve a pedir los datos al servidor sin recargar la página. */
export function RefreshButton({ label = "Actualizar" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? "Actualizando…" : label}
    </Button>
  );
}
