"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { useOnline } from "@/components/layout/connection-status";
import { Turnstile } from "@/components/security/turnstile";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState | null, FormData>(login, null);
  const online = useOnline();
  return (
    <form action={action} className="mt-6 space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <input type="hidden" name="next" value={next} />
      <Field label="Correo electrónico" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Field label="Contraseña" htmlFor="password" required>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Turnstile action="login" resetKey={state} />
      <FormMessage state={state} />
      {!online ? <p className="text-sm font-medium text-amber-800">Sin conexión: no es posible iniciar sesión.</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending || !online}>
        {pending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
