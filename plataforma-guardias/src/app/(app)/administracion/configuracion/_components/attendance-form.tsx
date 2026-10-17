"use client";

import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { CHECKIN_WINDOW_MAX, OPEN_SESSION_GRACE_MAX, type AttendanceSettings } from "@/lib/admin/settings";
import { invalidProps, useActionForm } from "@/lib/admin/use-action-form";
import { formatDuration } from "@/lib/time";
import { saveAttendanceSettings } from "../actions";
import { ReasonField } from "../../_components/reason-field";

export function AttendanceSettingsForm({ settings }: { settings: AttendanceSettings }) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(saveAttendanceSettings);
  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Ventana de entrada antes del inicio (minutos)"
          htmlFor="att-window"
          required
          error={fieldError("checkin_window_before_minutes")}
          hint={`Desde cuánto antes del inicio de la guardia se permite registrar la entrada. Actual: ${formatDuration(settings.checkin_window_before_minutes)}.`}
        >
          <Input
            id="att-window"
            name="checkin_window_before_minutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={CHECKIN_WINDOW_MAX}
            step={1}
            required
            defaultValue={settings.checkin_window_before_minutes}
            {...invalidProps(fieldError("checkin_window_before_minutes"), "att-window")}
          />
        </Field>
        <Field
          label="Margen para entradas abiertas (minutos)"
          htmlFor="att-grace"
          required
          error={fieldError("open_session_grace_minutes")}
          hint={`Tras el término de la guardia, tiempo en que la persona aún puede registrar su salida. Después, la entrada sin salida queda como «registro incompleto» para revisión. Actual: ${formatDuration(settings.open_session_grace_minutes)}.`}
        >
          <Input
            id="att-grace"
            name="open_session_grace_minutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={OPEN_SESSION_GRACE_MAX}
            step={1}
            required
            defaultValue={settings.open_session_grace_minutes}
            {...invalidProps(fieldError("open_session_grace_minutes"), "att-grace")}
          />
        </Field>
      </div>
      <ReasonField id="att-reason" state={state} error={fieldError("reason")} />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Guardando…" : "Guardar configuración de registro"}
      </Button>
    </form>
  );
}
