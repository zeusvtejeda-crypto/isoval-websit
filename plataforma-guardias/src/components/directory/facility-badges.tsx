import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { safeHexColor } from "@/lib/directory/format";
import { contrastInk } from "@/lib/directory/icons";
import { CategoryIcon } from "./category-icon";

/**
 * Categoría con su ícono sobre el color de la categoría. El texto siempre
 * acompaña al color y al ícono (ambos son decorativos).
 */
export function CategoryTag({
  name,
  color,
  icon,
  className,
}: {
  name: string | null;
  color?: string | null;
  icon?: string | null;
  className?: string;
}) {
  const background = safeHexColor(color);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium text-gray-800", className)}>
      <span
        aria-hidden="true"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ring-black/10"
        style={{ backgroundColor: background, color: contrastInk(background) }}
      >
        <CategoryIcon icon={icon} className="size-4" />
      </span>
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
