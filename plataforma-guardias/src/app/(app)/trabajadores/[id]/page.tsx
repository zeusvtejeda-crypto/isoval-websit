import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ROLE_LABELS, canManageFacility, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadShiftsWithAttendance } from "@/lib/attendance/load";
import {
  ASSIGNMENT_STATUS_LABELS,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  type Tone,
} from "@/lib/attendance/labels";
import { DEFAULT_TIMEZONE, formatDateTime, formatShiftRange } from "@/lib/time";
import { canSeeWorkerAccount, isUuid } from "@/lib/validation/worker";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { WorkerActiveForm, WorkerDeleteForm } from "../_components/worker-actions";
import { deleteWorker, setWorkerActive } from "../actions";
import { getWorkerAccount, getWorkerDetail, getWorkerPrivate } from "../_lib/queries";

export const metadata = { title: "Ficha de trabajador" };

const UPCOMING_DAYS = 30;

const ASSIGNMENT_TONE: Record<keyof typeof ASSIGNMENT_STATUS_LABELS, Tone> = {
  asignado: "neutral",
  ausencia_justificada: "muted",
  inasistencia_confirmada: "danger",
  cancelado: "muted",
};

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{children}</dd>
    </div>
  );
}

const missing = <span className="font-normal text-gray-500">No registrado</span>;

export default async function TrabajadorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const worker = await getWorkerDetail(supabase, id);
  if (!worker) notFound();

  const now = new Date();
  const [privateData, account, upcoming] = await Promise.all([
    getWorkerPrivate(supabase, id),
    getWorkerAccount(supabase, id),
    loadShiftsWithAttendance(supabase, {
      from: now,
      to: new Date(now.getTime() + UPCOMING_DAYS * 86_400_000),
      workerId: id,
      includeCancelled: false,
      now,
    }),
  ]);

  const canManage = canManageFacility(user, worker.facility_id);
  const tz = worker.facility?.timezone ?? DEFAULT_TIMEZONE;
  const assignments = upcoming.flatMap((s) =>
    s.assignments.filter((a) => a.assignment.worker_id === id).map((a) => ({ shift: s, item: a })),
  );

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 text-sm">
        <Link href="/trabajadores" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Trabajadores
        </Link>
      </nav>

      <PageHeader
        title={worker.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{worker.internal_code}</span>
            <Badge tone={worker.active ? "success" : "muted"}>{worker.active ? "Activo" : "Inactivo"}</Badge>
            {worker.is_demo ? <Badge tone="warning">Dato de demostración</Badge> : null}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/historial/trabajador/${worker.id}`} variant="outline">
              Ver historial
            </LinkButton>
            {canManage ? <LinkButton href={`/trabajadores/${worker.id}/editar`}>Editar</LinkButton> : null}
          </>
        }
      />

      <div className="space-y-4">
        {sp.guardado === "1" ? <Alert tone="success">Datos guardados. El cambio quedó en la bitácora.</Alert> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Datos generales" />
            <dl className="grid gap-3 sm:grid-cols-2">
              <Item label="Nombre completo">{worker.full_name}</Item>
              <Item label="Identificador interno">{worker.internal_code}</Item>
              <Item label="Estado (entidad federativa)">{worker.state?.name ?? missing}</Item>
              <Item label="Municipio">{worker.municipality?.name ?? missing}</Item>
              <Item label="Instalación de adscripción">
                {worker.facility ? (
                  <>
                    {worker.facility.official_name}
                    {worker.facility.active ? null : <span className="block text-sm font-normal text-gray-600">Instalación inactiva</span>}
                  </>
                ) : worker.facility_id ? (
                  <span className="font-normal text-gray-500">Instalación no visible para tu cuenta</span>
                ) : (
                  <span className="font-normal text-gray-500">Sin instalación de adscripción</span>
                )}
              </Item>
              <Item label="Área">{worker.area ?? missing}</Item>
              <Item label="Puesto">{worker.position ?? missing}</Item>
              <Item label="Turno habitual">{worker.usual_shift ?? missing}</Item>
              <Item label="Situación">
                <Badge tone={worker.active ? "success" : "muted"}>{worker.active ? "Activo" : "Inactivo"}</Badge>
              </Item>
              <Item label="Última actualización">{formatDateTime(worker.updated_at, tz)}</Item>
            </dl>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Datos privados" description="Número de trabajador y teléfono (opcionales)." />
              {privateData ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Item label="Número de trabajador">{privateData.employee_number ?? missing}</Item>
                  <Item label="Teléfono">
                    {privateData.phone ? (
                      <a href={`tel:${privateData.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex min-h-11 items-center text-brand-800 underline underline-offset-2">
                        {privateData.phone}
                      </a>
                    ) : (
                      missing
                    )}
                  </Item>
                </dl>
              ) : canManage ? (
                <p className="text-gray-700">Sin número de trabajador ni teléfono registrados.</p>
              ) : (
                <p className="text-gray-700">Visibles solo para administración y la coordinación de la sede de adscripción.</p>
              )}
            </Card>

            <Card>
              <CardHeader title="Cuenta de acceso" />
              {account ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Item label="Rol en la aplicación">{ROLE_LABELS[account.role]}</Item>
                  <Item label="Estado de la cuenta">
                    <Badge tone={account.active ? "success" : "muted"}>{account.active ? "Activa" : "Desactivada"}</Badge>
                  </Item>
                </dl>
              ) : canSeeWorkerAccount(user, worker.facility_id) ? (
                <p className="text-gray-700">
                  Sin cuenta de acceso. Un trabajador puede existir sin cuenta; las cuentas se gestionan en Administración.
                </p>
              ) : (
                <p className="text-gray-700">
                  No disponible: la cuenta de acceso solo es visible para administración y para quien tiene asignada la sede de adscripción de esta
                  persona.
                </p>
              )}
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader
            title="Próximas asignaciones"
            description={`Guardias en curso o que inician en los próximos ${UPCOMING_DAYS} días. Horas en la zona de cada sede.`}
          />
          {assignments.length === 0 ? (
            <EmptyState title="Sin asignaciones próximas" description="No tiene guardias asignadas en este periodo." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {assignments.map(({ shift, item }) => {
                const shiftTz = shift.facility?.timezone ?? DEFAULT_TIMEZONE;
                const status = item.assignment.status;
                return (
                  <li key={item.assignment.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/guardias/${shift.shift.id}`}
                        className="inline-flex min-h-11 items-center font-semibold text-brand-800 underline underline-offset-2"
                      >
                        {formatShiftRange(shift.shift.starts_at, shift.shift.ends_at, shiftTz)}
                      </Link>
                      <p className="text-sm text-gray-700">
                        {shift.facility?.official_name ?? "Sede no disponible"} · {item.assignment.assigned_point ?? shift.shift.meeting_point}
                      </p>
                      {shift.shift.title ? <p className="text-sm text-gray-600">{shift.shift.title}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {status !== "asignado" ? <Badge tone={ASSIGNMENT_TONE[status]}>{ASSIGNMENT_STATUS_LABELS[status]}</Badge> : null}
                      <Badge tone={ATTENDANCE_STATUS_TONE[item.summary.status]}>{ATTENDANCE_STATUS_LABELS[item.summary.status]}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-sm text-gray-600">Entrada registrada no equivale a presencia física verificada.</p>
        </Card>

        {canManage ? (
          <Card>
            <CardHeader
              title={worker.active ? "Desactivar" : "Reactivar"}
              description="Los registros no se borran: se desactivan para conservar el historial."
            />
            {worker.active && assignments.some((a) => a.item.assignment.status === "asignado") ? (
              <Alert tone="warning" className="mb-3">
                Tiene guardias asignadas en los próximos días. Una persona inactiva no puede registrar entrada: revisa o cancela esas asignaciones
                desde cada guardia.
              </Alert>
            ) : null}
            <WorkerActiveForm action={setWorkerActive} workerId={worker.id} active={worker.active} />
          </Card>
        ) : null}

        {user.isAdmin ? (
          <details className="rounded-[--radius-card] border border-red-200 bg-white p-4 sm:p-5">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-red-900">Eliminar registro (solo administración)</summary>
            <div className="mt-3 space-y-3">
              <p className="text-sm text-gray-700">
                Solo se puede eliminar un registro sin asignaciones, registros de asistencia, solicitudes, responsabilidades de guardia ni cuenta de
                acceso. Si tiene historial, desactívalo.
              </p>
              <WorkerDeleteForm action={deleteWorker} workerId={worker.id} />
            </div>
          </details>
        ) : null}
      </div>
    </>
  );
}
