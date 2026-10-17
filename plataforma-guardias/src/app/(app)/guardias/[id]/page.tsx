import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageFacility, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadShiftsWithAttendance } from "@/lib/attendance/load";
import { coverageCurrent } from "@/lib/attendance/coverage";
import { getSettingNumber } from "@/lib/data/catalogs";
import { formatOffset, formatShiftRange } from "@/lib/time";
import { collectActorIds } from "@/lib/shifts/actors";
import { hasStarted } from "@/lib/shifts/dates";
import { isGuid } from "@/lib/shifts/filters";
import { shiftDisplayTitle, staffingSummary, timezoneLabel } from "@/lib/shifts/format";
import {
  getActiveWorkersOfFacility,
  getIncidentNotes,
  getOtherActiveWorkers,
  getPendingCorrections,
  getProfileNames,
  getShiftContext,
  getWorkerProfileIds,
  newRequestId,
} from "@/lib/shifts/queries";
import type { WorkerOption } from "@/lib/shifts/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/states";
import { buttonClasses } from "@/components/ui/button";
import { LastUpdated } from "@/components/layout/connection-status";
import { AssignmentCard, EXTRA_STAY_NOTICE, PRESENCE_NOTICE, type AssignmentActions } from "@/components/shifts/assignment-card";
import { AddAssignmentForm } from "@/components/shifts/assignment-forms";
import { Disclosure } from "@/components/shifts/disclosure";
import { RefreshButton } from "@/components/shifts/refresh-button";
import { ShiftStatusBadges } from "@/components/shifts/shift-badges";
import { ShiftStatusActions } from "@/components/shifts/shift-status-actions";
import { setShiftStatus } from "../actions";
import {
  addAssignment,
  addManualSession,
  changeAssignmentStatus,
  correctSession,
  removeAssignment,
  saveIncidentNote,
  voidSession,
} from "./actions";

export const metadata = { title: "Detalle de guardia" };

const ACTIONS: AssignmentActions = {
  changeStatus: changeAssignmentStatus,
  remove: removeAssignment,
  correct: correctSession,
  voidSession,
  manual: addManualSession,
  incidentNote: saveIncidentNote,
};

export default async function GuardiaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  if (!isGuid(id)) notFound();

  const supabase = await createClient();
  const ctx = await getShiftContext(supabase, id);
  if (!ctx) notFound();

  const now = new Date();
  const [item] = await loadShiftsWithAttendance(supabase, {
    from: new Date(ctx.shift.starts_at),
    to: new Date(ctx.shift.ends_at),
    shiftIds: [id],
    includeCancelled: true,
    now,
  });
  if (!item) notFound();

  const { shift, facility, responsible, coverage } = item;
  const tz = facility?.timezone ?? ctx.timezone;
  const zoneLabel = `${timezoneLabel(tz)}, ${formatOffset(shift.starts_at, tz)}`;
  const canManage = canManageFacility(user, shift.facility_id);
  const assignmentIds = item.assignments.map((a) => a.assignment.id);
  const workerIds = item.assignments.map((a) => a.assignment.worker_id);
  const allSessions = item.assignments.flatMap((a) => a.sessions);

  const [names, workerProfiles, notes, corrections, facilityWorkers, others, checkInWindow, openSessionGrace] = await Promise.all([
    getProfileNames(
      supabase,
      collectActorIds(
        allSessions,
        item.assignments.map((a) => a.assignment),
      ),
    ),
    getWorkerProfileIds(supabase, workerIds),
    getIncidentNotes(supabase, assignmentIds),
    getPendingCorrections(supabase, assignmentIds),
    canManage ? getActiveWorkersOfFacility(supabase, shift.facility_id) : Promise.resolve([] as WorkerOption[]),
    canManage ? getOtherActiveWorkers(supabase, shift.facility_id) : Promise.resolve({ workers: [] as WorkerOption[], truncated: false }),
    getSettingNumber(supabase, "attendance", "checkin_window_before_minutes", 120),
    getSettingNumber(supabase, "attendance", "open_session_grace_minutes", 240),
  ]);
  const checkInOpensAt = new Date(Date.parse(shift.starts_at) - checkInWindow * 60_000);

  const assignedWorkers = item.assignments.map((a) => ({
    id: a.assignment.worker_id,
    full_name: a.worker?.full_name ?? "Persona no visible",
  }));
  const openSessions = item.assignments.filter((a) => a.summary.openSession).length;
  const title = shiftDisplayTitle(shift);

  return (
    <>
      <PageHeader
        title={title}
        description={facility?.official_name}
        actions={
          <>
            <Link href="/guardias" className={buttonClasses("outline")}>
              Volver a guardias
            </Link>
            {canManage ? (
              <Link href={`/guardias/${shift.id}/editar`} className={buttonClasses("primary")}>
                Editar guardia
              </Link>
            ) : null}
            {canManage && shift.status !== "cancelada" ? (
              <Link href={`/pantalla-qr/${shift.id}`} className={buttonClasses("outline")}>
                Mostrar código QR de registro
              </Link>
            ) : null}
          </>
        }
      />

      <div className="space-y-5">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <ShiftStatusBadges effectiveStatus={item.effectiveStatus} storedStatus={shift.status} insufficient={coverage.insufficient} />
            <RefreshButton />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-gray-600">Sede</dt>
              <dd className="text-base text-gray-900">{facility?.official_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-600">Punto de reunión o acceso</dt>
              <dd className="text-base text-gray-900">{shift.meeting_point}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-600">Horario</dt>
              <dd className="text-base text-gray-900">{formatShiftRange(shift.starts_at, shift.ends_at, tz)}</dd>
              <dd className="text-gray-600">Zona horaria: {zoneLabel}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-600">Responsable</dt>
              <dd className="text-base text-gray-900">{responsible?.full_name ?? "Sin responsable"}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-600">Cobertura</dt>
              <dd className="text-base text-gray-900">{staffingSummary(coverage)}</dd>
              <dd className="text-gray-600">En servicio ahora: {coverage.inService}</dd>
            </div>
            {shift.status === "cancelada" && shift.cancel_reason ? (
              <div>
                <dt className="font-medium text-gray-600">Motivo de la cancelación</dt>
                <dd className="text-base text-gray-900">{shift.cancel_reason}</dd>
              </div>
            ) : null}
            {shift.instructions ? (
              <div className="sm:col-span-2">
                <dt className="font-medium text-gray-600">Instrucciones</dt>
                <dd className="whitespace-pre-line text-base text-gray-900">{shift.instructions}</dd>
              </div>
            ) : null}
          </dl>
          {coverage.insufficient ? (
            <Alert tone="warning" title="Cobertura insuficiente" className="mt-3">
              {`Hay ${coverageCurrent(item.effectiveStatus, coverage).count} ${coverageCurrent(item.effectiveStatus, coverage).label} y el mínimo es ${coverage.minStaff}.`}
            </Alert>
          ) : null}
          <div className="mt-3">
            <LastUpdated at={now.toISOString()} timeZone={tz} />
          </div>
        </Card>

        {canManage ? (
          <Card>
            <CardHeader title="Gestión de la guardia" description="Asignaciones y estado. Cada cambio queda en la bitácora con su motivo." />
            <div className="space-y-3">
              {shift.status !== "cancelada" ? (
                <Disclosure summary="Agregar asignación">
                  <AddAssignmentForm
                    action={addAssignment}
                    shiftId={shift.id}
                    facilityWorkers={facilityWorkers}
                    otherWorkers={others.workers}
                    otherTruncated={others.truncated}
                    assignedWorkers={assignedWorkers}
                  />
                </Disclosure>
              ) : null}
              {!user.isAdmin && user.workerId && item.assignments.some((a) => a.assignment.worker_id === user.workerId) ? (
                <Alert tone="info" title="Estás asignado a esta guardia">
                  No puedes cancelarla, finalizarla ni reprogramarla. Pide a otra persona de coordinación o a administración.
                </Alert>
              ) : (
                <ShiftStatusActions
                  action={setShiftStatus}
                  shiftId={shift.id}
                  storedStatus={shift.status}
                  started={hasStarted(shift.starts_at, now)}
                  openSessions={openSessions}
                />
              )}
            </div>
          </Card>
        ) : (
          <Alert tone="info" title="Vista de consulta">
            Tu cuenta puede consultar esta guardia, pero no modificarla.
          </Alert>
        )}

        <section aria-labelledby="asignaciones" className="space-y-3">
          <h2 id="asignaciones" className="text-xl font-bold text-gray-900">
            Asignaciones ({item.assignments.length})
          </h2>
          <Alert tone="info" title="Cómo leer los registros">
            <p>{PRESENCE_NOTICE}</p>
            <p>{EXTRA_STAY_NOTICE}</p>
            <p>Las horas se muestran en la zona de la sede ({zoneLabel}).</p>
          </Alert>
          {item.assignments.length === 0 ? (
            <EmptyState
              title="Sin asignaciones"
              description={canManage ? "Usa «Agregar asignación» para asignar personas a esta guardia." : "Esta guardia todavía no tiene personas asignadas."}
            />
          ) : (
            <div className="space-y-4">
              {item.assignments.map((a) => (
                <AssignmentCard
                  key={a.assignment.id}
                  item={a}
                  tz={tz}
                  zoneLabel={zoneLabel}
                  shift={{ starts_at: shift.starts_at, ends_at: shift.ends_at, status: shift.status }}
                  canManage={canManage}
                  actions={ACTIONS}
                  names={names}
                  currentUserId={user.id}
                  workerProfileId={workerProfiles[a.assignment.worker_id] ?? null}
                  notes={notes.filter((n) => n.assignment_id === a.assignment.id)}
                  corrections={corrections.filter((c) => c.assignment_id === a.assignment.id)}
                  requestId={newRequestId()}
                  now={now}
                  checkInOpensAt={checkInOpensAt}
                  correctionsHref={canManage ? `/correcciones?sede=${shift.facility_id}` : null}
                  viewer={{ isAdmin: user.isAdmin, workerId: user.workerId }}
                  openSessionGraceMinutes={openSessionGrace}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
