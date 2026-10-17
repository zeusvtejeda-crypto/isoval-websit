"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Textarea } from "@/components/ui/form";
import { REASON_MAX, REASON_MIN } from "@/lib/admin/accounts";
import { invalidProps, useActionForm } from "@/lib/admin/use-action-form";
import { setAccountActive } from "../actions";

/**
 * Desactivar o reactivar una cuenta (motivo obligatorio). Si el estado en la
 * plataforma y el bloqueo en Auth no coinciden, ofrece corregirlo.
 */
export function AccountStatusForm({ userId, active, banned, isSelf }: { userId: string; active: boolean; banned: boolean; isSelf: boolean }) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(setAccountActive, {
    confirm: (data) =>
      data.get("active") === "0" ? "¿Desactivar esta cuenta o bloquear su inicio de sesión? La persona no podrá entrar hasta que la reactives." : null,
  });
  const reasonId = `status-reason-${userId}`;
  // Tras un cambio correcto se vacía el motivo para que no se reutilice en la acción contraria.
  const [formKey, setFormKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setFormKey((k) => k + 1);
  }

  if (isSelf && active) {
    return <p className="text-sm text-gray-700">No puedes desactivar tu propia cuenta. Pide a otra persona con rol de administración que lo haga si es necesario.</p>;
  }

  // Acción principal y, si hay inconsistencia con Auth, acción de corrección.
  const primary = active ? { value: "0", label: "Desactivar cuenta", variant: "danger" as const } : { value: "1", label: "Reactivar cuenta", variant: "primary" as const };
  const repair =
    active && banned
      ? { value: "1", label: "Desbloquear inicio de sesión" }
      : !active && !banned
        ? { value: "0", label: "Bloquear inicio de sesión" }
        : null;

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="user_id" value={userId} />
      <Field
        label="Motivo"
        htmlFor={reasonId}
        required
        error={fieldError("reason")}
        hint={`Obligatorio (mínimo ${REASON_MIN} caracteres). Queda en la bitácora.`}
      >
        <Textarea key={formKey} id={reasonId} name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX} rows={2} {...invalidProps(fieldError("reason"), reasonId)} />
      </Field>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="active" value={primary.value} variant={primary.variant} disabled={pending} aria-disabled={pending}>
          {pending ? "Guardando…" : primary.label}
        </Button>
        {repair ? (
          <Button type="submit" name="active" value={repair.value} variant="outline" disabled={pending} aria-disabled={pending}>
            {repair.label}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
