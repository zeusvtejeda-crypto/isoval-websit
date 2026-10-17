"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useOnline } from "./connection-status";

/**
 * Vuelve a pedir los datos del servidor cada `seconds` mientras la pestaña está
 * visible y hay conexión. No guarda datos privados en el navegador.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const online = useOnline();
  useEffect(() => {
    if (!online) return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds, online]);
  return null;
}
