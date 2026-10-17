import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { AssignmentWithAttendance, SessionRow } from "@/lib/attendance/load";
import type { IncidentType, RecordStatus } from "@/lib/attendance/calc";
import {
  ASSIGNMENT_STATUS_LABELS,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  INCIDENT_LABELS,
  METHOD_LABELS,
  RECORD_STATUS_LABELS,
  afterPreposition,
  type Tone,
} from "@/lib/attendance/labels";
import { formatDateTime, formatDuration, utcToLocalInput } from "@/lib/time";
import { describeActor } from "@/lib/shifts/actors";
import { coverLabel, formatSignedDuration, shortId } from "@/lib/shifts/format";
import {
  OWN_RECORD_NOTICE,
  STALE_OPEN_NOTICE,
  captureInputBounds,
  describeCaptureWindow,
  isOpenSessionStale,
  isOwnRecordLocked,
  type Viewer,
} from "@/lib/shifts/rules";
import type { FormAction, WorkerOption } from "@/lib/shifts/types";
import type { CorrectionRequestRow, IncidentNoteRow } from "@/lib/shifts/queries";
import {
  AssignmentStatusForm,
  CorrectSessionForm,
  EditAssignmentForm,
  IncidentNoteForm,
  ManualSessionForm,
  RemoveAssignmentForm,
  VoidSessionForm,
} from "./assignment-forms";
import { AttendanceOnBehalf } from "./attendance-on-behalf";
import { Disclosure } from "./disclosure";

export const PRESENCE_NOTICE = "Entrada registrada no equivale a presencia física verificada.";
export const EXTRA_STAY_NOTICE = "Permanencia adicional = tiempo registrado adicional, no horas extra pagadas.";
export const GAP_LABEL = "Tiempo entre salida y regreso (no cuenta)";

export type AssignmentActions = {
  changeStatus: FormAction;
  update: FormAction;
  remove: FormAction;
  correct: FormAction;
  voidSession: FormAction;
  manual: FormAction;
  incidentNote: FormAction;
};

const RECORD_TONE: Record<RecordStatus, Tone> = { vigente: "success", corregido: "warning", anulado: "muted" };
const ASSIGNMENT_TONE: Record<keyof typeof ASSIGNMENT_STATUS_LABELS, Tone> = {
  asignado: "neutral",
  ausencia_justificada: "muted",
  inasistencia_confirmada: "danger",
  cancelado: "muted",
};

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <dt className="text-xs font-medium text-gray-600">{label}</dt>
      <dd className="text-base font-semibold text-gray-900">{value}</dd>
      {hint ? <dd className="text-xs text-gray-500">{hint}</dd> : null}
    </div>
  );
}

type ActorNames = Record<string, string>;

function SessionItem({
  session,
  all,
  tz,
  names,
  currentUserId,
  workerProfileId,
  canManage,
  actions,
  capture,
  zoneLabel,
  staleOpen,
}: {
  session: SessionRow;
  all: SessionRow[];
  tz: string;
  names: ActorNames;
  currentUserId: string;
  workerProfileId: string | null;
  /** Puede corregir/anular este registro (gestión de la sede y no es su propia asistencia). */
  canManage: boolean;
  actions: AssignmentActions;
  capture: { minLocal: string; maxLocal: string; rangeLabel: string };
  zoneLabel: string;
  /** Esta es la entrada abierta que ya pasó término + margen: la corrección es la acción a seguir. */
  staleOpen: boolean;
}) {
  const actor = (id: string | null, method: SessionRow["check_in_method"] | null) =>
    describeActor(id, names, { currentUserId, workerProfileId, method });
  const original = session.supersedes_id ? all.find((s) => s.id === session.supersedes_id) : null;
  const replacement = all.find((s) => s.supersedes_id === session.id);
  const timeKind = (method: SessionRow["check_in_method"]) => (method === "correccion" ? "hora capturada" : "hora del servidor");

  return (
    <li className={session.record_status === "vigente" ? "rounded-xl border border-gray-200 bg-white p-3" : "rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={RECORD_TONE[session.record_status]}>{RECORD_STATUS_LABELS[session.record_status]}</Badge>
        <span className="text-xs text-gray-500">Registro {shortId(session.id)}</span>
      </div>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium text-gray-900">Entrada</dt>
          <dd className={session.record_status === "vigente" ? "text-gray-900" : "text-gray-600 line-through decoration-gray-400"}>
            {formatDateTime(session.check_in_at, tz)} <span className="text-xs text-gray-500">({timeKind(session.check_in_method)})</span>
          </dd>
          <dd className="text-gray-700">{METHOD_LABELS[session.check_in_method]}</dd>
          <dd className="text-gray-700">Registró: {actor(session.check_in_by, session.check_in_method)}</dd>
          {session.check_in_reason ? <dd className="text-gray-700">Motivo: {session.check_in_reason}</dd> : null}
        </div>
        <div>
          <dt className="font-medium text-gray-900">Salida</dt>
          {session.check_out_at && session.check_out_method ? (
            <>
              <dd className={session.record_status === "vigente" ? "text-gray-900" : "text-gray-600 line-through decoration-gray-400"}>
                {formatDateTime(session.check_out_at, tz)} <span className="text-xs text-gray-500">({timeKind(session.check_out_method)})</span>
              </dd>
              <dd className="text-gray-700">{METHOD_LABELS[session.check_out_method]}</dd>
              <dd className="text-gray-700">Registró: {actor(session.check_out_by, session.check_out_method)}</dd>
              {session.check_out_reason ? <dd className="text-gray-700">Motivo: {session.check_out_reason}</dd> : null}
            </>
          ) : (
            <dd className="text-gray-700">Sin salida registrada</dd>
          )}
        </div>
      </dl>
      {session.notes ? <p className="mt-2 whitespace-pre-line text-sm text-gray-700">Notas: {session.notes}</p> : null}
      {original ? (
        <p className="mt-2 text-sm text-gray-700">
          Corrige al registro {shortId(original.id)} (entrada original {formatDateTime(original.check_in_at, tz)}).
        </p>
      ) : null}
      {session.record_status !== "vigente" ? (
        <p className="mt-2 text-sm text-gray-700">
          {session.record_status === "corregido" ? "Corregido" : "Anulado"}
          {session.status_changed_at ? ` el ${formatDateTime(session.status_changed_at, tz)}` : ""}
          {session.status_changed_by ? ` por ${afterPreposition(actor(session.status_changed_by, "correccion"))}` : ""}
          {session.status_reason ? `. Motivo: ${session.status_reason}` : ""}
          {replacement ? `. Versión vigente: registro ${shortId(replacement.id)}.` : ""}
        </p>
      ) : null}

      {canManage && session.record_status === "vigente" ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Disclosure
            id={`corregir-${session.id}`}
            tone={staleOpen ? "attention" : "default"}
            summary={
              staleOpen ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>Corregir registro</span>
                  <Badge tone="warning">Falta la hora real de salida</Badge>
                </span>
              ) : (
                "Corregir registro"
              )
            }
          >
            <CorrectSessionForm
              action={actions.correct}
              sessionId={session.id}
              defaultCheckIn={utcToLocalInput(session.check_in_at, tz)}
              defaultCheckOut={session.check_out_at ? utcToLocalInput(session.check_out_at, tz) : ""}
              hasCheckOut={Boolean(session.check_out_at)}
              requireCheckOut={staleOpen}
              minLocal={capture.minLocal}
              maxLocal={capture.maxLocal}
              rangeLabel={capture.rangeLabel}
              zoneLabel={zoneLabel}
            />
          </Disclosure>
          <Disclosure summary="Anular registro" tone="danger">
            <VoidSessionForm action={actions.voidSession} sessionId={session.id} />
          </Disclosure>
        </div>
      ) : null}
    </li>
  );
}

/** Tarjeta de una asignación: estado, registros, métricas, incidencias y acciones. */
export function AssignmentCard({
  item,
  tz,
  zoneLabel,
  shift,
  canManage,
  actions,
  names,
  currentUserId,
  workerProfileId,
  notes,
  corrections,
  hasCorrectionRequests = false,
  requestId,
  now,
  checkInOpensAt,
  correctionsHref,
  viewer,
  openSessionGraceMinutes,
  substituteOptions,
}: {
  item: AssignmentWithAttendance;
  tz: string;
  zoneLabel: string;
  shift: { starts_at: string; ends_at: string; status: string };
  canManage: boolean;
  actions: AssignmentActions;
  names: ActorNames;
  currentUserId: string;
  workerProfileId: string | null;
  notes: IncidentNoteRow[];
  corrections: CorrectionRequestRow[];
  /** ¿Tiene solicitudes de corrección en cualquier estado? (entonces no puede quitarse). */
  hasCorrectionRequests?: boolean;
  /** Identificador generado por el servidor para el registro manual (idempotencia). */
  requestId: string;
  now: Date;
  /** Momento en que abre el registro de entrada (inicio − ventana configurada). */
  checkInOpensAt: Date;
  /** Enlace a la revisión de solicitudes de corrección (solo gestión). */
  correctionsHref?: string | null;
  /** Cuenta en sesión: separación de funciones sobre su propia asistencia. */
  viewer: Viewer;
  /** Margen tras el término (attendance.open_session_grace_minutes) para cerrar una entrada con la hora actual. */
  openSessionGraceMinutes: number;
  /** Opciones de «cubre a» al editar la asignación: asignados a la guardia y trabajadores activos de la sede. */
  substituteOptions?: { assigned: { id: string; full_name: string }[]; facility: WorkerOption[] };
}) {
  const { assignment, worker, substituteFor, summary } = item;
  const sessions = [...item.sessions].sort((a, b) => a.check_in_at.localeCompare(b.check_in_at) || a.created_at.localeCompare(b.created_at));
  const workerName = worker?.full_name ?? "Persona no visible";
  const hasOpenSession = Boolean(summary.openSession);
  const hasValidSessions = sessions.some((s) => s.record_status === "vigente");
  const shiftEnded = now.getTime() >= Date.parse(shift.ends_at);
  const shiftCancelled = shift.status === "cancelada";
  const shiftStarted = now.getTime() >= Date.parse(shift.starts_at);
  const checkInNotOpen = now.getTime() < checkInOpensAt.getTime();
  const canCheckIn = !shiftCancelled && !shiftEnded && !checkInNotOpen && assignment.status === "asignado";
  // Salvo administración, nadie corrige, agrega, anula, cambia el estado ni justifica su propia asistencia.
  const ownLocked = isOwnRecordLocked(viewer, assignment.worker_id);
  const canEditAttendance = canManage && !ownLocked;
  // Entrada abierta más allá de término + margen: la BD no deja cerrarla con la hora actual.
  const staleOpen =
    summary.status === "registro_incompleto" ||
    isOpenSessionStale({ hasOpenSession, shiftEndsAt: shift.ends_at, now, graceMinutes: openSessionGraceMinutes });
  const staleSessionId = staleOpen ? (summary.openSession?.id ?? null) : null;
  const canAddManual = shiftStarted && !shiftCancelled && assignment.status === "asignado";
  const bounds = captureInputBounds(shift, now, tz);
  const capture = { minLocal: bounds.min, maxLocal: bounds.max, rangeLabel: describeCaptureWindow(shift, tz) };
  const manualOut = utcToLocalInput(Math.min(now.getTime(), Date.parse(shift.ends_at)), tz);
  const cover = coverLabel(substituteFor, assignment.substitute_for_worker_id);

  const statusMeta = [
    assignment.status_changed_at ? formatDateTime(assignment.status_changed_at, tz) : null,
    assignment.status_changed_by ? `por ${afterPreposition(describeActor(assignment.status_changed_by, names, { currentUserId, method: "coordinador" }))}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const noteByType = new Map(notes.map((n) => [n.incident_type, n]));
  const incidentTypes: IncidentType[] = [...summary.incidents.map((i) => i.type)];
  for (const n of notes) if (!incidentTypes.includes(n.incident_type)) incidentTypes.push(n.incident_type);
  const minutesByType = new Map(summary.incidents.map((i) => [i.type, i.minutes]));

  return (
    <article className="rounded-card border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby={`asig-${assignment.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`asig-${assignment.id}`} className="text-lg font-semibold text-gray-900">
            {workerName}
          </h3>
          {worker ? (
            <p className="text-sm text-gray-600">
              {worker.internal_code}
              {worker.position ? ` · ${worker.position}` : ""}
              {worker.area ? ` · ${worker.area}` : ""}
            </p>
          ) : null}
          {cover ? (
            <p className="mt-1">
              <Badge tone="info">{cover}</Badge>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={ASSIGNMENT_TONE[assignment.status]}>{ASSIGNMENT_STATUS_LABELS[assignment.status]}</Badge>
          <Badge tone={ATTENDANCE_STATUS_TONE[summary.status]}>{ATTENDANCE_STATUS_LABELS[summary.status]}</Badge>
          {summary.needsReview ? <Badge tone="warning">Requiere revisión</Badge> : null}
        </div>
      </header>

      <dl className="mt-3 grid gap-1 text-sm text-gray-700 sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-gray-900">Punto asignado: </dt>
          <dd className="inline">{assignment.assigned_point ?? "El de la guardia"}</dd>
        </div>
        {assignment.status_reason ? (
          <div className="sm:col-span-2">
            <dt className="inline font-medium text-gray-900">Motivo del estado: </dt>
            <dd className="inline">
              {assignment.status_reason}
              {statusMeta ? ` (${statusMeta})` : ""}
            </dd>
          </div>
        ) : null}
        {assignment.notes ? (
          <div className="sm:col-span-2">
            <dt className="inline font-medium text-gray-900">Notas: </dt>
            <dd className="inline whitespace-pre-line">{assignment.notes}</dd>
          </div>
        ) : null}
      </dl>

      {summary.openSession && summary.openElapsedMinutes != null ? (
        staleOpen ? (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Entrada abierta desde {formatDateTime(summary.openSession.checkInAt, tz)} ({formatDuration(summary.openElapsedMinutes)} transcurridos) y sin salida
            después del término y el margen: requiere revisión. No suma tiempo registrado; la salida no se registra con la hora actual, sino con la hora real
            mediante una corrección.
          </p>
        ) : (
          <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-950">
            Entrada abierta desde {formatDateTime(summary.openSession.checkInAt, tz)} ({formatDuration(summary.openElapsedMinutes)} transcurridos). No suma
            tiempo registrado hasta que se registre la salida.
          </p>
        )
      ) : null}

      <section className="mt-4" aria-label={`Métricas de ${workerName}`}>
        <h4 className="mb-2 font-semibold text-gray-900">Tiempo registrado</h4>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Programado" value={formatDuration(summary.scheduledMinutes)} />
          <Metric label="Dentro del horario" value={formatDuration(summary.withinScheduleMinutes)} />
          <Metric label="Fuera del horario" value={formatDuration(summary.outsideScheduleMinutes)} />
          <Metric label="Total registrado" value={formatDuration(summary.totalMinutes)} />
          <Metric label="Diferencia" value={formatSignedDuration(summary.differenceMinutes)} hint="Registrado − programado" />
          <Metric label="Retraso" value={summary.lateMinutes != null ? formatDuration(summary.lateMinutes) : "—"} />
          <Metric label="Salida anticipada" value={summary.earlyLeaveMinutes != null ? formatDuration(summary.earlyLeaveMinutes) : "—"} />
          <Metric label="Permanencia adicional" value={formatDuration(summary.afterEndMinutes)} hint="Tiempo registrado adicional" />
        </dl>
        <p className="mt-2 text-sm text-gray-700">
          {GAP_LABEL}: <span className="font-semibold text-gray-900">{formatDuration(summary.gapMinutes)}</span>
        </p>
        <p className="mt-1 text-xs text-gray-600">{EXTRA_STAY_NOTICE}</p>
      </section>

      <section className="mt-4" aria-label={`Incidencias de ${workerName}`}>
        <h4 className="mb-2 font-semibold text-gray-900">Incidencias</h4>
        {incidentTypes.length === 0 ? (
          <p className="text-sm text-gray-600">Sin incidencias calculadas.</p>
        ) : (
          <ul className="space-y-2">
            {incidentTypes.map((type) => {
              const note = noteByType.get(type) ?? null;
              const minutes = minutesByType.get(type);
              const current = summary.incidents.some((i) => i.type === type);
              return (
                <li key={type} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={current ? "warning" : "muted"}>{INCIDENT_LABELS[type]}</Badge>
                    {minutes != null ? <span className="text-sm text-gray-700">{formatDuration(minutes)}</span> : null}
                    {note ? <Badge tone="info">Justificada</Badge> : null}
                    {!current ? <span className="text-xs text-gray-500">Ya no aparece en el cálculo actual</span> : null}
                  </div>
                  {note ? (
                    <p className="mt-1 whitespace-pre-line text-sm text-gray-700">
                      Justificación: {note.note} <span className="text-xs text-gray-500">({formatDateTime(note.updated_at, tz)})</span>
                    </p>
                  ) : null}
                  {canEditAttendance ? (
                    <Disclosure summary={note ? "Editar justificación" : "Justificar"} className="mt-2">
                      <IncidentNoteForm action={actions.incidentNote} assignmentId={assignment.id} incidentType={type} currentNote={note?.note ?? null} />
                    </Disclosure>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-600">Las incidencias son señales para revisión humana; no implican sanciones automáticas.</p>
      </section>

      <section className="mt-4" aria-label={`Registros de ${workerName}`}>
        <h4 className="font-semibold text-gray-900">Registros de entrada y salida</h4>
        <p className="mb-2 text-sm text-gray-600">
          {PRESENCE_NOTICE} Horas en {zoneLabel}.
        </p>
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-600">Sin registros.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                all={sessions}
                tz={tz}
                names={names}
                currentUserId={currentUserId}
                workerProfileId={workerProfileId}
                canManage={canEditAttendance}
                actions={actions}
                capture={capture}
                zoneLabel={zoneLabel}
                staleOpen={s.id === staleSessionId}
              />
            ))}
          </ul>
        )}
        {corrections.length > 0 ? (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Solicitudes de corrección pendientes de revisión</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {corrections.map((c) => (
                <li key={c.id}>
                  {c.requested_check_in_at ? `Entrada solicitada: ${formatDateTime(c.requested_check_in_at, tz)}. ` : ""}
                  {c.requested_check_out_at ? `Salida solicitada: ${formatDateTime(c.requested_check_out_at, tz)}. ` : ""}
                  Motivo: {c.reason}
                  {c.session_id ? ` (registro ${shortId(c.session_id)})` : " (registro nuevo)"}
                </li>
              ))}
            </ul>
            {canEditAttendance && correctionsHref ? (
              <Link href={correctionsHref} className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                Revisar solicitudes en Correcciones
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      {canManage ? (
        <section className="mt-4 space-y-2" aria-label={`Acciones para ${workerName}`}>
          <h4 className="font-semibold text-gray-900">Acciones de coordinación</h4>
          {ownLocked ? (
            <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <p className="font-semibold">{OWN_RECORD_NOTICE}</p>
              {!staleOpen && (hasOpenSession || canCheckIn) ? (
                <p className="mt-1">
                  Para registrar tu propia entrada o salida usa{" "}
                  <Link href="/mi-guardia" className="font-semibold underline underline-offset-2">
                    Mi guardia
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          ) : (
            <>
              {staleOpen ? (
                <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  <p className="font-semibold">{STALE_OPEN_NOTICE}</p>
                  {staleSessionId ? (
                    <a href={`#corregir-${staleSessionId}`} className="mt-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                      Ir a «Corregir registro»
                    </a>
                  ) : null}
                </div>
              ) : hasOpenSession || canCheckIn ? (
                <Disclosure summary={hasOpenSession ? "Registrar salida por otra persona" : "Registrar entrada por otra persona"}>
                  <AttendanceOnBehalf assignmentId={assignment.id} workerName={workerName} hasOpenSession={hasOpenSession} timezone={tz} />
                </Disclosure>
              ) : (
                <p className="text-sm text-gray-600">
                  {shiftCancelled
                    ? "La guardia está cancelada: no se registran entradas nuevas."
                    : assignment.status !== "asignado"
                      ? "La asignación no está activa: no se registran entradas nuevas."
                      : checkInNotOpen
                        ? `El registro de entrada abre el ${formatDateTime(checkInOpensAt, tz)}.`
                        : "La guardia ya terminó: para una entrada y salida no registradas usa «Agregar registro manual»."}
                </p>
              )}
              {canAddManual ? (
                <Disclosure summary="Agregar registro manual">
                  <ManualSessionForm
                    action={actions.manual}
                    assignmentId={assignment.id}
                    requestId={requestId}
                    defaultCheckIn={utcToLocalInput(shift.starts_at, tz)}
                    defaultCheckOut={manualOut}
                    minLocal={capture.minLocal}
                    maxLocal={capture.maxLocal}
                    rangeLabel={capture.rangeLabel}
                    zoneLabel={zoneLabel}
                  />
                </Disclosure>
              ) : (
                <p className="text-sm text-gray-600">
                  {shiftCancelled
                    ? "La guardia está cancelada: no se agregan registros manuales."
                    : assignment.status !== "asignado"
                      ? "La asignación no está activa: para agregar registros, vuelve a ponerla como «Asignado»."
                      : "El registro manual posterior estará disponible cuando inicie la guardia."}
                </p>
              )}
              <Disclosure summary="Cambiar estado de la asignación">
                <AssignmentStatusForm
                  action={actions.changeStatus}
                  assignmentId={assignment.id}
                  currentStatus={assignment.status}
                  shiftEnded={shiftEnded}
                  hasValidSessions={hasValidSessions}
                />
              </Disclosure>
              <Disclosure summary="Editar asignación">
                <EditAssignmentForm
                  action={actions.update}
                  assignmentId={assignment.id}
                  workerId={assignment.worker_id}
                  assignedPoint={assignment.assigned_point}
                  substituteId={assignment.substitute_for_worker_id}
                  substituteName={substituteFor?.full_name ?? null}
                  notes={assignment.notes}
                  assignedWorkers={substituteOptions?.assigned ?? []}
                  facilityWorkers={substituteOptions?.facility ?? []}
                />
              </Disclosure>
            </>
          )}
          {sessions.length === 0 && assignment.status === "asignado" && notes.length === 0 && corrections.length === 0 && !hasCorrectionRequests && !ownLocked ? (
            <Disclosure summary="Quitar asignación" tone="danger">
              <RemoveAssignmentForm action={actions.remove} assignmentId={assignment.id} workerName={workerName} />
            </Disclosure>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}
