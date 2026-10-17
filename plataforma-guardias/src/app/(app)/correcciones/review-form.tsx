"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Textarea } from "@/components/ui/form";
import { reviewCorrection, type ReviewState } from "./actions";

/**
 * Aprobar o rechazar una solicitud. Rechazar exige notas (se valida también
 * en el servidor y en la base de datos).
 */
export function ReviewForm({ requestId, canApprove, sede }: { requestId: string; canApprove: boolean; sede: string | null }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewCorrection, null);
  const [notes, setNotes] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const notesId = `notas-${requestId}`;
  const notesError = clientError ?? (state && !state.ok ? state.fieldErrors?.notes : null) ?? null;

  return (
    <form
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value === "rechazar" && notes.trim().length < 3) {
          e.preventDefault();
          setClientError("Para rechazar, explica el motivo en las notas (mínimo 3 caracteres).");
          return;
        }
        setClientError(null);
      }}
    >
      <input type="hidden" name="requestId" value={requestId} />
      {sede ? <input type="hidden" name="sede" value={sede} /> : null}
      <Field label="Notas de revisión" htmlFor={notesId} hint="Obligatorias para rechazar. La persona verá estas notas." error={notesError}>
        <Textarea
          id={notesId}
          name="notes"
          maxLength={1000}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            if (clientError) setClientError(null);
          }}
          aria-invalid={notesError ? true : undefined}
          aria-describedby={`${notesId}-hint${notesError ? ` ${notesId}-error` : ""}`}
        />
      </Field>
      <FormMessage state={state && !state.ok && !state.fieldErrors?.notes ? state : null} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="aprobar" size="lg" disabled={pending || !canApprove}>
          {pending ? "Procesando…" : "Aprobar"}
        </Button>
        <Button type="submit" name="decision" value="rechazar" variant="danger" size="lg" disabled={pending}>
          {pending ? "Procesando…" : "Rechazar"}
        </Button>
      </div>
      {!canApprove ? <p className="text-sm text-gray-700">Esta solicitud no se puede aprobar tal como está (ver aviso); puedes rechazarla con una nota.</p> : null}
      <p className="text-xs text-gray-600">Al aprobar se crea una nueva versión del registro y la original se conserva con su historial.</p>
    </form>
  );
}
