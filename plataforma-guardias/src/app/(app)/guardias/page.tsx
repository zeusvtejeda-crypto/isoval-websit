import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadShiftsWithAttendance } from "@/lib/attendance/load";
import { DEFAULT_TIMEZONE, dayRangeUtc, todayInTz } from "@/lib/time";
import { addDays, daysInRange, formatRangeLabel, weekDays } from "@/lib/shifts/dates";
import {
  applyShiftFilters,
  currentWeek,
  firstParam,
  guardiasHref,
  includeCancelledFor,
  parseShiftFilters,
  shiftRangeByWeeks,
  type RawSearchParams,
} from "@/lib/shifts/filters";
import { getVisibleFacilities } from "@/lib/shifts/queries";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton, buttonClasses } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { LastUpdated } from "@/components/layout/connection-status";
import { ShiftFilters } from "@/components/shifts/shift-filters";
import { ShiftList } from "@/components/shifts/shift-list";
import { ShiftCalendar } from "@/components/shifts/shift-calendar";
import { cn } from "@/lib/cn";

export const metadata = { title: "Guardias" };

export default async function GuardiasPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireStaff();
  const supabase = await createClient();
  const facilities = await getVisibleFacilities(supabase, user);
  const sp = await searchParams;

  const now = new Date();
  const selected = facilities.find((f) => f.id === firstParam(sp.sede));
  const zones = new Set(facilities.map((f) => f.timezone));
  const tz = selected?.timezone ?? (zones.size === 1 ? facilities[0].timezone : DEFAULT_TIMEZONE);
  const today = todayInTz(tz, now);
  const filters = parseShiftFilters(sp, today, facilities.map((f) => f.id));
  const facility = facilities.find((f) => f.id === filters.facilityId) ?? null;
  const fallbackTz = facility?.timezone ?? tz;

  const facilityIds = filters.facilityId ? [filters.facilityId] : user.isAdmin ? null : user.facilityIds;
  // Se amplía un día por lado para cubrir sedes con otra zona horaria; luego se
  // filtra por el día local de inicio de cada guardia.
  const from = dayRangeUtc(addDays(filters.from, -1), fallbackTz).start;
  const to = dayRangeUtc(addDays(filters.to, 1), fallbackTz).end;
  const loaded = await loadShiftsWithAttendance(supabase, {
    from,
    to,
    facilityIds,
    includeCancelled: includeCancelledFor(filters.status),
    now,
  });
  const items = applyShiftFilters(loaded, filters, fallbackTz);
  const insufficientCount = items.filter((i) => i.coverage.insufficient).length;
  const isCalendar = filters.view === "calendario";
  const days = isCalendar ? weekDays(filters.from) : daysInRange(filters.from, filters.to);
  const prev = shiftRangeByWeeks(filters, -1);
  const next = shiftRangeByWeeks(filters, 1);
  const thisWeek = currentWeek(today);
  const canCreate = user.canManage;

  return (
    <>
      <PageHeader
        title="Guardias"
        description="Programación de guardias, cobertura y asistencia registrada."
        actions={
          canCreate ? (
            <LinkButton href={filters.facilityId ? `/guardias/nueva?sede=${filters.facilityId}` : "/guardias/nueva"}>Nueva guardia</LinkButton>
          ) : null
        }
      />

      <div className="space-y-4">
        <nav aria-label="Tipo de vista" className="flex flex-wrap gap-2">
          <Link
            href={guardiasHref(filters, { view: "lista" })}
            aria-current={!isCalendar ? "page" : undefined}
            className={buttonClasses(!isCalendar ? "primary" : "outline")}
          >
            Lista
          </Link>
          <Link
            href={guardiasHref(filters, { view: "calendario" })}
            aria-current={isCalendar ? "page" : undefined}
            className={buttonClasses(isCalendar ? "primary" : "outline")}
          >
            Calendario semanal
          </Link>
        </nav>

        <ShiftFilters filters={filters} facilities={facilities} />

        {filters.notices.map((n) => (
          <Alert key={n} tone="warning">
            {n}
          </Alert>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-gray-900">{formatRangeLabel(filters.from, filters.to)}</p>
            <p className="text-sm text-gray-700" aria-live="polite">
              {items.length} {items.length === 1 ? "guardia" : "guardias"}
              {insufficientCount > 0 ? ` · ${insufficientCount} con cobertura insuficiente` : ""}
            </p>
            <LastUpdated at={now.toISOString()} timeZone={fallbackTz} />
          </div>
          <nav aria-label="Navegación por semana" className="flex flex-wrap gap-2">
            <Link href={guardiasHref(filters, prev)} className={buttonClasses("outline")}>
              Semana anterior
            </Link>
            <Link
              href={guardiasHref(filters, thisWeek)}
              className={cn(buttonClasses("ghost"), filters.from === thisWeek.from && filters.to === thisWeek.to && "underline")}
            >
              Esta semana
            </Link>
            <Link href={guardiasHref(filters, next)} className={buttonClasses("outline")}>
              Semana siguiente
            </Link>
          </nav>
        </div>

        {facilities.length === 0 && !user.isAdmin ? (
          <EmptyState title="Sin sedes asignadas" description="Tu cuenta no tiene sedes asignadas. Pide a administración que te asigne una sede." />
        ) : isCalendar ? (
          <>
            <ShiftCalendar
              items={items}
              days={days}
              today={today}
              fallbackTz={fallbackTz}
              showFacility={!filters.facilityId}
              newShiftHref={canCreate ? (day) => `/guardias/nueva?fecha=${day}${filters.facilityId ? `&sede=${filters.facilityId}` : ""}` : undefined}
            />
            {items.length === 0 ? (
              <p className="text-center text-sm text-gray-600">No hay guardias que coincidan con los filtros en esta semana.</p>
            ) : null}
          </>
        ) : items.length === 0 ? (
          <EmptyState
            title="No hay guardias con estos filtros"
            description="Prueba con otra semana, otra sede u otro estado."
            action={canCreate ? <LinkButton href="/guardias/nueva">Nueva guardia</LinkButton> : undefined}
          />
        ) : (
          <ShiftList items={items} days={days} fallbackTz={fallbackTz} />
        )}

        <p className="text-sm text-gray-600">
          Entrada registrada no equivale a presencia física verificada. «En servicio» indica entradas registradas sin salida.
        </p>
      </div>
    </>
  );
}
