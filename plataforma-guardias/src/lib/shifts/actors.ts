/**
 * Descripción de quién registró o cambió un registro (puro).
 * Las cuentas se resuelven con lo que RLS permite leer de `profiles`; si no
 * se puede leer el nombre, se describe por el método de registro.
 */
import type { AttendanceMethod } from "@/lib/attendance/calc";

export type ActorContext = {
  currentUserId: string;
  /** Cuenta vinculada al trabajador de la asignación (si se conoce). */
  workerProfileId?: string | null;
  method?: AttendanceMethod | null;
};

export function describeActor(profileId: string | null | undefined, names: Record<string, string>, ctx: ActorContext): string {
  if (!profileId) return "—";
  if (profileId === ctx.currentUserId) return "Tú";
  const name = names[profileId];
  if (ctx.workerProfileId && profileId === ctx.workerProfileId) {
    return name ? `${name} (la propia persona)` : "La propia persona";
  }
  if (name) return name;
  switch (ctx.method) {
    case "propio":
      return "La propia persona";
    case "qr":
      return "Registro por código QR";
    case "coordinador":
    case "correccion":
      return "Coordinación o administración";
    default:
      return "Otra cuenta";
  }
}

/** Ids de cuentas presentes en una lista de sesiones y asignaciones (sin repetir). */
export function collectActorIds(
  sessions: { check_in_by: string; check_out_by: string | null; status_changed_by: string | null }[],
  assignments: { status_changed_by: string | null; created_by: string | null }[] = [],
): string[] {
  const ids = new Set<string>();
  for (const s of sessions) {
    ids.add(s.check_in_by);
    if (s.check_out_by) ids.add(s.check_out_by);
    if (s.status_changed_by) ids.add(s.status_changed_by);
  }
  for (const a of assignments) {
    if (a.status_changed_by) ids.add(a.status_changed_by);
    if (a.created_by) ids.add(a.created_by);
  }
  return [...ids];
}
