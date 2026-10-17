"use client";

import { useActionState } from "react";
import { changePassword } from "./actions";
import type { ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

export function PasswordForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(changePassword, null);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Contraseña actual" htmlFor="current" required error={err("current")}>
        <Input id="current" name="current" type="password" autoComplete="current-password" required aria-invalid={Boolean(err("current"))} />
      </Field>
      <Field label="Nueva contraseña" htmlFor="password" required error={err("password")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required aria-invalid={Boolean(err("password"))} />
      </Field>
      <Field label="Confirma la nueva contraseña" htmlFor="confirm" required error={err("confirm")}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required aria-invalid={Boolean(err("confirm"))} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Cambiar contraseña"}
      </Button>
    </form>
  );
}
