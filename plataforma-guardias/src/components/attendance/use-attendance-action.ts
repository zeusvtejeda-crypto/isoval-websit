"use client";

import { useCallback, useRef, useState } from "react";
import type { AttendanceApiResult } from "@/app/api/asistencia/route";

export type AttendanceActionState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "confirmed"; result: Extract<AttendanceApiResult, { ok: true }> }
  | { phase: "rejected"; message: string }
  /** No hubo respuesta del servidor: NO se sabe si se guardó. */
  | { phase: "unconfirmed"; message: string };

type Params = {
  action: "entrada" | "salida";
  assignmentId: string;
  notes?: string | null;
  reason?: string | null;
};

function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Envía un registro de entrada/salida con idempotencia:
 * - Un mismo "intento" reutiliza su requestId en cada reintento (doble clic,
 *   reconexión), así el servidor nunca duplica el registro.
 * - Tras una confirmación o rechazo se genera un requestId nuevo.
 * - Si no hay conexión o no llega respuesta, el estado es "unconfirmed":
 *   la interfaz NUNCA debe mostrarlo como guardado.
 */
export function useAttendanceAction() {
  const [state, setState] = useState<AttendanceActionState>({ phase: "idle" });
  const pendingKey = useRef<string | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const inFlight = useRef(false);

  const submit = useCallback(async (params: Params) => {
    if (inFlight.current) return; // bloquea doble clic mientras hay una solicitud en curso
    const key = `${params.action}:${params.assignmentId}`;
    let requestId = requestIds.current.get(key);
    if (!requestId) {
      requestId = newRequestId();
      requestIds.current.set(key, requestId);
    }
    pendingKey.current = key;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setState({
        phase: "unconfirmed",
        message: "Sin conexión: el registro NO se envió y no puede confirmarse. Inténtalo de nuevo cuando tengas conexión.",
      });
      return;
    }

    inFlight.current = true;
    setState({ phase: "sending" });
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20_000);
      const res = await fetch("/api/asistencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, requestId }),
        signal: controller.signal,
        cache: "no-store",
      });
      window.clearTimeout(timeout);
      let body: AttendanceApiResult | null = null;
      try {
        body = (await res.json()) as AttendanceApiResult;
      } catch {
        body = null;
      }
      if (!body) {
        setState({ phase: "unconfirmed", message: "No se recibió confirmación del servidor. Revisa tu historial antes de reintentar." });
        return;
      }
      if (body.ok) {
        requestIds.current.delete(key); // el siguiente intento será una solicitud nueva
        setState({ phase: "confirmed", result: body });
      } else {
        requestIds.current.delete(key);
        setState({ phase: "rejected", message: body.message });
      }
    } catch {
      // Se conserva el requestId: si se reintenta y el servidor sí lo guardó, devolverá "duplicate".
      setState({
        phase: "unconfirmed",
        message: "No se pudo confirmar el registro (sin respuesta del servidor). Puedes reintentar: no se duplicará.",
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  return { state, submit, reset, sending: state.phase === "sending" };
}
