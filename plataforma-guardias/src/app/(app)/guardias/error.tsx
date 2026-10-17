"use client";

import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function GuardiasError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <ErrorState
      title="No se pudieron cargar las guardias"
      description={
        <>
          Revisa tu conexión e inténtalo de nuevo. Si el problema continúa, avisa a administración
          {digest ? ` e indica el código ${digest}` : ""}.
        </>
      }
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => retry()}>Reintentar</Button>
          <Link href="/guardias" className={buttonClasses("outline")}>
            Volver a guardias
          </Link>
        </div>
      }
    />
  );
}
