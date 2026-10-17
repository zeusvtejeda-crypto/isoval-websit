"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { TIMEZONE_CHOICES, timezoneChoiceLabel } from "@/lib/admin/catalogs";
import { REASON_MAX, REASON_MIN } from "@/lib/admin/form";
import { invalidProps, useActionForm } from "@/lib/admin/use-action-form";
import { saveStateTimezone, setStateCoverage } from "../actions";

/** Motivo breve para los controles compactos de la lista (queda en la bitácora). */
export function CompactReasonInput({ id, error }: { id: string; error: string | null }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        Motivo del cambio<span className="text-red-700"> *</span>
      </label>
      <Input
        id={id}
        name="reason"
        required
        minLength={REASON_MIN}
        maxLength={REASON_MAX}
        autoComplete="off"
        className="py-2 text-sm"
        {...invalidProps(error, id)}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : (
        <p className="text-xs text-gray-600">Queda en la bitácora.</p>
      )}
    </div>
  );
}

/**
 * «Cobertura activa» (states.enabled). El interruptor abre la confirmación
 * con el motivo; al guardar se envía el valor contrario al actual y la página
 * se vuelve a cargar con el estado guardado.
 */
export function StateCoverageSwitch({ stateId, stateName, enabled }: { stateId: number; stateName: string; enabled: boolean }) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(setStateCoverage);
  const [open, setOpen] = useState(false);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setOpen(false);
  }
  const panelId = `state-coverage-${stateId}`;
  const reasonError = fieldError("reason");
  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-1">
      <input type="hidden" name="state_id" value={stateId} />
      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Cobertura en ${stateName}: ${enabled ? "activa" : "inactiva"}. Cambiar`}
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-disabled={pending}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm font-medium text-gray-900 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-brand-700 disabled:cursor-wait"
      >
        <span
          aria-hidden="true"
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
            enabled ? "bg-brand-700" : "bg-gray-300",
          )}
        >
          <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", enabled ? "translate-x-5" : "translate-x-0.5")} />
        </span>
        <span>{pending ? "Guardando…" : enabled ? "Activa" : "Inactiva"}</span>
      </button>
      {open ? (
        <div id={panelId} className="space-y-2">
          <CompactReasonInput id={`${panelId}-reason`} error={reasonError} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" className="min-h-11" disabled={pending} aria-disabled={pending}>
              {pending ? "Guardando…" : enabled ? "Desactivar cobertura" : "Activar cobertura"}
            </Button>
            <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
      {state && !state.ok && !reasonError ? <FormMessage state={state} /> : null}
      {state?.ok ? (
        <p role="status" className="text-xs text-gray-600">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** Zona horaria por omisión de la entidad (lista de zonas de México). */
export function StateTimezoneForm({ stateId, stateName, value }: { stateId: number; stateName: string; value: string }) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(saveStateTimezone);
  const [selected, setSelected] = useState(value);
  const [saved, setSaved] = useState(value);
  // Si la página trae un valor nuevo (tras guardar o recargar), se adopta.
  if (value !== saved) {
    setSaved(value);
    setSelected(value);
  }
  const known = TIMEZONE_CHOICES.some((t) => t.value === value);
  const id = `state-tz-${stateId}`;
  const error = fieldError("default_timezone");
  const changed = selected !== value;

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-1">
      <input type="hidden" name="state_id" value={stateId} />
      <label htmlFor={id} className="sr-only">
        Zona horaria por omisión de {stateName}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          id={id}
          name="default_timezone"
          value={selected}
          onChange={(e) => setSelected(e.currentTarget.value)}
          className="w-auto min-w-0 max-w-full flex-1 py-2 text-sm"
          {...invalidProps(error, id)}
        >
          {known ? null : (
            <option value={value} disabled>
              {value} (guardada; no está en la lista de México)
            </option>
          )}
          {TIMEZONE_CHOICES.map((t) => (
            <option key={t.value} value={t.value}>
              {timezoneChoiceLabel(t.value)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline" size="sm" className="min-h-11" disabled={pending || !changed} aria-disabled={pending || !changed}>
          {pending ? "Guardando…" : "Guardar zona"}
        </Button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {/* El motivo solo se pide cuando hay un cambio por guardar. */}
      {changed ? <CompactReasonInput id={`${id}-reason`} error={fieldError("reason")} /> : null}
      {state && !state.ok && !error && !fieldError("reason") ? <FormMessage state={state} /> : null}
      {state?.ok ? (
        <p role="status" className="text-xs text-gray-600">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
