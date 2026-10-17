import type { AttendanceSummary, TotalsSummary } from "@/lib/attendance/calc";
import type { SessionRow } from "@/lib/attendance/load";
import { INCIDENT_LABELS, METHOD_LABELS, RECORD_STATUS_LABELS, type Tone } from "@/lib/attendance/labels";
import { formatDateTime, formatDuration } from "@/lib/time";
import { EXTRA_TIME_NOTE } from "@/lib/presence/texts";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";

const RECORD_TONE: Record<SessionRow["record_status"], Tone> = {
  vigente: "success",
  corregido: "muted",
  anulado: "muted",
};

/** Sesiones de una asignación: vigentes y versiones corregidas/anuladas (trazabilidad). */
export function SessionVersions({ sessions, timeZone }: { sessions: SessionRow[]; timeZone: string }) {
  if (sessions.length === 0) return <p className="text-gray-600">Sin registros de entrada o salida.</p>;
  const sorted = sessions.slice().sort((a, b) => Date.parse(a.check_in_at) - Date.parse(b.check_in_at) || a.created_at.localeCompare(b.created_at));
  return (
    <ul className="space-y-2">
      {sorted.map((s) => {
        const vigente = s.record_status === "vigente";
        return (
          <li key={s.id} className={vigente ? "rounded-xl border border-gray-200 p-3" : "rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-gray-600"}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={RECORD_TONE[s.record_status]}>{RECORD_STATUS_LABELS[s.record_status]}</Badge>
              {s.supersedes_id ? <Badge tone="info">Versión corregida</Badge> : null}
            </div>
            <p className={vigente ? "mt-1 text-gray-900" : "mt-1 line-through decoration-gray-400"}>
              Entrada: {formatDateTime(s.check_in_at, timeZone)} · Salida: {s.check_out_at ? formatDateTime(s.check_out_at, timeZone) : "sin salida"}
            </p>
            <p className="text-sm text-gray-600">
              {METHOD_LABELS[s.check_in_method]}
              {s.check_out_method && s.check_out_method !== s.check_in_method ? ` · Salida: ${METHOD_LABELS[s.check_out_method]}` : ""}
            </p>
            {s.status_reason ? <p className="text-sm text-gray-700">Motivo del cambio: {s.status_reason}</p> : null}
            {s.check_in_reason && s.check_in_method !== "propio" ? <p className="text-sm text-gray-700">Motivo: {s.check_in_reason}</p> : null}
            {s.notes ? <p className="text-sm text-gray-700">Nota: {s.notes}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Métricas de una asignación (calculadas por summarizeAttendance). */
export function SummaryMetrics({ summary }: { summary: AttendanceSummary }) {
  const items: Array<[string, string]> = [
    ["Programado", formatDuration(summary.scheduledMinutes)],
    ["Registrado dentro del horario", formatDuration(summary.withinScheduleMinutes)],
    ["Registrado fuera del horario", formatDuration(summary.outsideScheduleMinutes)],
    ["Total registrado", formatDuration(summary.totalMinutes)],
    ["Diferencia (registrado − programado)", formatDuration(summary.differenceMinutes)],
    ["Permanencia adicional", formatDuration(summary.afterEndMinutes)],
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-gray-600">{k}</dt>
            <dd className="font-semibold text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
      {summary.openSession ? (
        <p className="mt-2 text-sm text-gray-700">Hay una entrada sin salida: no suma tiempo registrado hasta que se cierre o se corrija.</p>
      ) : null}
    </div>
  );
}

export function IncidentBadges({ summary }: { summary: AttendanceSummary }) {
  if (summary.incidents.length === 0) return <p className="text-sm text-gray-600">Sin incidencias.</p>;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Incidencias">
      {summary.incidents.map((i) => (
        <li key={i.type}>
          <Badge tone={i.type === "registro_incompleto" ? "warning" : "neutral"}>
            {INCIDENT_LABELS[i.type]}
            {i.minutes != null ? `: ${formatDuration(i.minutes)}` : ""}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Totales del periodo (totalize). */
export function TotalsGrid({ totals }: { totals: TotalsSummary }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Guardias" value={totals.assignments} hint="Sin contar canceladas" />
        <Stat label="Tiempo programado" value={formatDuration(totals.scheduledMinutes)} />
        <Stat label="Total registrado" value={formatDuration(totals.totalMinutes)} />
        <Stat label="Dentro del horario" value={formatDuration(totals.withinScheduleMinutes)} />
        <Stat label="Fuera del horario" value={formatDuration(totals.outsideScheduleMinutes)} />
        <Stat label="Diferencia" value={formatDuration(totals.differenceMinutes)} hint="Registrado − programado" />
        <Stat label="Permanencia adicional" value={formatDuration(totals.afterEndMinutes)} hint={`${totals.extraStay} guardia(s)`} />
        <Stat label="Llegadas tardías" value={totals.late} />
        <Stat label="Salidas anticipadas" value={totals.earlyLeave} />
        <Stat label="Registros incompletos" value={totals.incomplete} />
        <Stat label="Correcciones administrativas" value={totals.corrections} />
        <Stat label="Pendientes de revisión" value={totals.pendingReview} />
      </div>
      <p className="text-sm text-gray-600">{EXTRA_TIME_NOTE}</p>
    </div>
  );
}
