import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

/** Paginación por enlaces (funciona sin JavaScript). */
export function AuditPagination({ page, pageCount, total, pageSize, hrefFor }: { page: number; pageCount: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  if (pageCount <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const disabled = buttonClasses("outline", "md", "pointer-events-none opacity-50");
  return (
    <nav aria-label="Paginación de la bitácora" className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-gray-700">
        Eventos {first.toLocaleString("es-MX")}–{last.toLocaleString("es-MX")} de {total.toLocaleString("es-MX")} · Página {page} de {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={buttonClasses("outline")} rel="prev">
            Anterior
          </Link>
        ) : (
          <span aria-disabled="true" className={disabled}>
            Anterior
          </span>
        )}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={buttonClasses("outline")} rel="next">
            Siguiente
          </Link>
        ) : (
          <span aria-disabled="true" className={disabled}>
            Siguiente
          </span>
        )}
      </div>
    </nav>
  );
}
