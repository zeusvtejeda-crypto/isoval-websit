import Link from "next/link";
import type { ShiftWithAttendance } from "@/lib/attendance/load";
import { cn } from "@/lib/cn";
import { formatDayShort } from "@/lib/shifts/dates";
import { groupByStartDay } from "@/lib/shifts/filters";
import { formatTimeRangeCompact, shiftDisplayTitle } from "@/lib/shifts/format";
import { ShiftStatusBadges } from "./shift-badges";

/**
 * Calendario semanal: en móvil, lista por día; en escritorio, rejilla de 7 días.
 * Una guardia que cruza medianoche aparece en su día de inicio con «+1 día».
 */
export function ShiftCalendar({
  items,
  days,
  today,
  fallbackTz,
  showFacility,
  newShiftHref,
}: {
  items: ShiftWithAttendance[];
  days: string[];
  today: string;
  fallbackTz: string;
  showFacility: boolean;
  /** Si se indica, cada día ofrece «Programar» (solo gestión). */
  newShiftHref?: (day: string) => string;
}) {
  const groups = groupByStartDay(items, days, fallbackTz);
  return (
    <ol className="grid gap-3 lg:grid-cols-7 lg:gap-2">
      {days.map((day) => {
        const list = groups.get(day) ?? [];
        const isToday = day === today;
        return (
          <li
            key={day}
            aria-labelledby={`cal-${day}`}
            className={cn("flex min-w-0 flex-col rounded-xl border bg-white p-3 lg:min-h-48 lg:p-2", isToday ? "border-brand-800 ring-1 ring-brand-800" : "border-gray-200")}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 id={`cal-${day}`} className="font-semibold capitalize text-gray-900">
                {formatDayShort(day)}
                {isToday ? <span className="ml-2 rounded-full bg-brand-800 px-2 py-0.5 text-xs font-semibold normal-case text-white">Hoy</span> : null}
              </h2>
              {newShiftHref ? (
                <Link
                  href={newShiftHref(day)}
                  className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                  aria-label={`Programar guardia el ${formatDayShort(day)}`}
                >
                  + Programar
                </Link>
              ) : null}
            </div>
            {list.length === 0 ? (
              <p className="text-sm text-gray-500">Sin guardias</p>
            ) : (
              <ul className="space-y-2">
                {list.map((item) => (
                  <li key={item.shift.id}>
                    <Link
                      href={`/guardias/${item.shift.id}`}
                      className="block min-h-11 rounded-lg border border-gray-200 bg-gray-50 p-2 hover:border-brand-700 hover:bg-brand-50"
                    >
                      <span className="block text-sm font-semibold text-gray-900">
                        {formatTimeRangeCompact(item.shift.starts_at, item.shift.ends_at, item.facility?.timezone ?? fallbackTz)}
                      </span>
                      <span className="block break-words text-sm text-brand-900">{shiftDisplayTitle(item.shift)}</span>
                      {showFacility ? <span className="block break-words text-xs text-gray-600">{item.facility?.official_name ?? "—"}</span> : null}
                      <span className="block break-words text-xs text-gray-600">Responsable: {item.responsible?.full_name ?? "Sin responsable"}</span>
                      <span className="mt-1 block text-xs text-gray-700">
                        Asignados {item.coverage.assigned}/{item.coverage.minStaff}
                        {item.coverage.maxStaff != null ? ` (máx. ${item.coverage.maxStaff})` : ""} · En servicio {item.coverage.inService}
                      </span>
                      <span className="mt-1 block">
                        <ShiftStatusBadges effectiveStatus={item.effectiveStatus} storedStatus={item.shift.status} insufficient={item.coverage.insufficient} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
