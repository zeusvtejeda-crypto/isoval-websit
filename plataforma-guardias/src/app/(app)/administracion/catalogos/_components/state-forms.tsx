"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { TIMEZONE_CHOICES, timezoneChoiceLabel } from "@/lib/admin/catalogs";
import { invalidProps, useActionForm } from "@/lib/admin/use-action-form";
import { saveStateTimezone, setStateCoverage } from "../actions";

/**
 * Interruptor «Cobertura activa» (states.enabled). Envía el valor contrario
 * al actual; la página se vuelve a cargar con el estado guardado.
 */
export function StateCoverageSwitch({ stateId, stateName, enabled }: { stateId: number; stateName: string; enabled: boolean }) {
  const { state, formAction, pending, onSubmit } = useActionForm(setStateCoverage);
  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-1">
      <input type="hidden" name="state_id" value={stateId} />
      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
      <button
        type="submit"
        role="switch"
        aria-checked={enabled}
        aria-label={`Cobertura activa en ${stateName}`}
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
      {state && !state.ok ? <FormMessage state={state} /> : null}
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
        <Button type="submit" variant="outline" size="sm" className="min-h-11" disabled={pending || selected === value} aria-disabled={pending || selected === value}>
          {pending ? "Guardando…" : "Guardar zona"}
        </Button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {state && !state.ok && !error ? <FormMessage state={state} /> : null}
      {state?.ok ? (
        <p role="status" className="text-xs text-gray-600">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
