import { startTransition, useActionState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/actions";

export type FormAction<T = undefined> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

/** FormData del formulario incluyendo el botón que lo envió (name/value). */
export function formDataWithSubmitter(form: HTMLFormElement, submitter: HTMLElement | null): FormData {
  const button = submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : null;
  try {
    return new FormData(form, button);
  } catch {
    const data = new FormData(form);
    if (button?.name) data.append(button.name, button.value);
    return data;
  }
}

/**
 * Estado de un formulario con Server Action. Envía con `startTransition` en
 * lugar del envío nativo para que React no borre lo capturado si el servidor
 * devuelve errores de validación. Sin JavaScript, el `action` del formulario
 * sigue funcionando.
 */
export function useActionForm<T = undefined>(action: FormAction<T>, options?: { confirm?: (data: FormData) => string | null }) {
  const [state, formAction, pending] = useActionState<ActionResult<T> | null, FormData>(action, null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
    const data = formDataWithSubmitter(event.currentTarget, submitter);
    const question = options?.confirm?.(data);
    if (question && !window.confirm(question)) return;
    startTransition(() => formAction(data));
  };

  const fieldError = (field: string): string | null => (state && !state.ok ? (state.fieldErrors?.[field] ?? null) : null);

  return { state, formAction, pending, onSubmit, fieldError };
}

/** Atributos de accesibilidad para un control con error. */
export function invalidProps(error: string | null | undefined, id: string) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}
