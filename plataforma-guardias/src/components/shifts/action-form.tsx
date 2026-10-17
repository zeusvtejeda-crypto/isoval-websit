"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import type { ActionResult } from "@/lib/actions";
import type { FormAction } from "@/lib/shifts/types";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "danger" | "outline";

/** Mensaje de error de un campo a partir del resultado de la acción. */
export function fieldError(state: ActionResult<unknown> | null, name: string): string | null {
  if (!state || state.ok) return null;
  return state.fieldErrors?.[name] ?? null;
}

/**
 * Formulario conectado a una Server Action con useActionState.
 * - Funciona sin JavaScript (envío nativo a la acción).
 * - Con JavaScript no limpia los campos si hay error y bloquea el doble envío.
 * - Muestra el mensaje de resultado con texto (éxito o error).
 */
export function ActionForm<T = undefined>({
  action,
  children,
  submitLabel,
  pendingLabel = "Guardando…",
  variant = "primary",
  className,
  resetOnSuccess = true,
  confirmMessage,
  footer,
}: {
  action: FormAction<T>;
  children: ReactNode | ((state: ActionResult<T> | null) => ReactNode);
  submitLabel: string;
  pendingLabel?: string;
  variant?: Variant;
  className?: string;
  resetOnSuccess?: boolean;
  /** Pide confirmación antes de enviar (acciones delicadas). */
  confirmMessage?: string;
  footer?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionResult<T> | null, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Se envía manualmente para conservar lo capturado si el servidor rechaza.
    event.preventDefault();
    if (pending) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className={cn("space-y-3", className)}>
      {typeof children === "function" ? children(state) : children}
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant={variant} disabled={pending} aria-disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {footer}
      </div>
    </form>
  );
}
