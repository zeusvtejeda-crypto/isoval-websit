import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFacilityOptions } from "@/lib/data/catalogs";
import { loadShiftsWithAttendance } from "@/lib/attendance/load";
import { buildPresenceBoard } from "@/lib/presence/board";
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

export default async function EnServicioPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const supabase = await createClient();

  // Alcance: administración ve todas las sedes; coordinación y auditoría, solo las asignadas (RLS lo garantiza).
  const scope = user.isAdmin ? null : user.facilityIds;
  const facilities = await getFacilityOptions(supabase, scope);
  const facilityId = typeof sp.sede === "string" && facilities.some((f) => f.id === sp.sede) ? sp.sede : null;
  const timeZone = facilities.find((f) => f.id === facilityId)?.timezone ?? DEFAULT_TIMEZONE;

  const now = new Date();
  const today = todayInTz(timeZone, now);
  const day = isIsoDay(sp.fecha) ? sp.fecha : today;
  const period = parseShiftPeriod(sp.turno);

  // Se carga el día con un día de margen por lado: cubre todas las zonas horarias y guardias que cruzan medianoche.
  const range = dayRangeUtc(day, timeZone);
  const shifts = await loadShiftsWithAttendance(supabase, {
    from: new Date(range.start.getTime() - DAY),
    to: new Date(range.end.getTime() + DAY),
    facilityIds: facilityId ? [facilityId] : scope,
    now,
  });
  const board = buildPresenceBoard(shifts, now, { day, period, facilityId });
  const noScope = scope !== null && scope.length === 0;

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Quién está aquí"
        description={
          <>
            Personas con entrada registrada, pendientes de llegar y salidas del{" "}
            <span className="font-medium text-gray-800">{formatLongDate(range.start, timeZone)}</span>
            {period !== "todos" ? ` · ${SHIFT_PERIOD_LABELS[period]}` : ""}.
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
        <PresenceFilters facilities={facilities} facilityId={facilityId} day={day} period={period} />
      </Card>

      <BoardStats board={board} />

      <InServiceSection items={board.inService} day={day} />
      <ResponsiblesSection items={board.responsibles} day={day} />
      <ExpectedSection items={board.expected} />
      <LeftSection items={board.left} day={day} />
      <CoverageSection items={board.uncovered} />
      <IncompleteSection items={board.incomplete} day={day} />
    </div>
  );
}
