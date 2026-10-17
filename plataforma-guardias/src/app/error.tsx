"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Disclaimer } from "@/components/layout/disclaimer";
import { Button, buttonClasses } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

/** Identificador del error del servidor (error.digest) para cotejar con los registros. */
function errorDigest(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("digest" in error)) return null;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.trim() ? digest.trim() : null;
}

/**
 * Respaldo para las rutas públicas sin error.tsx propio (inicio, inicio de
 * sesión, aviso de privacidad, etc.) y para fallas de los layouts de sección.
 * No muestra el mensaje técnico: solo el código de referencia.
 */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = errorDigest(error);

  return (
    <div className="flex min-h-dvh flex-col">
      <main id="contenido" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-4 py-10">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Algo salió mal</h1>
        <ErrorState
          title="No se pudo mostrar esta página"
          description={
            <>
              Revisa tu conexión e inténtalo de nuevo. Si el problema continúa, vuelve más tarde.
              {digest ? (
                <span className="mt-1 block">
                  Código de referencia: <code className="font-mono">{digest}</code>
                </span>
              ) : null}
            </>
          }
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={() => retry()}>
                Reintentar
              </Button>
              <Link href="/" className={buttonClasses("outline", "lg")}>
                Ir al inicio
              </Link>
            </div>
          }
        />
      </main>
      <Disclaimer />
    </div>
  );
}
