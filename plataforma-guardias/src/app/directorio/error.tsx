"use client";

import { DirectoryRouteError } from "@/components/directory/route-error";

export default function DirectorioError({ error, retry }: { error: unknown; retry: () => void }) {
  return <DirectoryRouteError error={error} retry={retry} title="No se pudo cargar el directorio de instalaciones" />;
}
