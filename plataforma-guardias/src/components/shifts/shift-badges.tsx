import { Badge } from "@/components/ui/badge";
import { SHIFT_STATUS_LABELS, SHIFT_STATUS_TONE } from "@/lib/attendance/labels";
import type { ShiftStatus } from "@/lib/attendance/calc";

/** Estado de la guardia (siempre con texto) y aviso de cobertura insuficiente. */
export function ShiftStatusBadges({
  effectiveStatus,
  storedStatus,
  insufficient,
}: {
  effectiveStatus: ShiftStatus;
  storedStatus?: ShiftStatus;
  insufficient: boolean;
}) {
  const manualFinish = storedStatus === "finalizada";
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <Badge tone={SHIFT_STATUS_TONE[effectiveStatus]}>
        {SHIFT_STATUS_LABELS[effectiveStatus]}
        {manualFinish ? " (manual)" : ""}
      </Badge>
      {insufficient ? <Badge tone="warning">Cobertura insuficiente</Badge> : null}
    </span>
  );
}
