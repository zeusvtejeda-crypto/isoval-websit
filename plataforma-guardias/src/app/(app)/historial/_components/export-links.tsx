import { buttonClasses } from "@/components/ui/button";
import { exportHref, MAX_RANGE_DAYS, type ReportFilters } from "@/lib/reports/params";

/** Enlaces de descarga (Excel y PDF) con los mismos filtros de la vista. */
export function ExportLinks({ filters, compact = false }: { filters: Partial<ReportFilters>; compact?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <a href={exportHref(filters, "xlsx")} className={buttonClasses("outline", "md")} rel="nofollow">
          Exportar a Excel
        </a>
        <a href={exportHref(filters, "pdf")} className={buttonClasses("outline", "md")} rel="nofollow">
          Exportar a PDF
        </a>
      </div>
      {compact ? null : (
        <p className="text-xs text-gray-600">La exportación usa los filtros aplicados (máximo {MAX_RANGE_DAYS} días).</p>
      )}
    </div>
  );
}
