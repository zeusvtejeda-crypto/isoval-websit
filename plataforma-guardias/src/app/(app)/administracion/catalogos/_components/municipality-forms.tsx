"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormMessage, Input, Select } from "@/components/ui/form";
import { MUNICIPALITY_NAME_MAX, TIMEZONE_CHOICES, effectiveTimezone, timezoneChoiceLabel } from "@/lib/admin/catalogs";
import { invalidProps, useActionForm } from "@/lib/admin/use-action-form";
import { createMunicipality, saveMunicipalityTimezone } from "../actions";

type MunicipalityProps = { id: number; name: string; inegiCode: string; timezone: string | null };

function TimezoneOptions({ stateTimezone, current }: { stateTimezone: string; current?: string | null }) {
  const known = !current || TIMEZONE_CHOICES.some((t) => t.value === current);
  return (
    <>
      <option value="">Igual que la entidad ({stateTimezone})</option>
      {known ? null : (
        <option value={current ?? ""} disabled>
          {current} (guardada; no está en la lista de México)
        </option>
      )}
      {TIMEZONE_CHOICES.map((t) => (
        <option key={t.value} value={t.value}>
          {timezoneChoiceLabel(t.value)}
        </option>
      ))}
    </>
  );
}

/**
 * Zona horaria propia de un municipio. El formulario solo se dibuja al
 * abrirlo, para que una entidad con cientos de municipios cargue ligera.
 */
export function MunicipalityTimezoneEditor({
  stateId,
  stateTimezone,
  municipality,
}: {
  stateId: number;
  stateTimezone: string;
  municipality: MunicipalityProps;
}) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(saveMunicipalityTimezone);
  const [open, setOpen] = useState(false);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setOpen(false);
  }
  const effective = effectiveTimezone(municipality.timezone, stateTimezone);
  const id = `mun-tz-${municipality.id}`;
  const error = fieldError("timezone");

  return (
    <div className="space-y-1">
      <p className="text-sm">
        <span className="font-mono">{effective.value}</span>
        {effective.inherited ? <span className="text-gray-600"> (de la entidad)</span> : <span className="text-gray-600"> (propia)</span>}
      </p>
      {open ? (
        <form action={formAction} onSubmit={onSubmit} className="space-y-2">
          <input type="hidden" name="state_id" value={stateId} />
          <input type="hidden" name="municipality_id" value={municipality.id} />
          <label htmlFor={id} className="sr-only">
            Zona horaria de {municipality.name} (clave {municipality.inegiCode})
          </label>
          <Select id={id} name="timezone" defaultValue={municipality.timezone ?? ""} className="py-2 text-sm" {...invalidProps(error, id)}>
            <TimezoneOptions stateTimezone={stateTimezone} current={municipality.timezone} />
          </Select>
          {error ? (
            <p id={`${id}-error`} className="text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}
          {state && !state.ok && !error ? <FormMessage state={state} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" className="min-h-11" disabled={pending} aria-disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
            <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <>
          {state?.ok ? (
            <p role="status" className="text-xs text-gray-600">
              {state.message}
            </p>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 px-2"
            onClick={() => setOpen(true)}
            aria-label={`Cambiar zona horaria de ${municipality.name} (clave ${municipality.inegiCode})`}
          >
            Cambiar zona
          </Button>
        </>
      )}
    </div>
  );
}

/** Alta de un municipio en la entidad elegida. */
export function NewMunicipalityForm({ stateId, stateName, stateTimezone }: { stateId: number; stateName: string; stateTimezone: string }) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(createMunicipality);
  const [formKey, setFormKey] = useState(0);
  // La casilla de nombre repetido aparece cuando el servidor lo detecta y se
  // mantiene hasta que el alta se guarda.
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setFormKey((k) => k + 1);
      setShowDuplicate(false);
    } else if (state?.fieldErrors?.allow_duplicate_name) {
      setShowDuplicate(true);
    }
  }
  const nameError = fieldError("name");
  const duplicateError = fieldError("allow_duplicate_name");

  return (
    <form key={formKey} action={formAction} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="state_id" value={stateId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Clave INEGI del municipio"
          htmlFor="new-mun-code"
          required
          error={fieldError("inegi_code")}
          hint="3 dígitos, p. ej. 001. Si escribes 7 se guarda como 007."
        >
          <Input
            id="new-mun-code"
            name="inegi_code"
            required
            inputMode="numeric"
            pattern="\d{1,3}"
            maxLength={3}
            autoComplete="off"
            className="font-mono"
            {...invalidProps(fieldError("inegi_code"), "new-mun-code")}
          />
        </Field>
        <Field label="Nombre oficial" htmlFor="new-mun-name" required error={nameError} className="sm:col-span-2" hint="Como aparece en el catálogo del INEGI.">
          <Input
            id="new-mun-name"
            name="name"
            required
            minLength={2}
            maxLength={MUNICIPALITY_NAME_MAX}
            autoComplete="off"
            {...invalidProps(nameError, "new-mun-name")}
          />
        </Field>
      </div>
      <Field
        label="Zona horaria"
        htmlFor="new-mun-tz"
        error={fieldError("timezone")}
        hint={`Solo si difiere de la de ${stateName}.`}
      >
        <Select id="new-mun-tz" name="timezone" defaultValue="" {...invalidProps(fieldError("timezone"), "new-mun-tz")}>
          <TimezoneOptions stateTimezone={stateTimezone} />
        </Select>
      </Field>
      {showDuplicate ? (
        <div>
          <Checkbox
            name="allow_duplicate_name"
            label="Confirmo que es un municipio distinto con el mismo nombre oficial (se distinguirá por su clave INEGI)."
            aria-invalid={duplicateError ? true : undefined}
            aria-describedby={duplicateError ? "new-mun-duplicate-error" : undefined}
          />
          {duplicateError ? (
            <p id="new-mun-duplicate-error" className="text-sm font-medium text-red-700">
              {duplicateError}
            </p>
          ) : null}
        </div>
      ) : null}
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Agregando…" : "Agregar municipio"}
      </Button>
    </form>
  );
}
