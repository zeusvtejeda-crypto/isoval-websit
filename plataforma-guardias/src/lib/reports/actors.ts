/**
 * Quién registró, corrigió o revisó (funciones puras).
 * Los nombres salen de lo que RLS permite leer de `profiles`; si no se puede
 * leer, se describe de forma genérica sin inventar datos.
 */
import type { AttendanceMethod } from "@/lib/attendance/calc";

export type ActorContext = {
  currentUserId: string;
  names: Record<string, string>;
  /** Cuenta vinculada al trabajador del registro (si se conoce). */
  workerProfileId?: string | null;
};

export function actorLabel(profileId: string | null | undefined, ctx: ActorContext, method?: AttendanceMethod | null): string {
  if (!profileId) return "—";
  if (profileId === ctx.currentUserId) return "Tú";
  const name = ctx.names[profileId];
  if (ctx.workerProfileId && profileId === ctx.workerProfileId) {
    return name ? `${name} (la propia persona)` : "La propia persona";
  }
  if (name) return name;
  switch (method) {
    case "propio":
      return "La propia persona";
    case "qr":
      return "Registro por código QR";
    default:
      return "Coordinación o administración";
  }
}
