"use client";

import { DirectoryRouteError } from "@/components/directory/route-error";

export default function FichaError({ error, retry }: { error: unknown; retry: () => void }) {
  return <DirectoryRouteError error={error} retry={retry} title="No se pudo cargar la ficha de la instalación" />;
}
