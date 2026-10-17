"use client";

import { useEffect } from "react";

/** Registra el service worker (solo en producción o si se habilita explícitamente). */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const enabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "true";
    if (!enabled) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Sin service worker la app sigue funcionando en línea.
    });
  }, []);
  return null;
}
