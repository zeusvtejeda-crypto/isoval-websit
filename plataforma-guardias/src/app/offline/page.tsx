export const metadata = { title: "Sin conexión" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-bold text-gray-900">Sin conexión</h1>
      <p className="mt-2 text-gray-700">
        No hay conexión a internet. Mientras tanto <strong>no se puede registrar ni confirmar</strong> ninguna entrada o
        salida. Cuando vuelva la conexión, recarga la página.
      </p>
    </main>
  );
}
