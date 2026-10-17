import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFacilityOptions, getSettingNumber } from "@/lib/data/catalogs";
import { loadShiftsWithAttendance } from "@/lib/attendance/load";
import { buildPresenceBoard } from "@/lib/presence/board";
import { facilitiesWithShifts, findFacility, mergeFacilityOptions } from "@/lib/presence/board-data";
import { isIsoDay, parseShiftPeriod, SHIFT_PERIOD_LABELS } from "@/lib/presence/periods";
import { PRESENCE_DISCLAIMER } from "@/lib/presence/texts";
import { DEFAULT_TIMEZONE, dayRangeUtc, formatLongDate, todayInTz } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { LastUpdated } from "@/components/layout/connection-status";
import { PresenceFilters } from "@/components/presence/presence-filters";
import {
  AbsenceSection,
  BoardNav,
  BoardStats,
  CoverageSection,
  ExpectedSection,
  IncompleteSection,
  InServiceSection,
  LeftSection,
  ResponsiblesSection,
} from "@/components/presence/board-sections";

export const metadata: Metadata = { title: "En servicio" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DAY = 86_400_000;
/** Días hacia atrás para listar registros incompletos en el tablero de hoy. */
const LOOKBACK_DAYS = 7;

export default async function EnServicioPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const supabase = await createClient();

  // Alcance: administración ve todas las sedes; coordinación y auditoría, solo las asignadas (RLS lo garantiza).
  const scope = user.isAdmin ? null : user.facilityIds;
  const noScope = scope !== null && scope.length === 0;
  const scopedOptions = scope ? await getFacilityOptions(supabase, scope) : null;
  const selected = scopedOptions ? (scopedOptions.find((f) => f.id === sp.sede) ?? null) : await findFacility(supabase, sp.sede);
  const facilityId = selected?.id ?? null;
  const timeZone = selected?.timezone ?? DEFAULT_TIMEZONE;

  const now = new Date();
  const today = todayInTz(timeZone, now);
  const day = isIsoDay(sp.fecha) ? sp.fecha : today;
  const period = parseShiftPeriod(sp.turno);
  // En el tablero de hoy también se listan entradas olvidadas de los últimos días.
  const isToday = day === today;
  const incompleteSince = isToday ? new Date(now.getTime() - LOOKBACK_DAYS * DAY) : null;

  // Se carga el día con un día de margen por lado: cubre todas las zonas horarias y guardias que cruzan medianoche.
  const range = dayRangeUtc(day, timeZone);
  const dayFrom = new Date(range.start.getTime() - DAY);
  const loadTo = new Date(range.end.getTime() + DAY);
  const loadFrom = incompleteSince && incompleteSince < dayFrom ? incompleteSince : dayFrom;
  const [shifts, shiftFacilities, graceMinutes] = await Promise.all([
    loadShiftsWithAttendance(supabase, { from: loadFrom, to: loadTo, facilityIds: facilityId ? [facilityId] : scope, now }),
    // Administración: solo sedes con guardias en la fecha (el directorio puede tener miles de instalaciones).
    scopedOptions ? Promise.resolve([]) : facilitiesWithShifts(supabase, dayFrom, loadTo),
    // Mismo margen que usan check_out y el cálculo de «registro incompleto».
    getSettingNumber(supabase, "attendance", "open_session_grace_minutes", 240),
  ]);
  const facilities = scopedOptions ?? mergeFacilityOptions(shiftFacilities, selected);
  const board = buildPresenceBoard(shifts, now, { day, period, facilityId, incompleteSince }, { graceMinutes });

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Quién está aquí"
        description={
          <>
            Quién tiene guardia, quién está en servicio, quién falta por llegar, quién ya salió y las ausencias del{" "}
            <span className="font-medium text-gray-800">{formatLongDate(range.start, timeZone)}</span>
            {period !== "todos" ? ` · ${SHIFT_PERIOD_LABELS[period]}` : ""}. Toca un nombre para ver su historial.
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LastUpdated at={now.toISOString()} timeZone={timeZone} />
        <p className="text-sm text-gray-600">Se actualiza cada 30 segundos.</p>
      </div>

      <Alert tone="info" title="Importante">
        {PRESENCE_DISCLAIMER}
      </Alert>

      {noScope ? (
        <Alert tone="warning" title="Sin sedes asignadas">
          Tu cuenta no tiene sedes asignadas. Pide a administración que te asigne las sedes que coordinas o consultas.
        </Alert>
      ) : null}

      <Card>
        <PresenceFilters
          facilities={facilities}
          facilityId={facilityId}
          day={day}
          period={period}
          facilityHint={scopedOptions ? "Solo tus sedes asignadas." : "Sedes con guardias alrededor de la fecha elegida."}
          isAdmin={user.isAdmin}
        />
      </Card>

      <BoardStats board={board} />
      <BoardNav board={board} />

      <InServiceSection items={board.inService} day={day} />
      <ResponsiblesSection items={board.responsibles} day={day} />
      <ExpectedSection items={board.expected} />
      <LeftSection items={board.left} day={day} />
      <AbsenceSection items={board.absences} />
      <CoverageSection items={board.uncovered} />
      <IncompleteSection items={board.incomplete} day={day} lookbackDays={isToday ? LOOKBACK_DAYS : null} />
    </div>
  );
}
