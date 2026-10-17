"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function HistorialTrabajadorError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState
      title="No se pudo cargar el historial del trabajador"
      description="Revisa tu conexión e inténtalo de nuevo. Si el problema continúa, avisa a administración."
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => retry()} size="lg">
            Reintentar
          </Button>
          <Link href="/historial" className={buttonClasses("outline", "lg")}>
            Volver al historial
          </Link>
        </div>
      }
    />
  );
}
