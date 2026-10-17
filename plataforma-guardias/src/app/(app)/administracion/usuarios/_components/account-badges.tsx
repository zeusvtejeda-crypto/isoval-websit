import { Badge } from "@/components/ui/badge";
import { accountStatus, type AccountRow } from "@/lib/admin/accounts";
import { ROLE_LABELS, type AppRole } from "@/lib/auth";

export function RoleBadge({ role }: { role: AppRole }) {
  return <Badge tone={role === "admin" ? "info" : "neutral"}>{ROLE_LABELS[role]}</Badge>;
}

export function StatusBadge({ row, now }: { row: Pick<AccountRow, "active" | "bannedUntil">; now: Date }) {
  const status = accountStatus(row, now);
  return <Badge tone={status.tone}>{status.label}</Badge>;
}
