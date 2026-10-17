import type { Database } from "@/lib/types/database";

type ShiftStatus = Database["public"]["Enums"]["shift_status"];

/** Cifra que se compara con el mínimo según el estado de la guardia, con su etiqueta. */
export function coverageCurrent(
  status: ShiftStatus,
  coverage: { assigned: number; inService: number; attended: number },
): { count: number; label: string } {
  if (status === "en_curso") return { count: coverage.inService, label: "en servicio" };
  if (status === "finalizada") return { count: coverage.attended, label: "con registro" };
  return { count: coverage.assigned, label: "asignadas" };
}
