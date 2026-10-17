"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AttendanceApiResult } from "@/app/api/asistencia/route";
import { useAttendanceAction, type AttendanceActionState } from "./use-attendance-action";
import { useOnline } from "@/components/layout/connection-status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/time";
import { PRESENCE_DISCLAIMER } from "@/lib/presence/texts";

export type AttendanceKind = "entrada" | "salida";

export type AttendanceButtonsProps = {
  /** Asignación a registrar. Con null solo se muestra el resultado del último envío (si lo hay). */
  assignmentId: string | null;
  /** Zona horaria de la sede (para mostrar la hora del servidor). */
  timeZone: string;
  /** Texto breve de la guardia (sede y punto) para el mensaje de confirmación. */
  label?: string;
  canCheckIn: boolean;
  canCheckOut: boolean;
  checkInDisabledReason?: string | null;
  checkOutDisabledReason?: string | null;
  showCheckIn?: boolean;
  showCheckOut?: boolean;
  className?: string;
};

type Sent = { action: AttendanceKind; assignmentId: string; notes: string | null; timeZone: string; label?: string };
type Confirmed = Extract<AttendanceApiResult, { ok: true }>;

type Feedback = { tone: "success" | "warning"; title: string; text: string; detail?: string };

/** Traduce la respuesta confirmada del servidor a un mensaje. Solo "created"/"duplicate" significan registro guardado. */
export function describeConfirmation(action: AttendanceKind, result: Confirmed, timeZone: string): Feedback {
  const session = result.session;
  switch (result.result) {
    case "created":
    case "duplicate": {
      const at = (action === "entrada" ? session?.check_in_at : session?.check_out_at) ?? result.serverTime;
      const what = action === "entrada" ? "Entrada registrada" : "Salida registrada";
      return {
        tone: "success",
        title: result.result === "duplicate" ? "Registro ya existente" : "Registro confirmado",
        text: `${what} a las ${formatTime(at, timeZone)} (hora del servidor)`,
        detail: result.result === "duplicate" ? "El servidor ya tenía este registro; no se duplicó." : undefined,
      };
    }
    case "already_open":
      return {
        tone: "warning",
        title: "No se registró otra entrada",
        text: session?.check_in_at
          ? `Ya tenías una entrada abierta en esta guardia desde las ${formatTime(session.check_in_at, timeZone)} (hora del servidor).`
          : result.message,
      };
    case "open_elsewhere":
      return { tone: "warning", title: "No se registró la entrada", text: result.message };
    case "no_open_session":
      return { tone: "warning", title: "No se registró la salida", text: result.message };
  }
}

/**
 * Botones grandes de entrada/salida. Nunca optimista: solo muestra
 * «registrada» cuando el servidor responde ok. Sin respuesta, muestra
 * «no confirmado» y permite reintentar con la misma solicitud (no duplica).
 */
export function AttendanceButtons({
  assignmentId,
  timeZone,
  label,
  canCheckIn,
  canCheckOut,
  checkInDisabledReason,
  checkOutDisabledReason,
  showCheckIn = true,
  showCheckOut = true,
  className,
}: AttendanceButtonsProps) {
  const router = useRouter();
  const online = useOnline();
  const { state, submit, sending } = useAttendanceAction();
  const [sent, setSent] = useState<Sent | null>(null);
  const busy = useRef(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const uid = useId();
  const notesId = `notas-${uid}`;
  const reasonId = `motivo-${uid}`;

  // Tras una respuesta del servidor se vuelve a pedir la página (estado real).
  useEffect(() => {
    if (state.phase !== "confirmed") return;
    if (notesRef.current) notesRef.current.value = "";
    router.refresh();
  }, [state, router]);

  async function run(params: Sent) {
    if (busy.current) return; // doble clic: una sola solicitud
    busy.current = true;
    setSent(params);
    try {
      await submit({ action: params.action, assignmentId: params.assignmentId, notes: params.notes });
    } finally {
      busy.current = false;
    }
  }

  function send(action: AttendanceKind) {
    if (!assignmentId || !online) return;
    const notes = notesRef.current?.value.trim() || null;
    void run({ action, assignmentId, notes, timeZone, label });
  }

  function retry() {
    if (sent && online) void run(sent);
  }

  const feedback = <AttendanceFeedback state={state} sent={sent} online={online} sending={sending} onRetry={retry} />;
  const hasFeedback = state.phase !== "idle" && (state.phase !== "confirmed" || sent != null);

  if (!assignmentId) {
    return hasFeedback ? (
      <div className={cn("space-y-3", className)}>
        {feedback}
        <p className="text-sm text-gray-600">{PRESENCE_DISCLAIMER}</p>
      </div>
    ) : null;
  }

  const inDisabled = !online || sending || !canCheckIn;
  const outDisabled = !online || sending || !canCheckOut;
  const reasons = online
    ? [showCheckIn && !canCheckIn ? checkInDisabledReason : null, showCheckOut && !canCheckOut ? checkOutDisabledReason : null].filter(
        (r): r is string => Boolean(r),
      )
    : [];
  const both = showCheckIn && showCheckOut;

  return (
    <div className={cn("space-y-3", className)}>
      {feedback}

      {!online ? (
        <Alert tone="warning" title="Sin conexión">
          No es posible registrar entrada ni salida sin conexión. Un registro solo cuenta cuando el servidor lo confirma; conéctate e
          inténtalo de nuevo.
        </Alert>
      ) : null}

      <div className={cn("grid gap-3", both && "sm:grid-cols-2")}>
        {showCheckIn ? (
          <Button
            size="xl"
            variant={canCheckIn ? "primary" : "outline"}
            className="w-full"
            disabled={inDisabled}
            aria-describedby={reasons.length ? reasonId : undefined}
            onClick={() => send("entrada")}
          >
            {sending && sent?.action === "entrada" ? "Enviando…" : "Registrar entrada"}
          </Button>
        ) : null}
        {showCheckOut ? (
          <Button
            size="xl"
            variant={canCheckOut ? "primary" : "outline"}
            className="w-full"
            disabled={outDisabled}
            aria-describedby={reasons.length ? reasonId : undefined}
            onClick={() => send("salida")}
          >
            {sending && sent?.action === "salida" ? "Enviando…" : "Registrar salida"}
          </Button>
        ) : null}
      </div>

      {reasons.length ? (
        <div id={reasonId} className="space-y-1 text-sm text-gray-700">
          {reasons.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </div>
      ) : null}

      <details className="rounded-xl border border-gray-200 bg-gray-50 px-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-gray-800">Agregar una nota (opcional)</summary>
        <div className="pb-3">
          <label htmlFor={notesId} className="mb-1 block text-sm text-gray-700">
            Nota para coordinación (máximo 500 caracteres)
          </label>
          <Textarea id={notesId} ref={notesRef} name="notas" maxLength={500} rows={3} disabled={sending} />
        </div>
      </details>

      <p className="text-sm text-gray-600">{PRESENCE_DISCLAIMER}</p>
    </div>
  );
}

function AttendanceFeedback({
  state,
  sent,
  online,
  sending,
  onRetry,
}: {
  state: AttendanceActionState;
  sent: Sent | null;
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
    const f = describeConfirmation(sent.action, state.result, sent.timeZone);
    return (
      <div aria-live="polite">
        <Alert tone={f.tone} title={f.title}>
          <p className="text-base font-semibold">{f.text}</p>
          {f.detail ? <p>{f.detail}</p> : null}
          {sent.label ? <p>Guardia: {sent.label}</p> : null}
        </Alert>
      </div>
    );
  }
  if (state.phase === "rejected") {
    return (
      <div aria-live="assertive">
        <Alert tone="error" title="No se registró">
          <p>{state.message}</p>
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
