import type { ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { Disclaimer } from "@/components/layout/disclaimer";
import { DirectoryHeader } from "@/components/directory/directory-header";
import { getSessionUser, homePathFor } from "@/lib/auth";

/** Panel del usuario si hay sesión; si la consulta falla, se trata como visitante. */
async function panelHref(): Promise<string | null> {
  try {
    const user = await getSessionUser();
    return user ? homePathFor(user.role) : null;
  } catch (error) {
    // Errores internos de Next.js (uso de cookies al prerenderizar, etc.) se relanzan.
    unstable_rethrow(error);
    return null;
  }
}

/** Armazón público del directorio: no requiere sesión. */
export default async function DirectorioLayout({ children }: { children: ReactNode }) {
  const href = await panelHref();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>
      <DirectoryHeader panelHref={href} />
      <main id="contenido" className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 lg:py-6">
        {children}
      </main>
      <Disclaimer />
    </div>
  );
}
