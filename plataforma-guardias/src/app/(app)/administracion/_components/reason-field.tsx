"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { Field, Textarea } from "@/components/ui/form";
import { REASON_MAX, REASON_MIN } from "@/lib/admin/form";
import { invalidProps } from "@/lib/admin/use-action-form";

/**
 * «Motivo del cambio» de los formularios de administración. Queda en la
 * bitácora con los valores anterior y nuevo, y se vacía tras guardar para que
 * no se reutilice sin querer en el siguiente cambio.
 */
export function ReasonField({
  id,
  state,
  error,
  label = "Motivo del cambio",
  hint = "Queda en la bitácora junto con los valores anteriores.",
  required = true,
  name = "reason",
  className,
}: {
  id: string;
  /** Resultado de la última acción: al guardar con éxito se vacía el campo. */
  state: ActionResult<unknown> | null;
  error?: string | null;
  label?: string;
  hint?: string;
  required?: boolean;
  name?: string;
  className?: string;
}) {
  const [key, setKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setKey((k) => k + 1);
  }
  return (
    <Field label={label} htmlFor={id} required={required} error={error} hint={hint} className={className}>
      <Textarea
        key={key}
        id={id}
        name={name}
        required={required}
        minLength={required ? REASON_MIN : undefined}
        maxLength={REASON_MAX}
        rows={2}
        className="min-h-16"
        {...invalidProps(error, id)}
      />
    </Field>
  );
}
