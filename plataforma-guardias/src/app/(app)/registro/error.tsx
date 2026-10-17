"use client";

import { RouteError } from "@/components/attendance/route-error";

export default function RegistroError({ error, retry }: { error: unknown; retry: () => void }) {
  return <RouteError error={error} retry={retry} title="No se pudo cargar el registro de entrada y salida" />;
}
