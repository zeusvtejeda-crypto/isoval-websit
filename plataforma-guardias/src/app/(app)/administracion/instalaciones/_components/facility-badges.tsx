import { Badge } from "@/components/ui/badge";
import { VERIFICATION_LABELS, VERIFICATION_TONE, type VerificationStatus } from "@/lib/validation/facility";

/** Estados con texto (el color solo refuerza). */
export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return <Badge tone={VERIFICATION_TONE[status]}>{VERIFICATION_LABELS[status]}</Badge>;
}

export function DataKindBadge({ isDemo }: { isDemo: boolean }) {
  return isDemo ? <Badge tone="warning">Demostración</Badge> : <Badge tone="neutral">Producción</Badge>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "success" : "muted"}>{active ? "Activa" : "Inactiva"}</Badge>;
}

export function PublicBadge({ isPublic, active }: { isPublic: boolean; active: boolean }) {
  if (isPublic && active) return <Badge tone="info">Visible en el directorio</Badge>;
  return <Badge tone="muted">{isPublic ? "Oculta (inactiva)" : "Oculta del directorio"}</Badge>;
}

/** Muestra de color de la categoría con su nombre (nunca solo color). */
export function CategoryLabel({ name, color }: { name: string; color?: string | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="size-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color ?? "#4b5563" }} />
      <span>{name}</span>
    </span>
  );
}
