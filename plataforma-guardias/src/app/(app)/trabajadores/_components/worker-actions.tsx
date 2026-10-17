"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import type { ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";
import { REASON_MAX, REASON_MIN } from "@/lib/validation/worker";

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
export function WorkerActiveForm({ action, workerId, active }: { action: SimpleAction; workerId: string; active: boolean }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const onSubmit = makeSubmitHandler(formAction, pending);
  const err = state && !state.ok ? state.fieldErrors?.reason : null;

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="worker_id" value={workerId} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <Field
        label={active ? "Motivo de la desactivación" : "Motivo de la reactivación"}
        htmlFor="active-reason"
        required
        error={err}
        hint={active ? "Desactivar conserva el historial; la persona ya no podrá asignarse a nuevas guardias." : undefined}
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
        {pending ? "Guardando…" : active ? "Desactivar trabajador" : "Reactivar trabajador"}
      </Button>
    </form>
  );
}

/** Eliminación definitiva (solo administración y sin relaciones). */
export function WorkerDeleteForm({ action, workerId }: { action: SimpleAction; workerId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const onSubmit = makeSubmitHandler(formAction, pending, "¿Eliminar definitivamente este registro? Esta acción no se puede deshacer.");
  const err = (name: string) => (state && !state.ok ? (state.fieldErrors?.[name] ?? null) : null);

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="worker_id" value={workerId} />
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
