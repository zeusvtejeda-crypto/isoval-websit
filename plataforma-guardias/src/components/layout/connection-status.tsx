"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** true si el navegador reporta conexión. En el servidor se asume en línea. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/** Franja visible cuando no hay conexión. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="alert" className="no-print bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-950">
      Sin conexión. Los datos mostrados pueden no estar actualizados y no se pueden confirmar registros.
    </div>
  );
}

// Reloj compartido (actualiza cada 15 s) sin setState dentro de efectos.
let clockNow = 0;
let clockTimer: number | undefined;
const clockListeners = new Set<() => void>();

function subscribeClock(callback: () => void) {
  clockListeners.add(callback);
  if (clockListeners.size === 1) {
    clockNow = Date.now();
    clockTimer = window.setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 15_000);
  }
  return () => {
    clockListeners.delete(callback);
    if (clockListeners.size === 0) window.clearInterval(clockTimer);
  };
}

/** Marca de tiempo actual (ms) que se refresca cada 15 s; 0 durante el render del servidor. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeClock,
    () => clockNow || (clockNow = Date.now()),
    () => 0,
  );
}

/**
 * "Actualizado a las HH:mm:ss" con tiempo relativo. Recibe la marca del servidor
 * (ISO) del momento en que se generaron los datos.
 */
export function LastUpdated({ at, timeZone }: { at: string; timeZone?: string }) {
  const now = useNow();
  const date = new Date(at);
  const time = new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: timeZone || undefined,
  }).format(date);
  const seconds = now === 0 ? 0 : Math.max(0, Math.round((now - date.getTime()) / 1000));
  const relative = seconds < 60 ? "hace menos de un minuto" : `hace ${Math.floor(seconds / 60)} min`;
  return (
    <p className="text-sm text-gray-600" aria-live="polite">
      Última actualización: <time dateTime={at}>{time}</time> ({relative})
    </p>
  );
}
