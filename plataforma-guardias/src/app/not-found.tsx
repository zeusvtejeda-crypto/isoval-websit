import type { Metadata } from "next";
import Link from "next/link";
import { Disclaimer } from "@/components/layout/disclaimer";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Página no encontrada" };

/**
 * Página 404 general: direcciones que no existen y notFound() en rutas sin
 * not-found.tsx propio. Se muestra dentro del layout raíz.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main id="contenido" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-800">Error 404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Página no encontrada</h1>
        <p className="mt-3 text-lg text-gray-700">
          La dirección que buscas no existe o cambió. Revisa que esté bien escrita o vuelve al inicio.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Link href="/" className={buttonClasses("primary", "lg")}>
            Ir al inicio
          </Link>
          <Link href="/directorio" className={buttonClasses("outline", "lg")}>
            Ver directorio
          </Link>
        </div>
      </main>
      <Disclaimer />
    </div>
  );
}
