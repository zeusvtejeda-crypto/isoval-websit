import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

/**
 * Encabezado público del directorio (sin navegación privada). Si hay sesión
 * muestra «Ir a mi panel»; si no, «Iniciar sesión».
 */
export function DirectoryHeader({ panelHref }: { panelHref: string | null }) {
  return (
    <header className="no-print border-b border-gray-200 bg-white">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <Link href="/" className="flex min-h-11 flex-col justify-center leading-tight">
          <span className="font-bold text-brand-900">Guardias y Directorio</span>
          <span className="text-xs text-gray-600">Plataforma independiente</span>
        </Link>
        <nav aria-label="Acceso" className="flex items-center gap-2">
          <Link href="/directorio" className={buttonClasses("ghost", "md", "hidden sm:inline-flex")}>
            Directorio
          </Link>
          {panelHref ? (
            <Link href={panelHref} className={buttonClasses("primary", "md")}>
              Ir a mi panel
            </Link>
          ) : (
            <Link href="/login" className={buttonClasses("primary", "md")}>
              Iniciar sesión
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
