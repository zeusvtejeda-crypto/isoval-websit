"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { useActionForm } from "@/lib/admin/use-action-form";
import { resetAccountPassword } from "../actions";
import { OneTimePassword } from "./one-time-password";
import { PasswordFields } from "./password-fields";

/** Restablece una contraseña temporal; la generada se muestra una sola vez. */
export function ResetPasswordForm({ userId, email }: { userId: string; email: string | null }) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(resetAccountPassword, {
    confirm: () => "¿Restablecer la contraseña? La contraseña actual dejará de funcionar.",
  });
  const [formKey, setFormKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setFormKey((k) => k + 1);
  }
  const generated = state?.ok ? state.data?.generatedPassword : null;

  return (
    <div className="space-y-3">
      {state?.ok ? <FormMessage state={state} /> : null}
      {generated ? <OneTimePassword password={generated} email={email ?? undefined} /> : null}
      <form key={formKey} action={formAction} onSubmit={onSubmit} className="space-y-3">
        <input type="hidden" name="user_id" value={userId} />
        <PasswordFields idPrefix={`reset-${userId}`} error={fieldError("password")} />
        {state && !state.ok ? <FormMessage state={state} /> : null}
        <Button type="submit" variant="outline" disabled={pending} aria-disabled={pending}>
          {pending ? "Restableciendo…" : "Restablecer contraseña temporal"}
        </Button>
      </form>
    </div>
  );
}
