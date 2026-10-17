"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function CorreccionesError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState
      title="No se pudieron cargar las solicitudes de corrección"
      description="Revisa tu conexión e inténtalo de nuevo. Si el problema continúa, avisa a administración."
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => retry()} size="lg">
            Reintentar
          </Button>
          <Link href="/inicio" className={buttonClasses("outline", "lg")}>
            Ir al inicio
          </Link>
        </div>
      }
    />
  );
}
