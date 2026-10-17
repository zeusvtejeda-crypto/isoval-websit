import { LinkButton } from "@/components/ui/button";

export default function NoAccess() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-bold text-gray-900">Sin acceso</h1>
      <p className="mt-2 text-gray-700">Tu cuenta no tiene permiso para ver esta sección. Si crees que es un error, contacta a administración.</p>
      <LinkButton href="/" className="mt-6">
        Ir al inicio
      </LinkButton>
    </main>
  );
}
