import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { METHOD_LABELS, SHIFT_STATUS_LABELS, SHIFT_STATUS_TONE, type Tone } from "@/lib/attendance/labels";
import { formatDateTime, formatDuration, formatShiftRange, formatTime, todayInTz } from "@/lib/time";
import {
  INCOMPLETE_REASON_LABELS,
  RESPONSIBLE_PRESENCE_LABELS,
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

export function BoardStats({ board }: { board: PresenceBoard }) {
  const late = board.expected.filter((e) => e.late).length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="En servicio" value={board.inService.length} />
      <Stat label="Pendientes de llegar" value={board.expected.length} hint={late ? `${late} con retraso` : "Sin retrasos"} />
      <Stat label="Ya salieron" value={board.left.length} />
      <Stat label="Sin cobertura suficiente" value={board.uncovered.length} hint="Guardias" />
      <Stat label="Registros incompletos" value={board.incomplete.length} hint="Pendientes de revisión" />
      <Stat label="Guardias en el filtro" value={board.shiftCount} />
    </div>
  );
}

export function InServiceSection({ items, day }: { items: InServiceEntry[]; day: string }) {
  return (
    <Section id="en-servicio" title="En servicio" count={items.length} empty="Nadie tiene una entrada abierta en las guardias de este filtro.">
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
                {i.workerName}
                {i.isResponsible ? (
                  <span className="mt-1 block">
                    <Badge tone="info">Responsable</Badge>
                  </span>
                ) : null}
              </Td>
              <Td>
                <Place facilityName={i.facilityName} meetingPoint={i.meetingPoint} assignedPoint={i.assignedPoint} />
              </Td>
              <Td className="whitespace-nowrap">{timeFor(i.checkInAt, i.timezone, day)}</Td>
              <Td className="whitespace-nowrap">{formatDuration(i.elapsedMinutes)}</Td>
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
              <Td className="font-medium">{r.responsibleName}</Td>
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
              <Td className="font-medium">{e.workerName}</Td>
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
    <Section id="salieron" title="Ya salieron" count={items.length} empty="Nadie ha registrado salida en las guardias de este filtro.">
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
              <Td className="font-medium">{l.workerName}</Td>
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

export function CoverageSection({ items }: { items: CoverageEntry[] }) {
  return (
    <Section
      id="cobertura"
      title="Guardias sin cobertura suficiente"
      description="En curso: menos personas en servicio que el mínimo. Por iniciar: menos personas asignadas que el mínimo."
      count={items.length}
      empty="Todas las guardias de este filtro tienen la cobertura mínima."
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
                  {c.effectiveStatus === "en_curso" ? `${c.inService} en servicio` : `${c.assigned} asignadas`} de {c.minStaff} mínimo
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

export function IncompleteSection({ items, day }: { items: IncompleteEntry[]; day: string }) {
  return (
    <Section
      id="incompletos"
      title="Registros incompletos pendientes de revisión"
      description="Entradas sin salida después del margen configurado o guardias terminadas sin registros. Coordinación decide si corresponde una corrección."
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
              <Td className="font-medium">{i.workerName}</Td>
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
