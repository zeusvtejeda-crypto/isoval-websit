"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

/** Contenido de los error.tsx del directorio público. */
export function DirectoryRouteError({ error, retry, title }: { error: unknown; retry: () => void; title: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState
      title={title}
      description="Revisa tu conexión e inténtalo de nuevo. Si el problema continúa, vuelve más tarde."
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => retry()} size="lg">
            Reintentar
          </Button>
          <Link href="/" className={buttonClasses("outline", "lg")}>
            Ir al inicio
          </Link>
        </div>
      }
    />
  );
}
