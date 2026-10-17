import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Sección desplegable nativa (<details>): funciona sin JavaScript y mantiene
 * las acciones secundarias ocultas hasta que se necesitan.
 */
const TONES = {
  default: { details: "border-gray-200 bg-white", summary: "text-brand-900 hover:bg-gray-50" },
  danger: { details: "border-red-200 bg-white", summary: "text-red-800 hover:bg-red-50" },
  /** Acción que conviene hacer primero (p. ej. corregir una entrada sin salida). */
  attention: { details: "border-2 border-amber-400 bg-amber-50", summary: "text-amber-950 hover:bg-amber-100" },
} as const;

export function Disclosure({
  summary,
  children,
  tone = "default",
  defaultOpen = false,
  className,
  id,
}: {
  summary: ReactNode;
  children: ReactNode;
  tone?: keyof typeof TONES;
  defaultOpen?: boolean;
  className?: string;
  /** Ancla para enlazar a la sección (al navegar al ancla, el navegador la abre). */
  id?: string;
}) {
  return (
    <details id={id} open={defaultOpen} className={cn("group rounded-xl border", TONES[tone].details, className)}>
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2 font-semibold",
          "[&::-webkit-details-marker]:hidden",
          TONES[tone].summary,
        )}
      >
        <span>{summary}</span>
        <span aria-hidden="true" className="text-sm text-gray-500 group-open:hidden">
          Abrir
        </span>
        <span aria-hidden="true" className="hidden text-sm text-gray-500 group-open:inline">
          Cerrar
        </span>
      </summary>
      <div className="border-t border-gray-100 px-3 pb-3 pt-3">{children}</div>
    </details>
  );
}
