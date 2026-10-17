import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Tabla con desplazamiento horizontal en pantallas pequeñas. */
export function Table({ children, caption, className }: { children: ReactNode; caption?: string; className?: string }) {
  return (
    <div className={cn("relative overflow-x-auto rounded-card border border-gray-200 bg-white", className)}>
      <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("whitespace-nowrap bg-gray-50 px-3 py-2.5 font-semibold text-gray-700", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2.5 align-top text-gray-900", className)}>{children}</td>;
}
