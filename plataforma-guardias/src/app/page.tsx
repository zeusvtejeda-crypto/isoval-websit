import { redirect } from "next/navigation";
import { LinkButton } from "@/components/ui/button";
import { Disclaimer } from "@/components/layout/disclaimer";
import { getSessionUser, homePathFor } from "@/lib/auth";

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.role));

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-800">Plataforma independiente</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Guardias y Directorio de Instalaciones</h1>
        <p className="mt-3 text-lg text-gray-700">
          Consulta el directorio público de instalaciones o inicia sesión para registrar tus guardias.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <LinkButton href="/directorio" size="lg" variant="outline">
            Ver directorio de instalaciones
          </LinkButton>
          <LinkButton href="/login" size="lg">
            Iniciar sesión
          </LinkButton>
        </div>
        <p className="mt-8 rounded-xl bg-white p-4 text-sm text-gray-700 ring-1 ring-gray-200">
          Esta plataforma <strong>no es una aplicación oficial del IMSS</strong>. El directorio público solo muestra
          instalaciones; nunca muestra trabajadores, teléfonos personales ni participación en guardias.
        </p>
      </main>
      <Disclaimer />
    </div>
  );
}
