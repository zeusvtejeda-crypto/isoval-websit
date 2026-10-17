"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function InstalacionesError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <ErrorState
      title="No se pudo cargar la información de instalaciones"
      description={
        <>
          Revisa tu conexión e inténtalo de nuevo. Si el problema continúa, avisa a soporte técnico
          {digest ? ` e indica el código ${digest}` : ""}.
        </>
      }
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => retry()}>Reintentar</Button>
          <Link href="/administracion/instalaciones" className={buttonClasses("outline")}>
            Volver a instalaciones
          </Link>
        </div>
      }
    />
  );
}
