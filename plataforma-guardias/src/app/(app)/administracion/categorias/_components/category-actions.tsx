"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

type SimpleAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

function useSubmit(action: SimpleAction, confirmMessage?: string) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
  return { state, formAction, pending, onSubmit };
}

/** Activar o desactivar (en lugar de borrar). */
export function CategoryActiveForm({ action, categoryId, active, inUse }: { action: SimpleAction; categoryId: number; active: boolean; inUse: number }) {
  const { state, formAction, pending, onSubmit } = useSubmit(
    action,
    active && inUse > 0 ? `La usan ${inUse} ${inUse === 1 ? "instalación" : "instalaciones"}; la conservarán. ¿Desactivar la categoría?` : undefined,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="category_id" value={categoryId} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <FormMessage state={state} />
      <Button type="submit" variant={active ? "outline" : "primary"} disabled={pending} aria-disabled={pending}>
        {pending ? "Guardando…" : active ? "Desactivar categoría" : "Activar categoría"}
      </Button>
    </form>
  );
}

/** Eliminación definitiva (solo si ninguna instalación la usa). */
export function CategoryDeleteForm({ action, categoryId }: { action: SimpleAction; categoryId: number }) {
  const { state, formAction, pending, onSubmit } = useSubmit(action, "¿Eliminar definitivamente esta categoría? Esta acción no se puede deshacer.");
  const err = state && !state.ok ? (state.fieldErrors?.confirm ?? null) : null;
  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="category_id" value={categoryId} />
      <Field label="Escribe ELIMINAR para confirmar" htmlFor="category-delete-confirm" required error={err}>
        <Input id="category-delete-confirm" name="confirm" required autoComplete="off" pattern="ELIMINAR" aria-invalid={err ? true : undefined} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="danger" disabled={pending} aria-disabled={pending}>
        {pending ? "Eliminando…" : "Eliminar categoría"}
      </Button>
    </form>
  );
}
