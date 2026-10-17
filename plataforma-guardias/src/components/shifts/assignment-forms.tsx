"use client";

import { useMemo, useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/attendance/labels";
import type { AssignmentStatus, IncidentType } from "@/lib/attendance/calc";
import type { FormAction, WorkerOption } from "@/lib/shifts/types";
import { ActionForm, fieldError } from "./action-form";

function aria(error: string | null, id: string) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function ReasonTextarea({ id, label, error, min = 5, hint }: { id: string; label: string; error: string | null; min?: number; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} required error={error} hint={hint}>
      <Textarea id={id} name="reason" required minLength={min} maxLength={500} className="min-h-16" {...aria(error, id)} />
    </Field>
  );
}

/** Agregar asignación: prioriza trabajadores de la sede; permite sustituciones. */
export function AddAssignmentForm({
  action,
  shiftId,
  facilityWorkers,
  otherWorkers,
  otherTruncated,
  assignedWorkers,
}: {
  action: FormAction;
  shiftId: string;
  facilityWorkers: WorkerOption[];
  otherWorkers: WorkerOption[];
  otherTruncated: boolean;
  /** Personas ya asignadas (para «sustituye a»). */
  assignedWorkers: { id: string; full_name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [workerId, setWorkerId] = useState("");
  const assignedIds = useMemo(() => new Set(assignedWorkers.map((w) => w.id)), [assignedWorkers]);

  const q = normalize(query);
  const matches = (w: WorkerOption) =>
    !assignedIds.has(w.id) && (!q || normalize(w.full_name).includes(q) || normalize(w.internal_code).includes(q));
  const own = facilityWorkers.filter(matches);
  const others = otherWorkers.filter(matches);
  const selectedVisible = workerId === "" || own.some((w) => w.id === workerId) || others.some((w) => w.id === workerId);
  const substituteOptions = facilityWorkers.filter((w) => !assignedIds.has(w.id));
  const noneAvailable = facilityWorkers.every((w) => assignedIds.has(w.id)) && otherWorkers.every((w) => assignedIds.has(w.id));

  return (
    <ActionForm action={action} submitLabel="Agregar asignación" pendingLabel="Agregando…">
      {(state) => (
        <>
          <input type="hidden" name="shift_id" value={shiftId} />
          {noneAvailable ? (
            <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">No hay más trabajadores activos disponibles para asignar.</p>
          ) : null}
          <Field label="Buscar por nombre o clave" htmlFor={`buscar-${shiftId}`} hint="Filtra la lista de abajo.">
            <Input id={`buscar-${shiftId}`} type="search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} autoComplete="off" />
          </Field>
          <Field label="Trabajador" htmlFor={`worker-${shiftId}`} required error={fieldError(state, "worker_id")}>
            <Select
              id={`worker-${shiftId}`}
              name="worker_id"
              required
              value={selectedVisible ? workerId : ""}
              onChange={(e) => setWorkerId(e.currentTarget.value)}
              {...aria(fieldError(state, "worker_id"), `worker-${shiftId}`)}
            >
              <option value="">Elige a una persona…</option>
              {own.length > 0 ? (
                <optgroup label="De esta sede">
                  {own.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name} · {w.internal_code}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {others.length > 0 ? (
                <optgroup label="De otras sedes">
                  {others.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name} · {w.internal_code}
                      {w.facility_name ? ` · ${w.facility_name}` : " · Sin sede"}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>
          {otherTruncated ? (
            <p className="text-sm text-gray-600">La lista de otras sedes se recortó; usa la búsqueda o consulta el directorio de trabajadores.</p>
          ) : null}
          <Field label="Punto asignado" htmlFor={`point-${shiftId}`} error={fieldError(state, "assigned_point")} hint="Si es distinto del punto de reunión.">
            <Input id={`point-${shiftId}`} name="assigned_point" maxLength={200} {...aria(fieldError(state, "assigned_point"), `point-${shiftId}`)} />
          </Field>
          <Field label="Sustituye a" htmlFor={`sub-${shiftId}`} error={fieldError(state, "substitute_for_worker_id")}>
            <Select id={`sub-${shiftId}`} name="substitute_for_worker_id" defaultValue="" {...aria(fieldError(state, "substitute_for_worker_id"), `sub-${shiftId}`)}>
              <option value="">No es sustitución</option>
              {assignedWorkers.length > 0 ? (
                <optgroup label="Asignados a esta guardia">
                  {assignedWorkers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {substituteOptions.length > 0 ? (
                <optgroup label="Otras personas de la sede">
                  {substituteOptions.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name} · {w.internal_code}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>
          <Field label="Notas" htmlFor={`notes-${shiftId}`} error={fieldError(state, "notes")}>
            <Textarea id={`notes-${shiftId}`} name="notes" maxLength={500} className="min-h-16" />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

const STATUS_HINTS: Record<AssignmentStatus, string> = {
  asignado: "La persona vuelve a estar asignada.",
  ausencia_justificada: "Ausencia con justificación. No cuenta como inasistencia.",
  inasistencia_confirmada: "Solo después de que termina la guardia y tras revisión. No es una sanción automática.",
  cancelado: "La asignación se conserva en el historial con estado cancelado.",
};

/** Cambiar el estado de una asignación (set_assignment_status). */
export function AssignmentStatusForm({
  action,
  assignmentId,
  currentStatus,
  shiftEnded,
  hasValidSessions,
}: {
  action: FormAction;
  assignmentId: string;
  currentStatus: AssignmentStatus;
  shiftEnded: boolean;
  hasValidSessions: boolean;
}) {
  const options = (Object.keys(ASSIGNMENT_STATUS_LABELS) as AssignmentStatus[]).filter((s) => s !== currentStatus);
  return (
    <ActionForm action={action} submitLabel="Cambiar estado">
      {(state) => (
        <>
          <input type="hidden" name="assignment_id" value={assignmentId} />
          {hasValidSessions ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Tiene registros vigentes: para marcar ausencia, inasistencia o cancelar, primero corrige o anula sus registros.
            </p>
          ) : null}
          <Field label="Nuevo estado" htmlFor={`status-${assignmentId}`} required error={fieldError(state, "status")}>
            <Select id={`status-${assignmentId}`} name="status" required defaultValue="">
              <option value="" disabled>
                Elige el estado…
              </option>
              {options.map((s) => (
                <option key={s} value={s} disabled={s === "inasistencia_confirmada" && !shiftEnded}>
                  {ASSIGNMENT_STATUS_LABELS[s]}
                  {s === "inasistencia_confirmada" && !shiftEnded ? " (disponible al terminar la guardia)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-600">
            {options.map((s) => (
              <li key={s}>
                <strong>{ASSIGNMENT_STATUS_LABELS[s]}:</strong> {STATUS_HINTS[s]}
              </li>
            ))}
          </ul>
          <ReasonTextarea id={`status-reason-${assignmentId}`} label="Motivo" error={fieldError(state, "reason")} />
        </>
      )}
    </ActionForm>
  );
}

/** Quitar una asignación sin registros (se borra; queda en la bitácora con el motivo). */
export function RemoveAssignmentForm({ action, assignmentId, workerName }: { action: FormAction; assignmentId: string; workerName: string }) {
  return (
    <ActionForm
      action={action}
      submitLabel="Quitar asignación"
      pendingLabel="Quitando…"
      variant="danger"
      confirmMessage={`¿Quitar a ${workerName} de esta guardia?`}
    >
      {(state) => (
        <>
          <input type="hidden" name="assignment_id" value={assignmentId} />
          <p className="text-sm text-gray-600">Solo se puede quitar porque no tiene registros de entrada o salida.</p>
          <ReasonTextarea id={`remove-${assignmentId}`} label="Motivo" error={fieldError(state, "reason")} hint="Por ejemplo: «Asignada por error»." />
        </>
      )}
    </ActionForm>
  );
}

/** Registro manual posterior (add_manual_attendance). El requestId lo genera el servidor. */
export function ManualSessionForm({
  action,
  assignmentId,
  requestId,
  defaultCheckIn,
  defaultCheckOut,
  maxLocal,
  zoneLabel,
}: {
  action: FormAction;
  assignmentId: string;
  requestId: string;
  defaultCheckIn: string;
  defaultCheckOut: string;
  maxLocal: string;
  zoneLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel="Agregar registro manual">
      {(state) => (
        <>
          <input type="hidden" name="assignment_id" value={assignmentId} />
          <input type="hidden" name="request_id" value={requestId} />
          <p className="text-sm text-gray-600">
            Para cuando la persona no pudo registrar. Horas en {zoneLabel}. Se marcará como corrección administrativa.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Entrada" htmlFor={`m-in-${assignmentId}`} required error={fieldError(state, "check_in")}>
              <Input
                id={`m-in-${assignmentId}`}
                name="check_in"
                type="datetime-local"
                required
                max={maxLocal}
                defaultValue={defaultCheckIn}
                {...aria(fieldError(state, "check_in"), `m-in-${assignmentId}`)}
              />
            </Field>
            <Field label="Salida" htmlFor={`m-out-${assignmentId}`} required error={fieldError(state, "check_out")}>
              <Input
                id={`m-out-${assignmentId}`}
                name="check_out"
                type="datetime-local"
                required
                max={maxLocal}
                defaultValue={defaultCheckOut}
                {...aria(fieldError(state, "check_out"), `m-out-${assignmentId}`)}
              />
            </Field>
          </div>
          <ReasonTextarea id={`m-reason-${assignmentId}`} label="Motivo" error={fieldError(state, "reason")} />
          <Field label="Notas" htmlFor={`m-notes-${assignmentId}`} error={fieldError(state, "notes")}>
            <Textarea id={`m-notes-${assignmentId}`} name="notes" maxLength={500} className="min-h-16" />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

/** Corrección de una sesión vigente (correct_attendance): crea una versión nueva y conserva la original. */
export function CorrectSessionForm({
  action,
  sessionId,
  defaultCheckIn,
  defaultCheckOut,
  hasCheckOut,
  maxLocal,
  zoneLabel,
}: {
  action: FormAction;
  sessionId: string;
  defaultCheckIn: string;
  defaultCheckOut: string;
  hasCheckOut: boolean;
  maxLocal: string;
  zoneLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel="Guardar corrección">
      {(state) => (
        <>
          <input type="hidden" name="session_id" value={sessionId} />
          <p className="text-sm text-gray-600">Horas en {zoneLabel}. El registro original se conserva como «corregido».</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Entrada correcta" htmlFor={`c-in-${sessionId}`} required error={fieldError(state, "check_in")}>
              <Input
                id={`c-in-${sessionId}`}
                name="check_in"
                type="datetime-local"
                required
                max={maxLocal}
                defaultValue={defaultCheckIn}
                {...aria(fieldError(state, "check_in"), `c-in-${sessionId}`)}
              />
            </Field>
            <Field
              label="Salida correcta"
              htmlFor={`c-out-${sessionId}`}
              required={hasCheckOut}
              error={fieldError(state, "check_out")}
              hint={hasCheckOut ? undefined : "Déjala vacía si la persona sigue en servicio."}
            >
              <Input
                id={`c-out-${sessionId}`}
                name="check_out"
                type="datetime-local"
                required={hasCheckOut}
                max={maxLocal}
                defaultValue={defaultCheckOut}
                {...aria(fieldError(state, "check_out"), `c-out-${sessionId}`)}
              />
            </Field>
          </div>
          <ReasonTextarea id={`c-reason-${sessionId}`} label="Motivo de la corrección" error={fieldError(state, "reason")} />
          <Field label="Notas" htmlFor={`c-notes-${sessionId}`} error={fieldError(state, "notes")}>
            <Textarea id={`c-notes-${sessionId}`} name="notes" maxLength={500} className="min-h-16" />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

/** Anulación de una sesión vigente (void_attendance). */
export function VoidSessionForm({ action, sessionId }: { action: FormAction; sessionId: string }) {
  return (
    <ActionForm
      action={action}
      submitLabel="Anular registro"
      pendingLabel="Anulando…"
      variant="danger"
      confirmMessage="¿Anular este registro? Se conservará con estado «Anulado»."
    >
      {(state) => (
        <>
          <input type="hidden" name="session_id" value={sessionId} />
          <p className="text-sm text-gray-600">El registro no se borra: se conserva como «Anulado» y deja de sumar tiempo.</p>
          <ReasonTextarea id={`v-reason-${sessionId}`} label="Motivo de la anulación" error={fieldError(state, "reason")} />
        </>
      )}
    </ActionForm>
  );
}

/** Justificación de una incidencia calculada (incident_notes). */
export function IncidentNoteForm({
  action,
  assignmentId,
  incidentType,
  currentNote,
}: {
  action: FormAction;
  assignmentId: string;
  incidentType: IncidentType;
  currentNote: string | null;
}) {
  const id = `note-${assignmentId}-${incidentType}`;
  return (
    <ActionForm action={action} submitLabel={currentNote ? "Actualizar justificación" : "Guardar justificación"} resetOnSuccess={false}>
      {(state) => (
        <>
          <input type="hidden" name="assignment_id" value={assignmentId} />
          <input type="hidden" name="incident_type" value={incidentType} />
          <Field label="Justificación" htmlFor={id} required error={fieldError(state, "note")}>
            <Textarea id={id} name="note" required minLength={3} maxLength={1000} className="min-h-16" defaultValue={currentNote ?? ""} {...aria(fieldError(state, "note"), id)} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}
