"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function HistorialError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <ErrorState
      title="No se pudo cargar el historial"
      description={
        <>
          Revisa tu conexión e inténtalo de nuevo. Si consultas un periodo largo con muchas sedes, acota los filtros.
          {digest ? ` Código de referencia: ${digest}.` : ""}
        </>
      }
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => retry()} size="lg">
            Reintentar
          </Button>
          <Link href="/historial" className={buttonClasses("outline", "lg")}>
            Últimos 7 días
          </Link>
        </div>
      }
    />
  );
}
