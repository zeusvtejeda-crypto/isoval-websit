"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";

type TurnstileApi = {
  render: (el: HTMLElement, options: { sitekey: string; language?: string; action?: string }) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** ¿Hay verificación anti-robots configurada? (Cloudflare Turnstile, opcional). */
export const turnstileEnabled = SITE_KEY.length > 0;

/**
 * Verificación anti-robots de Cloudflare Turnstile. Solo aparece si se define
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY; agrega al formulario el campo
 * «cf-turnstile-response», que el servidor envía a Supabase Auth. Cambiar
 * `resetKey` (p. ej. tras un intento fallido) pide un código nuevo: cada uno
 * sirve una sola vez.
 */
export function Turnstile({ action, resetKey }: { action: string; resetKey?: unknown }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  const render = () => {
    if (!box.current || !window.turnstile || widget.current) return;
    widget.current = window.turnstile.render(box.current, { sitekey: SITE_KEY, language: "es", action });
  };

  useEffect(() => {
    render();
    return () => {
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resetKey !== undefined && widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, [resetKey]);

  if (!turnstileEnabled) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={render} />
      <div ref={box} className="min-h-[65px]" aria-label="Verificación anti-robots" />
    </>
  );
}
