import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { Disclaimer } from "@/components/layout/disclaimer";
import { getSessionUser, homePathFor } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { Alert } from "@/components/ui/states";
import { safeNextPath } from "@/lib/security/safe-next";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.role));
  const { next } = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <h1 className="text-2xl font-bold text-gray-900">Iniciar sesión</h1>
        <p className="mt-1 text-gray-600">Usa la cuenta que te dio administración.</p>
        {!isSupabaseConfigured() ? (
          <Alert tone="warning" className="mt-4" title="Configuración pendiente">
            Faltan las variables de Supabase. Revisa el README.
          </Alert>
        ) : null}
        <LoginForm next={safeNextPath(next) ?? ""} />
      </main>
      <Disclaimer />
    </div>
  );
}
