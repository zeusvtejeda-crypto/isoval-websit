import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageFacility, requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE, formatDuration } from "@/lib/time";
import { hasStarted, splitShiftTimes } from "@/lib/shifts/dates";
import { firstParam, isGuid, type RawSearchParams } from "@/lib/shifts/filters";
import { shiftDisplayTitle } from "@/lib/shifts/format";
import { countAssignments, countOpenSessions, getActiveWorkersOfFacility, getManageableFacilities, getShiftRow } from "@/lib/shifts/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert, ErrorState } from "@/components/ui/states";
import { buttonClasses } from "@/components/ui/button";
import { FacilityPicker } from "@/components/shifts/facility-picker";
import { ShiftForm } from "@/components/shifts/shift-form";
import { ShiftStatusActions } from "@/components/shifts/shift-status-actions";
import { saveShift, setShiftStatus } from "../../actions";

export const metadata = { title: "Editar guardia" };

export default async function EditarGuardiaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireManager();
  const { id } = await params;
  if (!isGuid(id)) notFound();
  const supabase = await createClient();
  const shift = await getShiftRow(supabase, id);
  if (!shift) notFound();

  const backHref = `/guardias/${id}`;
  if (!canManageFacility(user, shift.facility_id)) {
    return (
      <>
        <PageHeader title="Editar guardia" />
        <ErrorState
          title="No puedes editar esta guardia"
          description="Solo administración o la coordinación de la sede pueden modificarla."
          action={
            <Link href={backHref} className={buttonClasses("outline")}>
              Volver al detalle
            </Link>
          }
        />
      </>
    );
  }

  const sp = await searchParams;
  const [facilities, assignmentCount, openSessions, currentFacilityRow] = await Promise.all([
    getManageableFacilities(supabase, user),
    countAssignments(supabase, id),
    countOpenSessions(supabase, id),
    supabase.from("facilities").select("id, official_name, timezone").eq("id", shift.facility_id).maybeSingle(),
  ]);
  const currentFacility = currentFacilityRow.data ?? { id: shift.facility_id, official_name: "Sede no disponible", timezone: DEFAULT_TIMEZONE };

  const canChangeFacility = assignmentCount === 0 && facilities.length > 1;
  if (canChangeFacility && firstParam(sp.cambiar_sede) === "1") {
    return (
      <>
        <PageHeader title="Cambiar sede de la guardia" description={shiftDisplayTitle(shift)} />
        <FacilityPicker action={`/guardias/${id}/editar`} facilities={facilities} selectedId={shift.facility_id} cancelHref={`/guardias/${id}/editar`} />
      </>
    );
  }
  const requested = canChangeFacility ? facilities.find((f) => f.id === firstParam(sp.sede)) : undefined;
  const facility = requested ? { id: requested.id, official_name: requested.official_name, timezone: requested.timezone } : currentFacility;

  // Las horas se muestran en la zona de la sede actual de la guardia.
  const split = splitShiftTimes(shift.starts_at, shift.ends_at, currentFacility.timezone);
  const workers = await getActiveWorkersOfFacility(supabase, facility.id);
  let extraResponsible: { id: string; full_name: string } | null = null;
  if (shift.responsible_worker_id && !workers.some((w) => w.id === shift.responsible_worker_id)) {
    const { data } = await supabase.from("workers").select("id, full_name").eq("id", shift.responsible_worker_id).maybeSingle();
    extraResponsible = data ?? { id: shift.responsible_worker_id, full_name: "Responsable actual (no visible)" };
  }

  return (
    <>
      <PageHeader
        title="Editar guardia"
        description={shiftDisplayTitle(shift)}
        actions={
          <Link href={backHref} className={buttonClasses("outline")}>
            Volver al detalle
          </Link>
        }
      />
      <div className="space-y-4">
        {shift.status === "cancelada" ? (
          <Alert tone="warning" title="Guardia cancelada">
            Puedes corregir sus datos; para volver a programarla usa «Reactivar guardia» abajo.
          </Alert>
        ) : null}
        {!split.representable ? (
          <Alert tone="warning" title="Horario fuera del formato del formulario">
            {split.durationMinutes > 1440
              ? `Esta guardia dura ${formatDuration(split.durationMinutes)}. El formulario permite hasta 24 horas: `
              : "El horario guardado no coincide exactamente con una fecha y horas en minutos: "}
            al guardar, el término será la hora indicada (el mismo día o el siguiente).
          </Alert>
        ) : null}
        {assignmentCount > 0 ? (
          <p className="text-sm text-gray-600">
            La guardia tiene {assignmentCount} {assignmentCount === 1 ? "asignación" : "asignaciones"}: no se puede cambiar de sede. Los cambios de horario
            recalculan la asistencia registrada.
          </p>
        ) : null}
        <Card>
          <ShiftForm
            action={saveShift}
            shiftId={shift.id}
            facility={facility}
            workers={workers}
            extraResponsible={requested ? null : extraResponsible}
            defaults={{
              title: shift.title ?? "",
              meeting_point: shift.meeting_point,
              date: split.date,
              start_time: split.startTime,
              end_time: split.endTime,
              responsible_worker_id: requested ? "" : (shift.responsible_worker_id ?? ""),
              min_staff: String(shift.min_staff),
              max_staff: shift.max_staff != null ? String(shift.max_staff) : "",
              instructions: shift.instructions ?? "",
            }}
            cancelHref={backHref}
            changeFacilityHref={canChangeFacility ? `/guardias/${id}/editar?cambiar_sede=1` : null}
          />
        </Card>
        <Card>
          <CardHeader title="Estado de la guardia" description="Cancelar exige motivo. Finalizar manualmente es opcional." />
          <ShiftStatusActions
            action={setShiftStatus}
            shiftId={shift.id}
            storedStatus={shift.status}
            started={hasStarted(shift.starts_at)}
            openSessions={openSessions}
          />
        </Card>
      </div>
    </>
  );
}
