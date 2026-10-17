"use client";

import { Field, Textarea } from "@/components/ui/form";
import type { FormAction } from "@/lib/shifts/types";
import type { ShiftStatus } from "@/lib/attendance/calc";
import { ActionForm, fieldError } from "./action-form";
import { Disclosure } from "./disclosure";

function ReasonField({ id, label, error, hint }: { id: string; label: string; error: string | null; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} required error={error} hint={hint}>
      <Textarea
        id={id}
        name="reason"
        required
        minLength={5}
        maxLength={500}
        className="min-h-16"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
    </Field>
  );
}

/**
 * Cambios de estado de la guardia: cancelar (motivo obligatorio), finalizar
 * manualmente (opcional, solo si ya inició) o reactivar.
 */
export function ShiftStatusActions({
  action,
  shiftId,
  storedStatus,
  started,
  openSessions,
}: {
  action: FormAction;
  shiftId: string;
  /** Estado guardado (no el calculado). */
  storedStatus: ShiftStatus;
  started: boolean;
  /** Personas con entrada abierta en la guardia. */
  openSessions: number;
}) {
  return (
    <div className="space-y-3">
      {storedStatus !== "cancelada" ? (
        <Disclosure summary="Cancelar guardia" tone="danger">
          <ActionForm
            action={action}
            submitLabel="Cancelar guardia"
            pendingLabel="Cancelando…"
            variant="danger"
            confirmMessage="¿Confirmas la cancelación de esta guardia?"
          >
            {(state) => (
              <>
                <input type="hidden" name="shift_id" value={shiftId} />
                <input type="hidden" name="status" value="cancelada" />
                {openSessions > 0 ? (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    Hay {openSessions} {openSessions === 1 ? "persona" : "personas"} con entrada abierta. Las entradas no se cierran automáticamente:
                    registra su salida si corresponde.
                  </p>
                ) : null}
                <ReasonField id={`cancel-${shiftId}`} label="Motivo de la cancelación" error={fieldError(state, "reason")} />
              </>
            )}
          </ActionForm>
        </Disclosure>
      ) : null}

      {storedStatus === "programada" && started ? (
        <Disclosure summary="Marcar como finalizada">
          <ActionForm action={action} submitLabel="Marcar como finalizada" variant="secondary">
            {(state) => (
              <>
                <input type="hidden" name="shift_id" value={shiftId} />
                <input type="hidden" name="status" value="finalizada" />
                <p className="text-sm text-gray-600">
                  Opcional: la guardia se marca como finalizada aunque no haya llegado su hora de término. No cierra entradas abiertas.
                </p>
                <ReasonField id={`finish-${shiftId}`} label="Motivo" error={fieldError(state, "reason")} />
              </>
            )}
          </ActionForm>
        </Disclosure>
      ) : null}

      {storedStatus === "cancelada" || storedStatus === "finalizada" ? (
        <Disclosure summary={storedStatus === "cancelada" ? "Reactivar guardia" : "Reabrir guardia"}>
          <ActionForm action={action} submitLabel={storedStatus === "cancelada" ? "Reactivar guardia" : "Reabrir guardia"} variant="secondary">
            {(state) => (
              <>
                <input type="hidden" name="shift_id" value={shiftId} />
                <input type="hidden" name="status" value="programada" />
                <p className="text-sm text-gray-600">El estado volverá a calcularse según el horario (programada, en curso o finalizada).</p>
                <ReasonField id={`reopen-${shiftId}`} label="Motivo" error={fieldError(state, "reason")} />
              </>
            )}
          </ActionForm>
        </Disclosure>
      ) : null}
    </div>
  );
}
