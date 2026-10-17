"use client";

import { RouteError } from "@/components/attendance/route-error";

/** Respaldo para cualquier vista autenticada que no tenga su propio error.tsx. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <RouteError error={error} retry={retry} />;
}
