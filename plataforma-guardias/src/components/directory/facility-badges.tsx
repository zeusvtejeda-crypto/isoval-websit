import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { safeHexColor } from "@/lib/directory/format";

/** Categoría con muestra de color (el texto siempre acompaña al color). */
export function CategoryTag({ name, color, className }: { name: string | null; color?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium text-gray-800", className)}>
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-sm ring-1 ring-black/10"
        style={{ backgroundColor: safeHexColor(color) }}
      />
      {name ?? "Sin categoría"}
    </span>
  );
}

export function VerificationBadge({ verified }: { verified: boolean }) {
  return verified ? <Badge tone="success">Verificado</Badge> : <Badge tone="warning">Pendiente de verificación</Badge>;
}

export function DemoBadge() {
  return <Badge tone="info">Datos de demostración</Badge>;
}
