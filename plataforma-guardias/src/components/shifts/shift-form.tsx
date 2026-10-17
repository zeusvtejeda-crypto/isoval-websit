"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/states";
import { buttonClasses } from "@/components/ui/button";
import { addDays, describeShiftClock, formatDayLong, isValidDay } from "@/lib/shifts/dates";
import { formatClockDuration, timezoneLabel } from "@/lib/shifts/format";
import type { FacilityRef, FormAction, WorkerOption } from "@/lib/shifts/types";
import { ActionForm, fieldError } from "./action-form";

export type ShiftFormDefaults = {
  title: string;
  meeting_point: string;
  date: string;
  start_time: string;
  end_time: string;
  responsible_worker_id: string;
  min_staff: string;
  max_staff: string;
  instructions: string;
};

function invalidProps(error: string | null, id: string) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

/** Formulario de alta y edición de guardias. */
export function ShiftForm({
  action,
  shiftId,
  facility,
  workers,
  defaults,
  cancelHref,
  changeFacilityHref,
  extraResponsible,
}: {
  action: FormAction<{ id: string }>;
  shiftId?: string;
  facility: FacilityRef;
  workers: WorkerOption[];
  defaults: ShiftFormDefaults;
  cancelHref: string;
  changeFacilityHref?: string | null;
  /** Responsable actual que ya no está en la lista (inactivo u otra sede). */
  extraResponsible?: { id: string; full_name: string } | null;
}) {
  const isEdit = Boolean(shiftId);
  const [date, setDate] = useState(defaults.date);
  const [startTime, setStartTime] = useState(defaults.start_time);
  const [endTime, setEndTime] = useState(defaults.end_time);
  const clock = describeShiftClock(startTime, endTime);

  return (
    <ActionForm<{ id: string }>
      action={action}
      submitLabel={isEdit ? "Guardar cambios" : "Crear guardia"}
      resetOnSuccess={false}
      footer={
        <Link href={cancelHref} className={buttonClasses("outline")}>
          Cancelar
        </Link>
      }
    >
      {(state) => {
        const err = (name: string) => fieldError(state, name);
        return (
          <>
            {shiftId ? <input type="hidden" name="id" value={shiftId} /> : null}
            <input type="hidden" name="facility_id" value={facility.id} />

            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-sm text-gray-600">Sede</p>
              <p className="font-semibold text-gray-900">{facility.official_name}</p>
              <p className="text-sm text-gray-600">Horas en {timezoneLabel(facility.timezone)}</p>
              {changeFacilityHref ? (
                <Link href={changeFacilityHref} className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand-800 underline underline-offset-2">
                  Cambiar sede
                </Link>
              ) : null}
              {err("facility_id") ? <p className="text-sm font-medium text-red-700">{err("facility_id")}</p> : null}
            </div>

            <Field label="Título" htmlFor="title" error={err("title")} hint="Por ejemplo: «Guardia nocturna acceso norte».">
              <Input id="title" name="title" maxLength={200} defaultValue={defaults.title} {...invalidProps(err("title"), "title")} />
            </Field>

            <Field label="Punto de reunión o acceso" htmlFor="meeting_point" required error={err("meeting_point")}>
              <Input
                id="meeting_point"
                name="meeting_point"
                required
                minLength={2}
                maxLength={200}
                defaultValue={defaults.meeting_point}
                {...invalidProps(err("meeting_point"), "meeting_point")}
              />
            </Field>

            <Field label="Fecha" htmlFor="date" required error={err("date")}>
              <Input
                id="date"
                name="date"
                type="date"
                required
                defaultValue={defaults.date}
                onChange={(e) => setDate(e.currentTarget.value)}
                {...invalidProps(err("date"), "date")}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Hora de inicio" htmlFor="start_time" required error={err("start_time")}>
                <Input
                  id="start_time"
                  name="start_time"
                  type="time"
                  required
                  defaultValue={defaults.start_time}
                  onChange={(e) => setStartTime(e.currentTarget.value)}
                  {...invalidProps(err("start_time"), "start_time")}
                />
              </Field>
              <Field label="Hora de término" htmlFor="end_time" required error={err("end_time")}>
                <Input
                  id="end_time"
                  name="end_time"
                  type="time"
                  required
                  defaultValue={defaults.end_time}
                  onChange={(e) => setEndTime(e.currentTarget.value)}
                  {...invalidProps(err("end_time"), "end_time")}
                />
              </Field>
            </div>

            {clock?.crossesMidnight ? (
              <Alert tone="warning" title="Termina al día siguiente">
                {startTime === endTime ? "La hora de término es igual a la de inicio: la guardia dura 24 horas. " : null}
                {isValidDay(date) ? `Termina el ${formatDayLong(addDays(date, 1))} a las ${endTime}. ` : null}
                Duración: {formatClockDuration(clock.durationMinutes)}.
              </Alert>
            ) : clock ? (
              <p className="text-sm text-gray-600" aria-live="polite">
                Duración: {formatClockDuration(clock.durationMinutes)}.
              </p>
            ) : null}

            <Field
              label="Responsable"
              htmlFor="responsible_worker_id"
              error={err("responsible_worker_id")}
              hint={workers.length === 0 ? "No hay trabajadores activos registrados en esta sede." : "Trabajadores activos de la sede."}
            >
              <Select
                id="responsible_worker_id"
                name="responsible_worker_id"
                defaultValue={defaults.responsible_worker_id}
                {...invalidProps(err("responsible_worker_id"), "responsible_worker_id")}
              >
                <option value="">Sin responsable</option>
                {extraResponsible ? <option value={extraResponsible.id}>{extraResponsible.full_name} (responsable actual)</option> : null}
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.full_name} · {w.internal_code}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cupo mínimo" htmlFor="min_staff" required error={err("min_staff")} hint="Personas necesarias para cubrir la guardia.">
                <Input
                  id="min_staff"
                  name="min_staff"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={1000}
                  step={1}
                  required
                  defaultValue={defaults.min_staff}
                  {...invalidProps(err("min_staff"), "min_staff")}
                />
              </Field>
              <Field label="Cupo máximo" htmlFor="max_staff" error={err("max_staff")} hint="Déjalo vacío si no hay límite.">
                <Input
                  id="max_staff"
                  name="max_staff"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000}
                  step={1}
                  defaultValue={defaults.max_staff}
                  {...invalidProps(err("max_staff"), "max_staff")}
                />
              </Field>
            </div>

            <Field label="Instrucciones" htmlFor="instructions" error={err("instructions")}>
              <Textarea id="instructions" name="instructions" maxLength={2000} defaultValue={defaults.instructions} {...invalidProps(err("instructions"), "instructions")} />
            </Field>

            {isEdit ? (
              <Field label="Motivo del cambio" htmlFor="change_reason" required error={err("change_reason")} hint="Queda en la bitácora junto con los valores anteriores.">
                <Textarea
                  id="change_reason"
                  name="change_reason"
                  required
                  minLength={5}
                  maxLength={500}
                  className="min-h-16"
                  {...invalidProps(err("change_reason"), "change_reason")}
                />
              </Field>
            ) : null}
          </>
        );
      }}
    </ActionForm>
  );
}
