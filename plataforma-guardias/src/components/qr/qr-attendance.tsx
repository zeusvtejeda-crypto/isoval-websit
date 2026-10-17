"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { describeConfirmation } from "@/components/attendance/attendance-buttons";
import { useAttendanceAction, type AttendanceActionState } from "@/components/attendance/use-attendance-action";
import { useOnline } from "@/components/layout/connection-status";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { PRESENCE_DISCLAIMER } from "@/lib/presence/texts";
import { QR_EXPIRED_HINT, QR_NOT_PRESENCE, isExpiredQrMessage, nextQrAction, type QrAttendanceAction } from "@/lib/qr/core";

export type QrAttendanceProps = {
  assignmentId: string;
  qrToken: string;
  /** Según el servidor al abrir el código: ¿hay una entrada abierta en esta guardia? */
  hasOpenSession: boolean;
  /** Zona horaria de la sede (para mostrar la hora del servidor). */
  timeZone: string;
  /** Texto breve de la guardia (sede y punto) para la confirmación. */
  label: string;
};

const BUTTON_TEXT: Record<QrAttendanceAction, string> = {
  entrada: "Registrar entrada con código QR",
  salida: "Registrar salida con código QR",
};

/**
 * Registro de entrada o salida con el código QR escaneado. Usa la misma
 * ruta idempotente que los botones normales (POST /api/asistencia con qrToken):
 * nunca es optimista y un reintento sin respuesta reutiliza la solicitud.
 */
export function QrAttendance({ assignmentId, qrToken, hasOpenSession, timeZone, label }: QrAttendanceProps) {
  const online = useOnline();
  const { state, submit, sending } = useAttendanceAction();
  const [current, setCurrent] = useState<QrAttendanceAction>(hasOpenSession ? "salida" : "entrada");
  const [sent, setSent] = useState<QrAttendanceAction | null>(null);
  const busy = useRef(false);

  const outcome = state.phase === "confirmed" ? state.result.result : null;
  const next = nextQrAction(current, outcome);
  const saved = state.phase === "confirmed" && (outcome === "created" || outcome === "duplicate") && sent != null;
  // Estado de la entrada según la última respuesta confirmada (o la acción en curso).
  const openNow = saved ? sent === "entrada" : outcome === "already_open" ? true : outcome === "no_open_session" ? false : current === "salida";

  async function run(action: QrAttendanceAction) {
    if (busy.current || !online) return; // doble clic: una sola solicitud
    busy.current = true;
    setCurrent(action);
    setSent(action);
    try {
      await submit({ action, assignmentId, qrToken });
    } finally {
      busy.current = false;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={openNow ? "success" : "neutral"}>{openNow ? "Tienes una entrada abierta en esta guardia" : "Sin entrada abierta en esta guardia"}</Badge>
      </div>

      <QrFeedback state={state} sent={sent} timeZone={timeZone} label={label} online={online} sending={sending} onRetry={() => sent && void run(sent)} />

      {!online ? (
        <Alert tone="warning" title="Sin conexión">
          No es posible registrar sin conexión. Un registro solo cuenta cuando el servidor lo confirma; conéctate e inténtalo de nuevo.
        </Alert>
      ) : null}

      {next && state.phase !== "unconfirmed" ? (
        <Button size="xl" className="w-full" disabled={!online || sending} onClick={() => void run(next)}>
          {sending ? "Enviando…" : BUTTON_TEXT[next]}
        </Button>
      ) : null}

      {saved ? (
        <div className="space-y-2">
          <p className="text-gray-800">
            {sent === "entrada"
              ? "Para registrar tu salida más tarde, escanea de nuevo el código vigente o usa «Registrar entrada o salida»."
              : "Tu salida quedó registrada."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/mi-guardia" className={buttonClasses("outline", "lg")}>
              Ver mi guardia
            </Link>
            <Link href="/mi-historial" className={buttonClasses("outline", "lg")}>
              Ver mi historial
            </Link>
          </div>
        </div>
      ) : null}

      <div className="space-y-1 text-sm text-gray-700">
        <p>{PRESENCE_DISCLAIMER}</p>
        <p>{QR_NOT_PRESENCE}</p>
      </div>
    </div>
  );
}

function QrFeedback({
  state,
  sent,
  timeZone,
  label,
  online,
  sending,
  onRetry,
}: {
  state: AttendanceActionState;
  sent: QrAttendanceAction | null;
  timeZone: string;
  label: string;
  online: boolean;
  sending: boolean;
  onRetry: () => void;
}) {
  if (state.phase === "sending") {
    return (
      <p role="status" aria-live="polite" className="text-base font-medium text-gray-800">
        Enviando… espera la confirmación del servidor.
      </p>
    );
  }
  if (state.phase === "confirmed" && sent) {
    const f = describeConfirmation(sent, state.result, timeZone);
    const session = state.result.session;
    const at = (sent === "entrada" ? session?.check_in_at : session?.check_out_at) ?? state.result.serverTime;
    const stored = state.result.result === "created" || state.result.result === "duplicate";
    return (
      <div aria-live="polite" data-testid="qr-confirmation" data-action={sent} data-result={state.result.result} data-registered-at={stored ? at : undefined}>
        <Alert tone={f.tone} title={f.title}>
          <p className="text-base font-semibold">{f.text}</p>
          {f.detail ? <p>{f.detail}</p> : null}
          <p>Guardia: {label}</p>
          {stored ? <p>Método: Código QR.</p> : null}
        </Alert>
      </div>
    );
  }
  if (state.phase === "rejected") {
    const expired = isExpiredQrMessage(state.message);
    return (
      <div aria-live="assertive">
        <Alert tone="error" title={expired ? "El código QR caducó o no es válido" : "No se registró"}>
          <p>{state.message}</p>
          {expired ? <p className="font-semibold">{QR_EXPIRED_HINT}</p> : null}
        </Alert>
      </div>
    );
  }
  if (state.phase === "unconfirmed") {
    return (
      <div role="alert" className="space-y-2 rounded-xl border-2 border-amber-500 bg-amber-50 px-4 py-3 text-amber-950">
        <p className="text-lg font-bold">Registro NO confirmado</p>
        <p className="font-medium">El registro no se guardó o no pudo confirmarse. No lo des por hecho hasta ver la confirmación del servidor.</p>
        <p className="text-sm">{state.message}</p>
        {sent ? (
          <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={onRetry} disabled={!online || sending}>
            Reintentar envío
          </Button>
        ) : null}
        {!online ? <p className="text-sm">Podrás reintentar cuando vuelva la conexión.</p> : null}
      </div>
    );
  }
  return null;
}
