import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

/** Paginación por enlaces (funciona sin JavaScript). */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-gray-700">
        Filas {first}–{last} de {total} · Página {page} de {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={buttonClasses("outline", "md")}>
            Anterior
          </Link>
        ) : (
          <span aria-disabled="true" className={buttonClasses("outline", "md", "pointer-events-none opacity-50")}>
            Anterior
          </span>
        )}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={buttonClasses("outline", "md")}>
            Siguiente
          </Link>
        ) : (
          <span aria-disabled="true" className={buttonClasses("outline", "md", "pointer-events-none opacity-50")}>
            Siguiente
          </span>
        )}
      </div>
    </nav>
  );
}
