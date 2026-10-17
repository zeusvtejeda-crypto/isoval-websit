"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useOnline } from "@/components/layout/connection-status";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { qrScreenNotice, svgDataUri, type QrIssueErrorKind } from "@/lib/qr/core";
import type { QrIssueResult } from "@/lib/qr/rpc";
import { isDueForRenewal, localExpiry, msUntilRenewal, retryDelayMs, secondsLeft } from "@/lib/qr/timing";

type ActiveCode = { token: string; url: string; svg: string; ttlSeconds: number; expiresLocalMs: number };
type IssueError = { kind: QrIssueErrorKind; message: string; at: number };

export type QrShiftDetails = {
  title: string;
  facilityName: string;
  meetingPoint: string;
  /** Horario ya formateado en la zona de la sede. */
  schedule: string;
  /** Zona horaria legible de la sede. */
  zone: string;
};

export type QrDisplayProps = {
  shiftId: string;
  /** Server Action que emite el código (reverifica sesión y permisos). */
  issueAction: (shiftId: string) => Promise<QrIssueResult>;
  details: QrShiftDetails;
  /** Texto con la ventana en que el servidor emite códigos (hora de la sede). */
  windowText?: string;
};

// Reloj de 1 s compartido (sin setState en efectos ni Date.now() en el render).
let tickNow = 0;
let tickTimer: number | undefined;
const tickListeners = new Set<() => void>();

function subscribeTick(callback: () => void) {
  tickListeners.add(callback);
  if (tickListeners.size === 1) {
    tickNow = Date.now();
    tickTimer = window.setInterval(() => {
      tickNow = Date.now();
      tickListeners.forEach((l) => l());
    }, 1_000);
  }
  return () => {
    tickListeners.delete(callback);
    if (tickListeners.size === 0) window.clearInterval(tickTimer);
  };
}

function useSecondClock(): number {
  return useSyncExternalStore(
    subscribeTick,
    () => tickNow || (tickNow = Date.now()),
    () => 0,
  );
}

const noopSubscribe = () => () => {};

function useFullscreenSupported(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => typeof document.documentElement.requestFullscreen === "function" && document.fullscreenEnabled !== false,
    () => false,
  );
}

/** Mantiene la pantalla encendida mientras la página está visible (si el navegador lo permite). */
function useScreenWakeLock() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator) || !navigator.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      if (disposed || sentinel || document.visibilityState !== "visible") return;
      try {
        const s = await navigator.wakeLock.request("screen");
        if (disposed) {
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
        s.addEventListener("release", () => {
          if (sentinel === s) sentinel = null;
        });
      } catch {
        // Sin permiso o sin soporte: la pantalla puede apagarse sola.
      }
    };
    const onVisibility = () => void acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, []);
}

const OFFLINE_MESSAGE = "No hubo respuesta del servidor. Revisa la conexión de este dispositivo.";

/**
 * Pantalla del código QR para el punto de reunión. Pide un código al montar y
 * lo renueva antes de que caduque mientras la pestaña está visible. Un código
 * caducado nunca se muestra como vigente.
 */
export function QrDisplay({ shiftId, issueAction, details, windowText }: QrDisplayProps) {
  const online = useOnline();
  const now = useSecondClock();
  const fullscreenSupported = useFullscreenSupported();
  const [code, setCode] = useState<ActiveCode | null>(null);
  const [error, setError] = useState<IssueError | null>(null);
  const [manual, setManual] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const panelRef = useRef<HTMLDivElement>(null);

  useScreenWakeLock();

  const request = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const sentAt = Date.now();
    let result: QrIssueResult | undefined;
    try {
      result = await issueAction(shiftId);
    } catch {
      result = undefined;
    } finally {
      inFlight.current = false;
    }
    if (!alive.current) return;
    if (result?.ok) {
      setCode({
        token: result.token,
        url: result.url,
        svg: result.svg,
        ttlSeconds: result.ttlSeconds,
        expiresLocalMs: localExpiry(result, sentAt),
      });
      setError(null);
    } else if (result) {
      // Con la guardia cancelada, sin permiso o fuera de la ventana no se deja un código a la vista.
      if (result.kind !== "unknown") setCode(null);
      setError({ kind: result.kind, message: result.message, at: Date.now() });
    } else {
      setError({ kind: "offline", message: OFFLINE_MESSAGE, at: Date.now() });
    }
    setManual(false);
  }, [issueAction, shiftId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Primer código al montar, renovación automática (antes de caducar) y reintentos tras un error.
  useEffect(() => {
    let delay: number | null;
    if (error) delay = retryDelayMs(error.kind);
    else if (code) delay = msUntilRenewal(code.expiresLocalMs, code.ttlSeconds, Date.now());
    else delay = 0;
    if (delay == null) return;
    const timer = window.setTimeout(() => {
      // Pestaña oculta o sin conexión: se renueva al volver (ver efecto siguiente).
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void request();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [code, error, request]);

  // Al volver a la pestaña o recuperar la conexión, renueva si hace falta.
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (error && retryDelayMs(error.kind) === null) return;
      if (!code || error || isDueForRenewal(code.expiresLocalMs, code.ttlSeconds, Date.now())) void request();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [code, error, request]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement != null && document.fullscreenElement === panelRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function renewNow() {
    if (inFlight.current) return;
    setManual(true);
    void request();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panelRef.current?.requestFullscreen();
    } catch {
      // El navegador rechazó la pantalla completa; la página sigue funcionando igual.
    }
  }

  const left = code && now ? Math.min(code.ttlSeconds, secondsLeft(code.expiresLocalMs, now)) : 0;
  const expired = code != null && now !== 0 && left === 0;
  const visibleCode = code && !expired ? code : null;
  const state = visibleCode ? "ready" : expired ? "expired" : error ? "error" : "loading";

  const controls = (
    <div className="flex flex-wrap gap-2">
      <Button size="lg" onClick={renewNow} disabled={!online || manual}>
        {manual ? "Renovando…" : "Renovar ahora"}
      </Button>
      {fullscreenSupported ? (
        <Button size="lg" variant="outline" onClick={() => void toggleFullscreen()}>
          {fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <div
        ref={panelRef}
        className={cn(
          "rounded-card border-4 border-black bg-white p-4 text-black sm:p-6",
          // En pantallas anchas el código va en su propia columna: la cuenta regresiva queda a la vista.
          "lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-x-8 lg:gap-y-4",
          fullscreen && "overflow-auto rounded-none border-0 lg:place-content-center",
        )}
      >
        <div className="text-center lg:col-start-2 lg:row-start-1 lg:self-end lg:text-left">
          <p className="text-2xl font-extrabold leading-tight sm:text-3xl">{details.title}</p>
          <p className="mt-1 text-lg font-semibold sm:text-xl">{details.facilityName}</p>
          <p className="text-lg sm:text-xl">
            Punto de reunión: <strong>{details.meetingPoint}</strong>
          </p>
          <p className="text-base sm:text-lg">{details.schedule}</p>
          <p className="text-sm sm:text-base">Hora de la sede: {details.zone}</p>
        </div>

        <div
          data-testid="qr-code"
          data-state={state}
          data-token={visibleCode?.token}
          data-url={visibleCode?.url}
          className={cn(
            "mx-auto mt-4 aspect-square w-full lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:mt-0",
            fullscreen ? "max-w-[min(100%,80vh)]" : "max-w-[min(100%,70vh)] lg:max-w-[min(100%,62vh)]",
          )}
        >
          {visibleCode ? (
            // eslint-disable-next-line @next/next/no-img-element -- SVG generado en el servidor como data URI; no admite optimización.
            <img
              src={svgDataUri(visibleCode.svg)}
              alt="Código QR para registrar entrada o salida en esta guardia"
              width={600}
              height={600}
              className="block h-full w-full [image-rendering:pixelated]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center rounded-xl border-4 border-dashed border-gray-500 bg-gray-50 p-6 text-center">
              <p className="text-2xl font-bold">
                {state === "loading" ? "Generando código…" : state === "expired" ? "Código caducado" : "Sin código vigente"}
              </p>
              <p className="mt-2 text-lg">
                {state === "loading"
                  ? "Espera un momento."
                  : state === "expired"
                    ? "Este código ya no sirve. Toca «Renovar ahora» para mostrar uno nuevo."
                    : "Revisa el aviso de abajo."}
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 text-center lg:col-start-2 lg:row-start-2 lg:mt-0 lg:self-start lg:text-left">
          <p className="text-5xl font-black tabular-nums sm:text-6xl" aria-hidden="true">
            {visibleCode ? `${left} s` : "—"}
          </p>
          <p className="mt-2 text-lg font-bold sm:text-xl">{qrScreenNotice(left)}</p>
          <p className="mt-1 text-base sm:text-lg">Escanéalo con la cámara de tu teléfono e inicia sesión con tu cuenta. El código se renueva solo.</p>
          {/* En pantalla completa los controles quedan dentro del panel. */}
          {fullscreen ? <div className="mt-4 flex justify-center lg:justify-start">{controls}</div> : null}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {state === "ready" ? "Código vigente en pantalla." : state === "expired" ? "El código caducó." : state === "error" ? "No hay código vigente." : ""}
      </p>

      {fullscreen ? null : controls}

      <IssueAlerts online={online} error={error} hasValidCode={visibleCode != null} secondsLeft={left} windowText={windowText} />
    </div>
  );
}

function IssueAlerts({
  online,
  error,
  hasValidCode,
  secondsLeft: left,
  windowText,
}: {
  online: boolean;
  error: IssueError | null;
  hasValidCode: boolean;
  secondsLeft: number;
  windowText?: string;
}) {
  const remaining = hasValidCode ? `El código en pantalla sigue vigente ${left} s; después deja de funcionar.` : "No hay un código vigente en pantalla.";
  if (!online) {
    return (
      <Alert tone="warning" title="Sin conexión">
        <p>No se puede obtener un código nuevo sin conexión. {remaining}</p>
        <p>Se intentará de nuevo en cuanto vuelva la conexión.</p>
      </Alert>
    );
  }
  if (!error) return null;
  switch (error.kind) {
    case "offline":
      return (
        <Alert tone="warning" title="No se pudo renovar el código (sin conexión)">
          <p>
            {error.message} {remaining}
          </p>
          <p>Se reintentará automáticamente.</p>
        </Alert>
      );
    case "window":
      return (
        <Alert tone="warning" title="Fuera de la ventana de registro">
          <p>{error.message}</p>
          {windowText ? <p>{windowText}</p> : null}
          <p>Se volverá a intentar cada minuto mientras esta pantalla esté abierta.</p>
        </Alert>
      );
    case "cancelled":
      return (
        <Alert tone="error" title="Guardia cancelada">
          <p>{error.message} No se pueden mostrar códigos de registro.</p>
        </Alert>
      );
    default:
      return (
        <Alert tone="error" title="No se pudo generar el código">
          <p>{error.message}</p>
          {error.kind === "unknown" ? <p>Se reintentará automáticamente; también puedes tocar «Renovar ahora».</p> : null}
        </Alert>
      );
  }
}
