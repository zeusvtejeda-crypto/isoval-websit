"use client";

import { useActionState } from "react";
import { requestCorrection, type CorrectionState } from "./actions";
import { useOnline } from "@/components/layout/connection-status";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";

export type CorrectionSessionOption = {
  id: string;
  label: string;
  /** Ya tiene una solicitud pendiente (solo se permite una por registro). */
  pending: boolean;
};

/** Horas permitidas (zona de la sede): la guardia ±12 h y nunca en el futuro. */
export type CorrectionRange = { min: string; max: string; hint: string };

export function CorrectionForm({
  assignmentId,
  timeZone,
  sessions,
  range,
}: {
  assignmentId: string;
  timeZone: string;
  sessions: CorrectionSessionOption[];
  range?: CorrectionRange;
}) {
  const [state, action, pending] = useActionState<CorrectionState, FormData>(requestCorrection, null);
  const online = useOnline();
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const values = state && !state.ok ? (state.values ?? {}) : {};
  const id = (name: string) => `${name}-${assignmentId}`;
  const firstAvailable = sessions.find((s) => !s.pending)?.id ?? "";

  return (
    // La clave cambia en cada envío: tras un error se conservan los valores; tras el éxito se limpia.
    <form key={state?.submittedAt ?? "inicial"} action={action} className="space-y-4" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />

      <Field
        label="Registro a corregir"
        htmlFor={id("sessionId")}
        required
        error={errors.sessionId}
        hint="Si no pudiste registrar, elige «No tengo registro» e indica entrada y salida."
      >
        <Select id={id("sessionId")} name="sessionId" defaultValue={values.sessionId ?? firstAvailable}>
          {sessions.map((s) => (
            <option key={s.id} value={s.id} disabled={s.pending}>
              {s.label}
              {s.pending ? " (ya tiene una solicitud pendiente)" : ""}
            </option>
          ))}
          <option value="">No tengo registro: solicitar uno nuevo</option>
        </Select>
      </Field>

      {range ? <p className="text-sm text-gray-700">Horas permitidas: {range.hint}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Hora de entrada correcta"
          htmlFor={id("checkIn")}
          error={errors.checkIn}
          hint={`Hora de la sede (${timeZone}). Déjala vacía si es correcta.`}
        >
          <Input
            id={id("checkIn")}
            name="checkIn"
            type="datetime-local"
            min={range?.min}
            max={range?.max}
            defaultValue={values.checkIn ?? ""}
            aria-invalid={errors.checkIn ? true : undefined}
          />
        </Field>
        <Field
          label="Hora de salida correcta"
          htmlFor={id("checkOut")}
          error={errors.checkOut}
          hint={`Hora de la sede (${timeZone}). Déjala vacía si es correcta.`}
        >
          <Input
            id={id("checkOut")}
            name="checkOut"
            type="datetime-local"
            min={range?.min}
            max={range?.max}
            defaultValue={values.checkOut ?? ""}
            aria-invalid={errors.checkOut ? true : undefined}
          />
        </Field>
      </div>

      <Field label="Motivo" htmlFor={id("reason")} required error={errors.reason} hint="Mínimo 5 caracteres. Explica qué pasó.">
        <Textarea
          id={id("reason")}
          name="reason"
          minLength={5}
          maxLength={500}
          required
          defaultValue={values.reason ?? ""}
          aria-invalid={errors.reason ? true : undefined}
        />
      </Field>

      <FormMessage state={state} />
      {!online ? <p className="text-sm font-medium text-amber-800">Sin conexión: no es posible enviar la solicitud.</p> : null}

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending || !online}>
        {pending ? "Enviando…" : "Enviar solicitud de corrección"}
      </Button>
    </form>
  );
}
