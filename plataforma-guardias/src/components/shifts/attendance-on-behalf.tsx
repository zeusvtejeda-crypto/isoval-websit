"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAttendanceAction } from "@/components/attendance/use-attendance-action";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/states";
import { formatDateTime } from "@/lib/time";

const MIN_REASON = 3;

/**
 * Registro de entrada o salida en nombre de otra persona (coordinación).
 * Usa POST /api/asistencia con idempotencia; la hora es la del servidor.
 * Nunca muestra como guardado un registro que el servidor no confirmó.
 * Un solo componente para ambos sentidos: así el mensaje de confirmación se
 * conserva cuando, tras actualizar, la entrada pasa a estar abierta.
 */
export function AttendanceOnBehalf({
  assignmentId,
  workerName,
  hasOpenSession,
  timezone,
}: {
  assignmentId: string;
  workerName: string;
  /** Con entrada abierta se ofrece la salida; si no, la entrada. */
  hasOpenSession: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { state, submit, sending, reset } = useAttendanceAction();
  const [localError, setLocalError] = useState<string | null>(null);
  const [lastMode, setLastMode] = useState<"entrada" | "salida">("entrada");
  const mode: "entrada" | "salida" = hasOpenSession ? "salida" : "entrada";
  const reasonId = `ob-reason-${assignmentId}`;
  const notesId = `ob-notes-${assignmentId}`;

  useEffect(() => {
    if (state.phase === "confirmed") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    const notes = String(data.get("notes") ?? "").trim();
    if (reason.length < MIN_REASON) {
      setLocalError(`Indica el motivo (mínimo ${MIN_REASON} caracteres).`);
      return;
    }
    setLocalError(null);
    setLastMode(mode);
    await submit({ action: mode, assignmentId, reason, notes: notes || null });
  }

  const label = mode === "entrada" ? `Registrar entrada de ${workerName}` : `Registrar salida de ${workerName}`;
  const confirmedOk = state.phase === "confirmed" && (state.result.result === "created" || state.result.result === "duplicate");
  const confirmedTime =
    state.phase === "confirmed" && state.result.session
      ? lastMode === "salida" && state.result.session.check_out_at
        ? state.result.session.check_out_at
        : state.result.session.check_in_at
      : null;

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-gray-600">
        Se guarda con la hora del servidor y queda como «Registrado por coordinación», con tu cuenta y el motivo.
      </p>
      <Field label="Motivo" htmlFor={reasonId} required error={localError}>
        <Textarea
          id={reasonId}
          name="reason"
          required
          minLength={MIN_REASON}
          maxLength={500}
          className="min-h-16"
          aria-invalid={localError ? true : undefined}
          aria-describedby={localError ? `${reasonId}-error` : undefined}
        />
      </Field>
      <Field label="Notas" htmlFor={notesId}>
        <Textarea id={notesId} name="notes" maxLength={500} className="min-h-16" />
      </Field>

      {state.phase === "confirmed" ? (
        <Alert tone={confirmedOk ? "success" : "warning"} title={confirmedOk ? "Confirmado por el servidor" : "Sin cambios"}>
          {state.result.message}
          {confirmedOk && confirmedTime ? ` Hora del servidor: ${formatDateTime(confirmedTime, timezone)}.` : null}
        </Alert>
      ) : null}
      {state.phase === "rejected" ? (
        <Alert tone="error" title="No se registró">
          {state.message}
        </Alert>
      ) : null}
      {state.phase === "unconfirmed" ? (
        <Alert tone="warning" title="Sin confirmar: no lo des por guardado">
          {state.message}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={mode === "entrada" ? "primary" : "secondary"} disabled={sending} aria-disabled={sending}>
          {sending ? "Enviando…" : label}
        </Button>
        {state.phase !== "idle" && state.phase !== "sending" ? (
          <Button type="button" variant="ghost" onClick={reset}>
            Ocultar mensaje
          </Button>
        ) : null}
      </div>
    </form>
  );
}
