import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Sección desplegable nativa (<details>): funciona sin JavaScript y mantiene
 * las acciones secundarias ocultas hasta que se necesitan.
 */
export function Disclosure({
  summary,
  children,
  tone = "default",
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  tone?: "default" | "danger";
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={cn("group rounded-xl border bg-white", tone === "danger" ? "border-red-200" : "border-gray-200", className)}>
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2 font-semibold",
          "[&::-webkit-details-marker]:hidden",
          tone === "danger" ? "text-red-800 hover:bg-red-50" : "text-brand-900 hover:bg-gray-50",
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
