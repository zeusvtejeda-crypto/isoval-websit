"use client";

import { RouteError } from "@/components/attendance/route-error";

export default function InicioError({ error, retry }: { error: unknown; retry: () => void }) {
  return <RouteError error={error} retry={retry} title="No se pudo cargar el resumen de hoy" />;
}
