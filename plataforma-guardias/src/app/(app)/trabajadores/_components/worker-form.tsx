"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Checkbox, Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/states";
import {
  EMPLOYEE_NUMBER_MAX,
  NAME_MAX,
  NAME_MIN,
  PRIVACY_NOTE,
  PRIVATE_DATA_NOTE,
  REASON_MAX,
  REASON_MIN,
  TEXT_MAX,
  USUAL_SHIFT_OPTIONS,
} from "@/lib/validation/worker";

export type WorkerFormAction = (prev: ActionResult<{ id: string }> | null, formData: FormData) => Promise<ActionResult<{ id: string }>>;

export type WorkerFormDefaults = {
  full_name: string;
  state_id: string;
  municipality_id: string;
  facility_id: string;
  area: string;
  position: string;
  usual_shift: string;
  active: boolean;
  employee_number: string;
  phone: string;
};

type StateOption = { id: number; name: string; enabled: boolean };
type MunicipalityOption = { id: number; state_id: number; name: string };
type FacilityOption = { id: string; official_name: string };

function invalidProps(error: string | null | undefined, id: string) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

/**
 * Alta y edición de trabajadores. Formularios breves, objetivos táctiles
 * grandes y mensajes con texto. No limpia lo capturado si el servidor rechaza.
 */
export function WorkerForm({
  action,
  workerId,
  defaults,
  states,
  municipalities,
  facilities,
  allowNoFacility,
  showPrivate,
  cancelHref,
}: {
  action: WorkerFormAction;
  workerId?: string;
  defaults: WorkerFormDefaults;
  states: StateOption[];
  municipalities: MunicipalityOption[];
  facilities: FacilityOption[];
  /** Administración puede dejar al trabajador sin instalación de adscripción. */
  allowNoFacility: boolean;
  /** Mostrar campos privados (número de trabajador y teléfono). */
  showPrivate: boolean;
  cancelHref: string;
}) {
  const isEdit = Boolean(workerId);
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(action, null);
  const [stateId, setStateId] = useState(defaults.state_id);
  const [municipalityId, setMunicipalityId] = useState(defaults.municipality_id);
  const stateMunicipalities = municipalities.filter((m) => String(m.state_id) === stateId);
  const enabledStates = states.filter((s) => s.enabled);
  const otherStates = states.filter((s) => !s.enabled);
  const legacyShift = Boolean(defaults.usual_shift) && !(USUAL_SHIFT_OPTIONS as readonly string[]).includes(defaults.usual_shift);
  const shiftDefault = legacyShift ? "Otro" : defaults.usual_shift;
  const err = (name: string) => (state && !state.ok ? (state.fieldErrors?.[name] ?? null) : null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-5">
      {workerId ? <input type="hidden" name="id" value={workerId} /> : null}

      <Alert tone="info" title="Solo datos necesarios">
        {PRIVACY_NOTE}
      </Alert>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-lg font-semibold text-gray-900">Datos generales</legend>

        <Field label="Nombre completo" htmlFor="full_name" required error={err("full_name")}>
          <Input
            id="full_name"
            name="full_name"
            required
            minLength={NAME_MIN}
            maxLength={NAME_MAX}
            autoComplete="off"
            defaultValue={defaults.full_name}
            {...invalidProps(err("full_name"), "full_name")}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Estado (entidad federativa)" htmlFor="state_id" required error={err("state_id")}>
            <Select
              id="state_id"
              name="state_id"
              required
              value={stateId}
              onChange={(e) => {
                setStateId(e.currentTarget.value);
                setMunicipalityId("");
              }}
              {...invalidProps(err("state_id"), "state_id")}
            >
              <option value="" disabled>
                Elige el estado…
              </option>
              {enabledStates.length > 0 ? (
                <optgroup label="Con cobertura activa">
                  {enabledStates.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label={enabledStates.length > 0 ? "Otras entidades" : "Entidades"}>
                {otherStates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>

          <Field
            label="Municipio"
            htmlFor="municipality_id"
            error={err("municipality_id")}
            hint={stateId && stateMunicipalities.length === 0 ? "No hay municipios cargados para este estado." : undefined}
          >
            <Select
              id="municipality_id"
              name="municipality_id"
              value={municipalityId}
              onChange={(e) => setMunicipalityId(e.currentTarget.value)}
              disabled={stateMunicipalities.length === 0}
              {...invalidProps(err("municipality_id"), "municipality_id")}
            >
              <option value="">Sin municipio</option>
              {stateMunicipalities.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Instalación de adscripción"
          htmlFor="facility_id"
          required={!allowNoFacility}
          error={err("facility_id")}
          hint={allowNoFacility ? "Solo instalaciones activas. Puedes dejarla vacía." : "Solo aparecen las sedes que coordinas."}
        >
          <Select
            id="facility_id"
            name="facility_id"
            required={!allowNoFacility}
            defaultValue={defaults.facility_id}
            {...invalidProps(err("facility_id"), "facility_id")}
          >
            {allowNoFacility ? (
              <option value="">Sin instalación de adscripción</option>
            ) : (
              <option value="" disabled>
                Elige la instalación…
              </option>
            )}
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.official_name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Área" htmlFor="area" error={err("area")}>
            <Input id="area" name="area" maxLength={TEXT_MAX} defaultValue={defaults.area} {...invalidProps(err("area"), "area")} />
          </Field>
          <Field label="Puesto" htmlFor="position" error={err("position")}>
            <Input id="position" name="position" maxLength={TEXT_MAX} defaultValue={defaults.position} {...invalidProps(err("position"), "position")} />
          </Field>
        </div>

        <Field
          label="Turno habitual"
          htmlFor="usual_shift"
          error={err("usual_shift")}
          hint={legacyShift ? `Valor registrado anteriormente: «${defaults.usual_shift}». Al guardar quedará como «Otro» si no eliges otra opción.` : undefined}
        >
          <Select id="usual_shift" name="usual_shift" defaultValue={shiftDefault} {...invalidProps(err("usual_shift"), "usual_shift")}>
            <option value="">Sin especificar</option>
            {USUAL_SHIFT_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <Checkbox name="active" value="1" defaultChecked={defaults.active} label="Activo" />
          <p className="text-sm text-gray-500">Desactiva en lugar de borrar: el historial se conserva y no podrá asignarse a nuevas guardias.</p>
        </div>
      </fieldset>

      {showPrivate ? (
        <fieldset className="space-y-4 rounded-card border border-gray-200 bg-gray-50 p-4">
          <legend className="px-1 text-lg font-semibold text-gray-900">Datos privados (opcionales)</legend>
          <p className="text-sm text-gray-600">{PRIVATE_DATA_NOTE}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Número de trabajador" htmlFor="employee_number" error={err("employee_number")}>
              <Input
                id="employee_number"
                name="employee_number"
                maxLength={EMPLOYEE_NUMBER_MAX}
                autoComplete="off"
                defaultValue={defaults.employee_number}
                {...invalidProps(err("employee_number"), "employee_number")}
              />
            </Field>
            <Field label="Teléfono" htmlFor="phone" error={err("phone")} hint="Dígitos, espacios, +, paréntesis o guiones.">
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                maxLength={20}
                autoComplete="off"
                defaultValue={defaults.phone}
                {...invalidProps(err("phone"), "phone")}
              />
            </Field>
          </div>
        </fieldset>
      ) : null}

      <Field
        label="Motivo del cambio"
        htmlFor="change_reason"
        required={isEdit}
        error={err("change_reason")}
        hint={isEdit ? "Queda en la bitácora junto con los valores anteriores." : "Si lo dejas vacío se registra «Alta de trabajador»."}
      >
        <Textarea
          id="change_reason"
          name="change_reason"
          required={isEdit}
          minLength={isEdit ? REASON_MIN : undefined}
          maxLength={REASON_MAX}
          className="min-h-16"
          {...invalidProps(err("change_reason"), "change_reason")}
        />
      </Field>

      <FormMessage state={state} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" disabled={pending} aria-disabled={pending}>
          {pending ? "Guardando…" : isEdit ? "Guardar cambios" : "Registrar trabajador"}
        </Button>
        <Link href={cancelHref} className={buttonClasses("outline", "lg")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
