"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/cn";
import { MapErrorBoundary } from "./map-error-boundary";
import type { FacilityMapProps } from "./map-types";

/** Marcador de posición mientras se descarga el mapa (o antes de mostrarlo). */
export function MapPlaceholder({ className, text = "Cargando mapa…" }: { className?: string; text?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center rounded-card border border-gray-200 bg-gray-100 p-4 text-center text-gray-700",
        className,
      )}
    >
      {text}
    </div>
  );
}

// Leaflet necesita el navegador: el mapa nunca se renderiza en el servidor.
const FacilityMap = dynamic(() => import("./facility-map"), {
  ssr: false,
  loading: () => <MapPlaceholder className="h-full min-h-48" />,
});

/**
 * Mapa con carga diferida dentro de un límite de error: si falla, se muestra
 * un aviso y el resto de la página (la lista) sigue funcionando.
 */
export function MapPanel({
  onError,
  onReset,
  className,
  ...props
}: FacilityMapProps & { onError?: () => void; onReset?: () => void }) {
  return (
    <div className={cn("relative", className)}>
      <MapErrorBoundary onError={onError} onReset={onReset}>
        <FacilityMap {...props} className="h-full w-full" />
      </MapErrorBoundary>
    </div>
  );
}

/** Aviso para navegadores sin JavaScript (se usa junto al panel del mapa). */
export function MapNoScript() {
  return (
    <noscript>
      <p className="mb-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
        El mapa necesita JavaScript. Puedes consultar todas las instalaciones en la lista.
      </p>
    </noscript>
  );
}
