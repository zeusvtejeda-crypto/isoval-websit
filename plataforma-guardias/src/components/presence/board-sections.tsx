import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { ATTENDANCE_STATUS_TONE, METHOD_LABELS, SHIFT_STATUS_LABELS, SHIFT_STATUS_TONE, type Tone } from "@/lib/attendance/labels";
import { EXTRA_TIME_NOTE } from "@/lib/presence/texts";
import { coverageCurrent } from "@/lib/attendance/coverage";
import { formatDateTime, formatDuration, formatShiftRange, formatTime, todayInTz } from "@/lib/time";
import {
  ABSENCE_STATUS_LABELS,
  INCOMPLETE_REASON_LABELS,
  RESPONSIBLE_PRESENCE_LABELS,
  incidentLabels,
  workerHistoryHref,
  type AbsenceEntry,
  type CoverageEntry,
  type ExpectedEntry,
  type IncompleteEntry,
  type InServiceEntry,
  type LeftEntry,
  type PresenceBoard,
  type ResponsibleEntry,
  type ResponsiblePresence,
} from "@/lib/presence/board";

/** Hora local; si el registro cae en otro día que el filtrado, muestra fecha y hora. */
function timeFor(iso: string, tz: string, day: string): string {
  return todayInTz(tz, new Date(iso)) === day ? formatTime(iso, tz) : formatDateTime(iso, tz);
}

function Section({
  id,
  title,
  description,
  count,
  empty,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div id={id}>
        <CardHeader title={`${title} (${count})`} description={description} />
        {count === 0 ? <p className="rounded-xl bg-gray-50 px-3 py-4 text-gray-600">{empty}</p> : children}
      </div>
    </Card>
  );
}

/** Nombre que enlaza al historial individual (si se conoce el trabajador). */
function PersonName({ workerId, name }: { workerId: string | null; name: string }) {
  if (!workerId) return <span>{name}</span>;
  return (
    <Link
      href={workerHistoryHref(workerId)}
      className="inline-flex min-h-11 items-center text-brand-900 underline underline-offset-2 hover:text-brand-700"
      title={`Ver historial de ${name}`}
    >
      {name}
    </Link>
  );
}

/** Etiquetas de incidencias (siempre con texto). */
function IncidentBadges({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1" aria-label="Incidencias">
      {labels.map((label) => (
        <li key={label}>
          <Badge tone={label.startsWith("Cubre a ") ? "info" : "warning"}>{label}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Place({ facilityName, meetingPoint, assignedPoint }: { facilityName: string; meetingPoint: string; assignedPoint?: string | null }) {
  return (
    <>
      <span className="block">{facilityName}</span>
      <span className="block text-xs text-gray-600">
        {assignedPoint ? `Punto: ${assignedPoint}` : `Reunión: ${meetingPoint}`}
      </span>
    </>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function BoardStats({ board }: { board: PresenceBoard }) {
  const late = board.expected.filter((e) => e.late).length;
  const c = board.incidentCounts;
  const withIncidents = [...board.inService, ...board.left].filter((e) => e.lateMinutes != null || e.earlyLeaveMinutes != null || e.afterEndMinutes > 0).length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Stat
        label="Personas con guardia"
        value={board.rosterCount}
        hint={`En ${plural(board.shiftCount, "guardia", "guardias")}${c.substitutions ? ` · ${plural(c.substitutions, "cubre", "cubren")} a otra persona` : ""}`}
      />
      <Stat label="En servicio" value={board.inService.length} hint="Entrada registrada sin salida" />
      <Stat label="Pendientes de llegar" value={board.expected.length} hint={late ? `${late} con retraso` : "Sin retrasos"} />
      <Stat label="Ya salieron" value={board.left.length} />
      <Stat label="Ausencias e inasistencias" value={board.absences.length} hint="Registradas por coordinación" />
      <Stat
        label="Con incidencias de horario"
        value={withIncidents}
        hint={`${plural(c.late, "llegada tardía", "llegadas tardías")} · ${plural(c.earlyLeave, "salida anticipada", "salidas anticipadas")} · ${c.afterEnd} con permanencia adicional`}
      />
      <Stat label="Sin cobertura suficiente" value={board.uncovered.length} hint="Guardias" />
      <Stat label="Registros incompletos" value={board.incomplete.length} hint="Pendientes de revisión" />
      <Stat label="Guardias en el filtro" value={board.shiftCount} />
    </div>
  );
}

/** Índice de secciones del tablero (enlaces internos). */
export function BoardNav({ board }: { board: PresenceBoard }) {
  const links: Array<[string, string, number]> = [
    ["#en-servicio", "En servicio", board.inService.length],
    ["#responsables", "Responsables", board.responsibles.length],
    ["#esperados", "Pendientes de llegar", board.expected.length],
    ["#salieron", "Ya salieron", board.left.length],
    ["#ausencias", "Ausencias e inasistencias", board.absences.length],
    ["#cobertura", "Sin cobertura", board.uncovered.length],
    ["#incompletos", "Registros incompletos", board.incomplete.length],
  ];
  return (
    <nav aria-label="Secciones del tablero">
      <ul className="flex flex-wrap gap-2">
        {links.map(([href, label, n]) => (
          <li key={href}>
            <a
              href={href}
              className="inline-flex min-h-11 items-center rounded-full border border-gray-200 bg-white px-3 text-sm text-gray-800 hover:border-brand-700 hover:bg-brand-50"
            >
              {label} ({n})
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function InServiceSection({ items, day }: { items: InServiceEntry[]; day: string }) {
  return (
    <Section
      id="en-servicio"
      title="En servicio"
      description={`Quién registró llegada y continúa en servicio. Las incidencias son señales para revisión, no sanciones. ${EXTRA_TIME_NOTE}`}
      count={items.length}
      empty="Nadie tiene una entrada abierta en las guardias de este filtro."
    >
      <Table caption="Personas con entrada registrada y sin salida">
        <thead>
          <tr>
            <Th>Nombre</Th>
            <Th>Sede y punto</Th>
            <Th>Entrada</Th>
            <Th>Tiempo transcurrido</Th>
            <Th>Registro</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((i) => (
            <tr key={i.assignmentId}>
              <Td className="font-medium">
                <PersonName workerId={i.workerId} name={i.workerName} />
                {i.isResponsible ? (
                  <span className="mt-1 block">
                    <Badge tone="info">Responsable</Badge>
                  </span>
                ) : null}
                <IncidentBadges labels={incidentLabels(i)} />
              </Td>
              <Td>
                <Place facilityName={i.facilityName} meetingPoint={i.meetingPoint} assignedPoint={i.assignedPoint} />
              </Td>
              <Td className="whitespace-nowrap">{timeFor(i.checkInAt, i.timezone, day)}</Td>
              <Td>
                <span className="whitespace-nowrap">{formatDuration(i.elapsedMinutes)}</span>
                {i.shiftEnded ? (
                  <span className="mt-1 block">
                    <Badge tone="warning">Su guardia ya terminó ({timeFor(i.endsAt, i.timezone, day)})</Badge>
                    <span className="mt-1 block text-xs text-gray-600">
                      {i.checkOutDeadline
                        ? `La salida con la hora actual se puede registrar hasta las ${timeFor(i.checkOutDeadline, i.timezone, day)}; después requiere «Corregir registro» con la hora real.`
                        : "La salida con la hora actual solo se acepta dentro del margen configurado; después requiere «Corregir registro» con la hora real."}{" "}
                      El tiempo después del término se cuenta al registrar la salida.
                    </span>
                  </span>
                ) : null}
              </Td>
              <Td>{i.registeredByStaff ? <Badge tone="neutral">{METHOD_LABELS[i.method]}</Badge> : <span className="text-gray-600">Registro propio</span>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

const PRESENCE_TONE: Record<ResponsiblePresence, Tone> = {
  en_servicio: "success",
  sin_entrada: "warning",
  ya_salio: "info",
  ausente: "muted",
  sin_asignacion: "muted",
};

export function ResponsiblesSection({ items, day }: { items: ResponsibleEntry[]; day: string }) {
  return (
    <Section id="responsables" title="Responsables de guardia" count={items.length} empty="Las guardias de este filtro no tienen responsable asignado.">
      <Table caption="Responsables de cada guardia y si están en servicio">
        <thead>
          <tr>
            <Th>Guardia</Th>
            <Th>Horario</Th>
            <Th>Responsable</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((r) => (
            <tr key={r.shiftId}>
              <Td>
                <Place facilityName={r.facilityName} meetingPoint={r.meetingPoint} />
              </Td>
              <Td className="whitespace-nowrap">{formatShiftRange(r.startsAt, r.endsAt, r.timezone)}</Td>
              <Td className="font-medium">
                <PersonName workerId={r.responsibleId} name={r.responsibleName} />
              </Td>
              <Td>
                <Badge tone={PRESENCE_TONE[r.presence]}>{RESPONSIBLE_PRESENCE_LABELS[r.presence]}</Badge>
                {r.checkInAt ? <span className="mt-1 block text-xs text-gray-600">Entrada: {timeFor(r.checkInAt, r.timezone, day)}</span> : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

export function ExpectedSection({ items }: { items: ExpectedEntry[] }) {
  return (
    <Section
      id="esperados"
      title="Esperados y pendientes de llegar"
      description="Asignados sin entrada registrada en guardias en curso o de este día. «Retraso» = ya pasó el inicio más la tolerancia de la sede (señal para revisión, no una sanción)."
      count={items.length}
      empty="No hay personas pendientes de llegar."
    >
      <Table caption="Personas asignadas sin entrada registrada">
        <thead>
          <tr>
            <Th>Nombre</Th>
            <Th>Sede y punto</Th>
            <Th>Horario</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((e) => (
            <tr key={e.assignmentId}>
              <Td className="font-medium">
                <PersonName workerId={e.workerId} name={e.workerName} />
                <IncidentBadges labels={incidentLabels({ substituteFor: e.substituteFor })} />
              </Td>
              <Td>
                <Place facilityName={e.facilityName} meetingPoint={e.meetingPoint} assignedPoint={e.assignedPoint} />
              </Td>
              <Td className="whitespace-nowrap">{formatShiftRange(e.startsAt, e.endsAt, e.timezone)}</Td>
              <Td>
                {e.late ? (
                  <>
                    <Badge tone="warning">Retraso</Badge>
                    <span className="mt-1 block text-xs text-gray-600">
                      {formatDuration(e.minutesSinceStart)} desde el inicio (tolerancia {e.toleranceMinutes} min)
                    </span>
                  </>
                ) : e.shiftInProgress ? (
                  <Badge tone="neutral">Pendiente de llegar (dentro de la tolerancia)</Badge>
                ) : (
                  <Badge tone="muted">Guardia por iniciar</Badge>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

export function LeftSection({ items, day }: { items: LeftEntry[]; day: string }) {
  return (
    <Section
      id="salieron"
      title="Ya salieron"
      description="Quién se retiró, con llegada tardía, salida anticipada o permanencia adicional cuando las hay (señales para revisión)."
      count={items.length}
      empty="Nadie ha registrado salida en las guardias de este filtro."
    >
      <Table caption="Personas que registraron salida">
        <thead>
          <tr>
            <Th>Nombre</Th>
            <Th>Sede y punto</Th>
            <Th>Salida</Th>
            <Th>Total registrado</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((l) => (
            <tr key={l.assignmentId}>
              <Td className="font-medium">
                <PersonName workerId={l.workerId} name={l.workerName} />
                <IncidentBadges labels={incidentLabels(l)} />
              </Td>
              <Td>
                <Place facilityName={l.facilityName} meetingPoint={l.meetingPoint} assignedPoint={l.assignedPoint} />
              </Td>
              <Td className="whitespace-nowrap">
                {timeFor(l.checkOutAt, l.timezone, day)}
                {l.method && l.method !== "propio" ? <span className="block text-xs text-gray-600">{METHOD_LABELS[l.method]}</span> : null}
              </Td>
              <Td className="whitespace-nowrap">{formatDuration(l.totalMinutes)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

export function AbsenceSection({ items }: { items: AbsenceEntry[] }) {
  return (
    <Section
      id="ausencias"
      title="Ausencias justificadas e inasistencias"
      description="Personas con guardia en este filtro cuya asignación coordinación marcó como ausencia justificada o inasistencia confirmada tras revisión."
      count={items.length}
      empty="No hay ausencias ni inasistencias registradas en las guardias de este filtro."
    >
      <Table caption="Asignaciones con ausencia justificada o inasistencia confirmada">
        <thead>
          <tr>
            <Th>Nombre</Th>
            <Th>Sede y punto</Th>
            <Th>Horario</Th>
            <Th>Estado y motivo</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((a) => (
            <tr key={a.assignmentId}>
              <Td className="font-medium">
                <PersonName workerId={a.workerId} name={a.workerName} />
                <IncidentBadges labels={incidentLabels({ substituteFor: a.substituteFor })} />
              </Td>
              <Td>
                <Place facilityName={a.facilityName} meetingPoint={a.meetingPoint} assignedPoint={a.assignedPoint} />
              </Td>
              <Td className="whitespace-nowrap">{formatShiftRange(a.startsAt, a.endsAt, a.timezone)}</Td>
              <Td>
                <Badge tone={ATTENDANCE_STATUS_TONE[a.status]}>{ABSENCE_STATUS_LABELS[a.status]}</Badge>
                <span className="mt-1 block text-sm text-gray-700">Motivo: {a.reason ?? "Sin motivo registrado"}</span>
                {a.changedAt ? <span className="block text-xs text-gray-600">Registrado: {formatDateTime(a.changedAt, a.timezone)}</span> : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

export function CoverageSection({ items }: { items: CoverageEntry[] }) {
  return (
    <Section
      id="cobertura"
      title="Guardias sin cobertura suficiente"
      description="En curso: menos personas en servicio que el mínimo. Por iniciar: menos personas asignadas que el mínimo. Finalizada: menos personas con registro que el mínimo."
      count={items.length}
      empty="Ninguna guardia de este filtro quedó por debajo del mínimo (en servicio, con registro o asignadas, según su estado)."
    >
      <Table caption="Guardias con cobertura menor al mínimo">
        <thead>
          <tr>
            <Th>Guardia</Th>
            <Th>Horario</Th>
            <Th>Estado</Th>
            <Th>Cobertura</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((c) => (
            <tr key={c.shiftId}>
              <Td>
                <span className="block font-medium">{c.shiftTitle || c.meetingPoint}</span>
                <span className="block text-xs text-gray-600">{c.facilityName}</span>
              </Td>
              <Td className="whitespace-nowrap">{formatShiftRange(c.startsAt, c.endsAt, c.timezone)}</Td>
              <Td>
                <Badge tone={SHIFT_STATUS_TONE[c.effectiveStatus]}>{SHIFT_STATUS_LABELS[c.effectiveStatus]}</Badge>
              </Td>
              <Td>
                <span className="block">
                  {coverageCurrent(c.effectiveStatus, c).count} {coverageCurrent(c.effectiveStatus, c).label} de {c.minStaff} mínimo
                </span>
                <Badge tone="warning">Faltan {c.missing}</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

export function IncompleteSection({ items, day, lookbackDays }: { items: IncompleteEntry[]; day: string; lookbackDays?: number | null }) {
  const scope = lookbackDays
    ? `De las guardias de este día y de las que terminaron en los últimos ${lookbackDays} días.`
    : "De las guardias de este día.";
  return (
    <Section
      id="incompletos"
      title="Registros incompletos pendientes de revisión"
      description={`Entradas sin salida después del margen configurado o guardias terminadas sin registros. ${scope} Coordinación decide si corresponde una corrección. Una entrada sin salida ya no admite registrar la salida con la hora actual: se usa «Corregir registro» con la hora real o una solicitud de corrección. Nadie (salvo administración) corrige su propia asistencia.`}
      count={items.length}
      empty="No hay registros incompletos en este filtro."
    >
      <Table caption="Registros pendientes de revisión">
        <thead>
          <tr>
            <Th>Nombre</Th>
            <Th>Sede y punto</Th>
            <Th>Horario</Th>
            <Th>Motivo</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((i) => (
            <tr key={i.assignmentId}>
              <Td className="font-medium">
                <PersonName workerId={i.workerId} name={i.workerName} />
                <IncidentBadges labels={incidentLabels({ substituteFor: i.substituteFor })} />
              </Td>
              <Td>
                <Place facilityName={i.facilityName} meetingPoint={i.meetingPoint} assignedPoint={i.assignedPoint} />
              </Td>
              <Td className="whitespace-nowrap">{formatShiftRange(i.startsAt, i.endsAt, i.timezone)}</Td>
              <Td>
                <Badge tone="warning">{INCOMPLETE_REASON_LABELS[i.reason]}</Badge>
                {i.checkInAt ? <span className="mt-1 block text-xs text-gray-600">Entrada: {timeFor(i.checkInAt, i.timezone, day)}</span> : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}
