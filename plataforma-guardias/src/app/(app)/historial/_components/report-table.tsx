import Link from "next/link";
import { ATTENDANCE_STATUS_TONE } from "@/lib/attendance/labels";
import { formatDuration } from "@/lib/time";
import { GAP_LABEL } from "@/lib/reports/document";
import type { Justification, ReportRow } from "@/lib/reports/rows";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";

function minutesOrDash(value: number | null): string {
  return value == null ? "—" : formatDuration(value);
}

function YesNo({ value, tone = "neutral" }: { value: boolean; tone?: "neutral" | "warning" | "info" }) {
  return value ? (
    <Badge tone={tone} className="whitespace-nowrap">
      Sí
    </Badge>
  ) : (
    <span className="text-gray-500">No</span>
  );
}

/** Justificaciones registradas por coordinación (incident_notes) de una asignación. */
function Justifications({ items }: { items: Justification[] }) {
  return (
    <ul className="space-y-1">
      {items.map((j) => (
        <li key={j.type}>
          <span className="font-medium text-gray-900">
            {j.label}
            {j.stale ? " (ya no se calcula)" : ""}
          </span>
          {j.justified ? "" : <span className="text-gray-600"> · Nota sin justificar</span>}
          <span className="block text-gray-800">{j.note}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tabla del historial por asignación. En pantallas pequeñas se muestra como
 * tarjetas; en tableta y escritorio como tabla con desplazamiento horizontal.
 * El orden es por fecha (nunca por desempeño).
 */
export function ReportTable({ rows, workerHref }: { rows: ReportRow[]; workerHref: (workerId: string) => string }) {
  return (
    <>
      {/* Móvil: tarjetas */}
      <ul className="space-y-3 md:hidden" aria-label="Guardias del periodo">
        {rows.map((r) => (
          <li key={r.assignmentId} className="rounded-card border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize text-gray-600">{r.dateLabel}</p>
                <Link href={workerHref(r.workerId)} className="inline-flex min-h-11 items-center text-lg font-semibold text-brand-900 underline underline-offset-2">
                  {r.workerName}
                </Link>
                <p className="text-sm text-gray-700">{r.facilityName}</p>
                <p className="text-gray-900">
                  {r.scheduleLabel} <span className="text-sm text-gray-600">({r.zoneOffset})</span>
                </p>
              </div>
              <Badge tone={ATTENDANCE_STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-gray-600">Programado</dt>
                <dd className="font-semibold">{formatDuration(r.scheduledMinutes)}</dd>
              </div>
              <div>
                <dt className="text-gray-600">Total registrado</dt>
                <dd className="font-semibold">{formatDuration(r.totalMinutes)}</dd>
              </div>
              <div>
                <dt className="text-gray-600">Dentro del horario</dt>
                <dd className="font-semibold">{formatDuration(r.withinScheduleMinutes)}</dd>
              </div>
              <div>
                <dt className="text-gray-600">Fuera del horario</dt>
                <dd className="font-semibold">{formatDuration(r.outsideScheduleMinutes)}</dd>
              </div>
              <div>
                <dt className="text-gray-600">Diferencia</dt>
                <dd className="font-semibold">{formatDuration(r.differenceMinutes)}</dd>
              </div>
              <div>
                <dt className="text-gray-600">Permanencia adicional</dt>
                <dd className="font-semibold">{formatDuration(r.extraStayMinutes)}</dd>
              </div>
              <div>
                <dt className="text-gray-600">Retraso</dt>
                <dd className="font-semibold">{minutesOrDash(r.lateMinutes)}</dd>
              </div>
              <div>
                <dt className="text-gray-600">Salida anticipada</dt>
                <dd className="font-semibold">{minutesOrDash(r.earlyLeaveMinutes)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-600">{GAP_LABEL}</dt>
                <dd className="font-semibold">{formatDuration(r.gapMinutes)}</dd>
              </div>
            </dl>
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Señales">
              {r.substitution ? (
                <li>
                  <Badge tone="info">Sustitución{r.substituteForName ? ` de ${r.substituteForName}` : ""}</Badge>
                </li>
              ) : null}
              {r.corrected ? (
                <li>
                  <Badge tone="info">Corrección administrativa</Badge>
                </li>
              ) : null}
              {r.incomplete ? (
                <li>
                  <Badge tone="warning">Registro incompleto</Badge>
                </li>
              ) : null}
              {r.needsReview && !r.incomplete ? (
                <li>
                  <Badge tone="warning">Pendiente de revisión</Badge>
                </li>
              ) : null}
            </ul>
            {r.justifications.length ? (
              <div className="mt-3 text-sm">
                <p className="font-medium text-gray-600">Justificación</p>
                <Justifications items={r.justifications} />
              </div>
            ) : null}
            <Link href={`/guardias/${r.shiftId}`} className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand-800 underline underline-offset-2">
              Ver guardia
            </Link>
          </li>
        ))}
      </ul>

      {/* Tableta y escritorio: tabla */}
      <Table caption="Historial de guardias por asignación, ordenado por fecha" className="hidden md:block">
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Trabajador</Th>
            <Th>Sede</Th>
            <Th>Horario</Th>
            <Th>Estado</Th>
            <Th className="text-right">Programado</Th>
            <Th className="text-right">Dentro del horario</Th>
            <Th className="text-right">Fuera del horario</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">
              Tiempo entre salida y regreso{" "}
              <span className="block text-xs font-normal">(no cuenta)</span>
            </Th>
            <Th className="text-right">Diferencia</Th>
            <Th className="text-right">Retraso</Th>
            <Th className="text-right">Salida anticipada</Th>
            <Th className="text-right">
              Permanencia adicional
              <span className="block text-xs font-normal">(tiempo registrado adicional)</span>
            </Th>
            <Th>Sustitución</Th>
            <Th>Corrección</Th>
            <Th>Registro incompleto</Th>
            <Th>Justificación</Th>
            <Th>
              <span className="sr-only">Acciones</span>
            </Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.assignmentId} className="hover:bg-gray-50">
              <Td className="whitespace-nowrap capitalize">{r.dateLabel}</Td>
              <Td className="min-w-44">
                <Link href={workerHref(r.workerId)} className="font-semibold text-brand-900 underline-offset-2 hover:underline">
                  {r.workerName}
                </Link>
                {r.workerCode ? <span className="block text-xs text-gray-600">{r.workerCode}</span> : null}
              </Td>
              <Td className="min-w-44">{r.facilityName}</Td>
              <Td className="whitespace-nowrap">
                {r.scheduleLabel}
                <span className="block text-xs text-gray-600">{r.zoneOffset}</span>
              </Td>
              <Td className="min-w-40">
                <Badge tone={ATTENDANCE_STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
                {r.needsReview && !r.incomplete ? <span className="mt-1 block text-xs text-amber-900">Pendiente de revisión</span> : null}
              </Td>
              <Td className="whitespace-nowrap text-right">{formatDuration(r.scheduledMinutes)}</Td>
              <Td className="whitespace-nowrap text-right">{formatDuration(r.withinScheduleMinutes)}</Td>
              <Td className="whitespace-nowrap text-right">{formatDuration(r.outsideScheduleMinutes)}</Td>
              <Td className="whitespace-nowrap text-right font-semibold">{formatDuration(r.totalMinutes)}</Td>
              <Td className="whitespace-nowrap text-right">{formatDuration(r.gapMinutes)}</Td>
              <Td className="whitespace-nowrap text-right">{formatDuration(r.differenceMinutes)}</Td>
              <Td className="whitespace-nowrap text-right">{minutesOrDash(r.lateMinutes)}</Td>
              <Td className="whitespace-nowrap text-right">{minutesOrDash(r.earlyLeaveMinutes)}</Td>
              <Td className="whitespace-nowrap text-right">{formatDuration(r.extraStayMinutes)}</Td>
              <Td>
                <YesNo value={r.substitution} tone="info" />
                {r.substituteForName ? <span className="block text-xs text-gray-600">de {r.substituteForName}</span> : null}
              </Td>
              <Td>
                <YesNo value={r.corrected} tone="info" />
              </Td>
              <Td>
                <YesNo value={r.incomplete} tone="warning" />
              </Td>
              <Td className="min-w-56 text-sm">
                {r.justifications.length ? <Justifications items={r.justifications} /> : <span className="text-gray-500">—</span>}
              </Td>
              <Td className="whitespace-nowrap">
                <Link href={`/guardias/${r.shiftId}`} className="inline-flex min-h-11 items-center font-semibold text-brand-800 underline underline-offset-2">
                  Ver guardia
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
