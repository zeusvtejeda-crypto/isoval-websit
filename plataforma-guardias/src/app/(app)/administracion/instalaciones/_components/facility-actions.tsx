"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import type { ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";
import { REASON_MAX, REASON_MIN } from "@/lib/validation/facility";

type SimpleAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

function makeSubmitHandler(formAction: (data: FormData) => void, pending: boolean, confirmMessage?: string) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
}

/** Desactivar (en lugar de borrar) o reactivar, con motivo obligatorio. */
export function FacilityActiveForm({ action, facilityId, active }: { action: SimpleAction; facilityId: string; active: boolean }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const onSubmit = makeSubmitHandler(formAction, pending);
  const err = state && !state.ok ? state.fieldErrors?.reason : null;

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="facility_id" value={facilityId} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <Field
        label={active ? "Motivo de la desactivación" : "Motivo de la reactivación"}
        htmlFor="active-reason"
        required
        error={err}
        hint={active ? "Desactivar conserva el historial; deja de mostrarse en el directorio público y en las sedes activas." : undefined}
      >
        <Textarea
          id="active-reason"
          name="reason"
          required
          minLength={REASON_MIN}
          maxLength={REASON_MAX}
          className="min-h-16"
          aria-invalid={err ? true : undefined}
        />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant={active ? "outline" : "primary"} disabled={pending} aria-disabled={pending}>
        {pending ? "Guardando…" : active ? "Desactivar instalación" : "Reactivar instalación"}
      </Button>
    </form>
  );
}

/** Eliminación definitiva (solo sin relaciones). */
export function FacilityDeleteForm({ action, facilityId }: { action: SimpleAction; facilityId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const onSubmit = makeSubmitHandler(formAction, pending, "¿Eliminar definitivamente esta instalación? Esta acción no se puede deshacer.");
  const err = (name: string) => (state && !state.ok ? (state.fieldErrors?.[name] ?? null) : null);

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="facility_id" value={facilityId} />
      <Field label="Motivo de la eliminación" htmlFor="delete-reason" required error={err("reason")}>
        <Textarea
          id="delete-reason"
          name="reason"
          required
          minLength={REASON_MIN}
          maxLength={REASON_MAX}
          className="min-h-16"
          aria-invalid={err("reason") ? true : undefined}
        />
      </Field>
      <Field label="Escribe ELIMINAR para confirmar" htmlFor="delete-confirm" required error={err("confirm")}>
        <Input id="delete-confirm" name="confirm" required autoComplete="off" pattern="ELIMINAR" aria-invalid={err("confirm") ? true : undefined} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="danger" disabled={pending} aria-disabled={pending}>
        {pending ? "Eliminando…" : "Eliminar definitivamente"}
      </Button>
    </form>
  );
}
