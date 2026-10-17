import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadMyShifts } from "@/lib/presence/my-shifts";
import { featuredTimingText, openElsewhere, openElsewhereText, pickFeatured, recentViews, upcomingViews } from "@/lib/presence/worker";
import { NOT_LINKED_MESSAGE } from "@/lib/presence/texts";
import { DEFAULT_TIMEZONE, formatDateTime, formatShiftRange } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { AttendanceButtons } from "@/components/attendance/attendance-buttons";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { LastUpdated } from "@/components/layout/connection-status";
import { buttonsPropsFor, MyShiftDetails, MyShiftListItem } from "@/components/attendance/my-shift";

export const metadata: Metadata = { title: "Mi guardia" };

export default async function MiGuardiaPage() {
  const user = await requireUser();

  if (!user.workerId) {
    return (
      <>
        <PageHeader title="Mi guardia" />
        <Alert tone="warning" title="Cuenta sin vincular">
          {NOT_LINKED_MESSAGE}
        </Alert>
      </>
    );
  }

  const supabase = await createClient();
  const { views, loadedAt } = await loadMyShifts(supabase, user.workerId);
  const featured = pickFeatured(views);
  const featuredId = featured?.row.assignment_id ?? null;
  const elsewhere = openElsewhere(views, featuredId);
  const hidden = new Set([featuredId, elsewhere?.row.assignment_id ?? null]);
  const upcoming = upcomingViews(views, featuredId).filter((v) => !hidden.has(v.row.assignment_id));
  const recent = recentViews(views, featuredId).filter((v) => !hidden.has(v.row.assignment_id));

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Mi guardia"
        description="Tu guardia de hoy, tus registros de entrada y salida y tus próximas asignaciones."
        actions={
          <LinkButton href="/mi-historial" variant="outline">
            Ver mi historial
          </LinkButton>
        }
      />

      <LastUpdated at={loadedAt.toISOString()} timeZone={featured?.row.facility_timezone ?? DEFAULT_TIMEZONE} />

      {/* Posición fija: el resultado del último envío se conserva tras actualizar la página. */}
      <div className={elsewhere ? "space-y-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4" : "empty:hidden"}>
        {elsewhere?.openSession ? (
          <div className="text-amber-950" role="status">
            <p className="text-lg font-bold">Tienes una entrada abierta en otra guardia</p>
            <p className="mt-1">
              {elsewhere.row.facility_name} · {elsewhere.row.meeting_point}.{" "}
              {formatShiftRange(elsewhere.row.starts_at, elsewhere.row.ends_at, elsewhere.row.facility_timezone)}. Entrada:{" "}
              {formatDateTime(elsewhere.openSession.check_in_at, elsewhere.row.facility_timezone)} (hora de la sede).
            </p>
            <p className="mt-1 text-sm">{openElsewhereText(elsewhere)}</p>
          </div>
        ) : null}
        <AttendanceButtons {...buttonsPropsFor(elsewhere)} showCheckIn={false} />
      </div>

      <Card>
        <CardHeader title="Mi guardia de hoy" description={featured ? featuredTimingText(featured) : undefined} />
        {featured ? (
          <MyShiftDetails view={featured} />
        ) : (
          <EmptyState
            title="No tienes guardias en curso ni próximas"
            description="Cuando coordinación te asigne una guardia aparecerá aquí (se muestran los próximos 14 días)."
          />
        )}
        <AttendanceButtons {...buttonsPropsFor(featured)} className="mt-4" />
      </Card>

      <Card>
        <CardHeader title="Próximas asignaciones" description="Próximos 14 días. Horarios en la zona de cada sede." />
        {upcoming.length ? (
          <ul className="divide-y divide-gray-100">
            {upcoming.map((v) => (
              <MyShiftListItem key={v.row.assignment_id} view={v} />
            ))}
          </ul>
        ) : (
          <p className="text-gray-600">No tienes otras asignaciones próximas.</p>
        )}
      </Card>

      {recent.length ? (
        <Card>
          <CardHeader
            title="Guardias recientes"
            description="Terminadas en las últimas 24 horas. Si algún registro es incorrecto, solicita una corrección en tu historial."
          />
          <ul className="divide-y divide-gray-100">
            {recent.map((v) => (
              <MyShiftListItem key={v.row.assignment_id} view={v} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
