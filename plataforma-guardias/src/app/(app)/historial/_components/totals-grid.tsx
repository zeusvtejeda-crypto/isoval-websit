import type { TotalsSummary } from "@/lib/attendance/calc";
import { formatDuration } from "@/lib/time";
import { EXTRA_TIME_NOTICE, NO_RANKING_NOTICE } from "@/lib/reports/texts";
import { Stat } from "@/components/ui/card";

/** Totales del periodo (calculados con `totalize`). */
export function ReportTotals({ totals }: { totals: TotalsSummary }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Guardias" value={totals.assignments} hint="Asignaciones, sin contar canceladas" />
        <Stat label="Tiempo programado" value={formatDuration(totals.scheduledMinutes)} />
        <Stat label="Total registrado" value={formatDuration(totals.totalMinutes)} hint="Solo sesiones con entrada y salida" />
        <Stat label="Dentro del horario" value={formatDuration(totals.withinScheduleMinutes)} />
        <Stat label="Fuera del horario" value={formatDuration(totals.outsideScheduleMinutes)} />
        <Stat label="Diferencia" value={formatDuration(totals.differenceMinutes)} hint="Registrado − programado" />
        <Stat
          label="Permanencia adicional"
          value={formatDuration(totals.afterEndMinutes)}
          hint={`Tiempo registrado adicional · ${totals.extraStay} guardia(s)`}
        />
        <Stat label="Llegadas tardías" value={totals.late} />
        <Stat label="Salidas anticipadas" value={totals.earlyLeave} />
        <Stat label="Sustituciones" value={totals.substitutions} />
        <Stat label="Correcciones administrativas" value={totals.corrections} />
        <Stat label="Registros incompletos" value={totals.incomplete} hint="Entrada sin salida: no suma horas" />
        <Stat label="Ausencias justificadas" value={totals.justifiedAbsences} />
        <Stat label="Inasistencias confirmadas" value={totals.confirmedAbsences} hint="Tras revisión" />
        <Stat label="Pendientes de revisión" value={totals.pendingReview} />
      </div>
      <p className="text-sm text-gray-600">{EXTRA_TIME_NOTICE}</p>
      <p className="text-sm text-gray-600">{NO_RANKING_NOTICE}</p>
    </div>
  );
}
