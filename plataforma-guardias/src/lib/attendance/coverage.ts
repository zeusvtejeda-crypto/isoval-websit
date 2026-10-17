import type { Database } from "@/lib/types/database";

type ShiftStatus = Database["public"]["Enums"]["shift_status"];

/** Cifra que se compara con el mínimo según el estado de la guardia, con su etiqueta. */
export function coverageCurrent(
  status: ShiftStatus,
  coverage: { assigned: number; inService: number; attended: number },
): { count: number; label: string } {
  if (status === "en_curso") return { count: coverage.inService, label: "en servicio" };
  if (status === "finalizada") return { count: coverage.attended, label: "con registro" };
  return { count: coverage.assigned, label: coverage.assigned === 1 ? "asignada" : "asignadas" };
}

type CoverageItem = { assignment: { status: string }; summary: { status: string; firstCheckIn: Date | null } };

/** Cobertura de una guardia a partir de sus asignaciones (misma regla en el servidor y en las pruebas). */
export function computeCoverage(status: ShiftStatus, items: CoverageItem[], minStaff: number, maxStaff: number | null) {
  const active = items.filter((i) => i.assignment.status === "asignado");
  const assigned = active.length;
  const inService = items.filter((i) => i.summary.status === "en_servicio").length;
  const attended = active.filter((i) => i.summary.firstCheckIn != null).length;
  const insufficient = status !== "cancelada" && coverageCurrent(status, { assigned, inService, attended }).count < minStaff;
  return { assigned, inService, attended, minStaff, maxStaff, insufficient };
}
