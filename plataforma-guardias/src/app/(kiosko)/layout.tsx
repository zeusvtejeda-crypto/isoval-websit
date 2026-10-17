import type { ReactNode } from "react";
import { OfflineBanner } from "@/components/layout/connection-status";

/**
 * Modo kiosco: pantalla para dejar a la vista en el punto de reunión (código QR).
 * Sin menú ni nombre de la cuenta, para que nadie navegue con la sesión de
 * coordinación por accidente. Cada página exige su propio permiso.
 */
export default function KioskLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <OfflineBanner />
      <div role="note" className="no-print bg-amber-50 px-4 py-2 text-center text-sm font-semibold text-amber-950 ring-1 ring-amber-200">
        La sesión de coordinación sigue abierta en este dispositivo: no lo dejes sin supervisión.
      </div>
      <main id="contenido" className="flex-1 px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
      <footer className="no-print border-t border-gray-200 px-4 py-3 text-center text-xs text-gray-600">
        Esta plataforma <strong>no es una aplicación oficial del IMSS</strong>.
      </footer>
    </div>
  );
}
