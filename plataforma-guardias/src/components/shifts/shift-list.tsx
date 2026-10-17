import Link from "next/link";
import { Table, Td, Th } from "@/components/ui/table";
import type { ShiftWithAttendance } from "@/lib/attendance/load";
import { formatShiftRange } from "@/lib/time";
import { formatDayLong } from "@/lib/shifts/dates";
import { groupByStartDay } from "@/lib/shifts/filters";
import { shiftDisplayTitle, staffingSummary } from "@/lib/shifts/format";
import { ShiftStatusBadges } from "./shift-badges";

function ShiftCard({ item }: { item: ShiftWithAttendance }) {
  const { shift, facility, responsible, coverage } = item;
  const tz = facility?.timezone;
  const hasTitle = Boolean(shift.title?.trim());
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link href={`/guardias/${shift.id}`} className="inline-flex min-h-11 items-center text-lg font-semibold text-brand-900 underline-offset-2 hover:underline">
          {shiftDisplayTitle(shift)}
        </Link>
        <ShiftStatusBadges effectiveStatus={item.effectiveStatus} storedStatus={shift.status} insufficient={coverage.insufficient} />
      </div>
      <dl className="mt-2 grid gap-1 text-sm text-gray-700">
        {hasTitle ? (
          <div>
            <dt className="inline font-medium text-gray-900">Punto: </dt>
            <dd className="inline">{shift.meeting_point}</dd>
          </div>
        ) : null}
        <div>
          <dt className="inline font-medium text-gray-900">Sede: </dt>
          <dd className="inline">{facility?.official_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-900">Horario: </dt>
          <dd className="inline">{formatShiftRange(shift.starts_at, shift.ends_at, tz)}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-900">Responsable: </dt>
          <dd className="inline">{responsible?.full_name ?? "Sin responsable"}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-900">Cobertura: </dt>
          <dd className="inline">
            {staffingSummary(coverage)} · En servicio: {coverage.inService}
          </dd>
        </div>
      </dl>
    </li>
  );
}

/** Vista de lista agrupada por día de inicio (tarjetas en móvil, tabla en escritorio). */
export function ShiftList({ items, days, fallbackTz }: { items: ShiftWithAttendance[]; days: string[]; fallbackTz: string }) {
  const groups = groupByStartDay(items, days, fallbackTz);
  return (
    <div className="space-y-6">
      {days.map((day) => {
        const list = groups.get(day) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={day} aria-labelledby={`dia-${day}`}>
            <h2 id={`dia-${day}`} className="mb-2 text-lg font-semibold capitalize text-gray-900">
              {formatDayLong(day)} <span className="text-sm font-normal normal-case text-gray-600">({list.length} {list.length === 1 ? "guardia" : "guardias"})</span>
            </h2>
            <ul className="space-y-3 md:hidden">
              {list.map((item) => (
                <ShiftCard key={item.shift.id} item={item} />
              ))}
            </ul>
            <Table caption={`Guardias del ${formatDayLong(day)}`} className="hidden md:block">
              <thead>
                <tr>
                  <Th>Guardia</Th>
                  <Th>Sede</Th>
                  <Th>Horario</Th>
                  <Th>Responsable</Th>
                  <Th>Asignados</Th>
                  <Th>En servicio</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map((item) => (
                  <tr key={item.shift.id}>
                    <Td>
                      <Link href={`/guardias/${item.shift.id}`} className="font-semibold text-brand-900 underline-offset-2 hover:underline">
                        {shiftDisplayTitle(item.shift)}
                      </Link>
                      {item.shift.title?.trim() ? <p className="text-gray-600">{item.shift.meeting_point}</p> : null}
                    </Td>
                    <Td>{item.facility?.official_name ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{formatShiftRange(item.shift.starts_at, item.shift.ends_at, item.facility?.timezone)}</Td>
                    <Td>{item.responsible?.full_name ?? "Sin responsable"}</Td>
                    <Td>{staffingSummary(item.coverage)}</Td>
                    <Td>{item.coverage.inService}</Td>
                    <Td>
                      <ShiftStatusBadges effectiveStatus={item.effectiveStatus} storedStatus={item.shift.status} insufficient={item.coverage.insufficient} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        );
      })}
    </div>
  );
}
