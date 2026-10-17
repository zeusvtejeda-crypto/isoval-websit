"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

/** Contenido común de los error.tsx del módulo de asistencia. */
export function RouteError({ error, retry, title }: { error: unknown; retry: () => void; title?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState
      title={title ?? "No se pudo cargar la información"}
      description="Revisa tu conexión e inténtalo de nuevo. Si el problema continúa, avisa a coordinación o administración."
      action={
        <Button onClick={() => retry()} size="lg">
          Reintentar
        </Button>
      }
    />
  );
}
