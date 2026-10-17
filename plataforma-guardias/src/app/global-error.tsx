"use client";

// global-error reemplaza al layout raíz: necesita sus propios estilos globales.
import "./globals.css";
import { useEffect } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

/** Identificador del error del servidor (error.digest) para cotejar con los registros. */
function errorDigest(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("digest" in error)) return null;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.trim() ? digest.trim() : null;
}

/**
 * Error en el layout raíz: define su propio <html lang="es-MX"> y <body>.
 * «Ir al inicio» recarga la página completa (el enrutador puede no estar
 * disponible). Sin metadata: el título se pone con <title>.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = errorDigest(error);

  return (
    <html lang="es-MX" className="h-full antialiased">
      <body className="min-h-full">
        <title>Error · Guardias y Directorio</title>
        <main id="contenido" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-4 py-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-800">Guardias y Directorio</p>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">La aplicación tuvo un problema</h1>
          <ErrorState
            title="No se pudo cargar la plataforma"
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
                {/* Enlace normal a propósito: recarga todo el documento. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/" className={buttonClasses("outline", "lg")}>
                  Ir al inicio
                </a>
              </div>
            }
          />
          <p className="text-xs text-gray-600">
            Esta plataforma <strong>no es una aplicación oficial del IMSS</strong> ni está afiliada al Instituto.
          </p>
        </main>
      </body>
    </html>
  );
}
