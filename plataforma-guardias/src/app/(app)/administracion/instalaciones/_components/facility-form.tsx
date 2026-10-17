"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Checkbox, Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/states";
import {
  ADDRESS_MAX,
  DESCRIPTION_MAX,
  MEXICO_BOUNDS,
  MEXICO_TIMEZONES,
  NOTES_MAX,
  OFFICIAL_NAME_MAX,
  OFFICIAL_NAME_MIN,
  OFFICIAL_SOURCES_NOTICE,
  PHONE_MAX,
  REASON_MAX,
  REASON_MIN,
  SCHEDULE_MAX,
  SOURCE_MAX,
  TOLERANCE_MAX,
  TOLERANCE_MIN,
  UNIT_KEY_MAX,
  URL_MAX,
  VERIFICATION_LABELS,
  checkCoordinates,
  defaultTimezoneFor,
  isMexicoTimezone,
  osmLink,
  parseDecimalText,
  type VerificationStatus,
} from "@/lib/validation/facility";

export type FacilityFormAction = (prev: ActionResult<{ id: string }> | null, formData: FormData) => Promise<ActionResult<{ id: string }>>;

export type FacilityFormDefaults = {
  official_name: string;
  unit_key: string;
  category_id: string;
  description: string;
  state_id: string;
  municipality_id: string;
  address: string;
  latitude: string;
  longitude: string;
  phone: string;
  schedule: string;
  services: string;
  services_verified: boolean;
  source: string;
  source_url: string;
  last_verified_at: string;
  verification_status: VerificationStatus;
  notes: string;
  timezone: string;
  arrival_tolerance_minutes: string;
  is_public: boolean;
  active: boolean;
  is_demo: boolean;
};

type CategoryOption = { id: number; name: string; active: boolean };
type StateOption = { id: number; name: string; enabled: boolean; default_timezone: string };
type MunicipalityOption = { id: number; state_id: number; name: string; timezone: string | null };

function invalidProps(error: string | null | undefined, id: string) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

/**
 * Alta y edición de instalaciones (administración). No limpia lo capturado si
 * el servidor rechaza. La zona horaria sigue al municipio o al estado mientras
 * no se elija otra a mano.
 */
export function FacilityForm({
  action,
  facilityId,
  defaults,
  categories,
  states,
  municipalities,
  today,
  cancelHref,
}: {
  action: FacilityFormAction;
  facilityId?: string;
  defaults: FacilityFormDefaults;
  categories: CategoryOption[];
  states: StateOption[];
  municipalities: MunicipalityOption[];
  /** Hoy (yyyy-MM-dd): límite de la fecha de verificación. */
  today: string;
  cancelHref: string;
}) {
  const isEdit = Boolean(facilityId);
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(action, null);
  const [stateId, setStateId] = useState(defaults.state_id);
  const [municipalityId, setMunicipalityId] = useState(defaults.municipality_id);
  const [latitude, setLatitude] = useState(defaults.latitude);
  const [longitude, setLongitude] = useState(defaults.longitude);
  const [verification, setVerification] = useState<VerificationStatus>(defaults.verification_status);

  const stateById = new Map(states.map((s) => [String(s.id), s]));
  const municipalityById = new Map(municipalities.map((m) => [String(m.id), m]));
  const locationDefault = (sId: string, mId: string) =>
    defaultTimezoneFor(stateById.get(sId)?.default_timezone, municipalityById.get(mId)?.timezone ?? null);

  const [timezone, setTimezone] = useState(defaults.timezone || locationDefault(defaults.state_id, defaults.municipality_id));
  // La zona sigue a la ubicación salvo que la registrada sea distinta a la de su ubicación.
  const [tzFollows, setTzFollows] = useState(!defaults.timezone || defaults.timezone === locationDefault(defaults.state_id, defaults.municipality_id));

  const stateMunicipalities = municipalities.filter((m) => String(m.state_id) === stateId);
  const enabledStates = states.filter((s) => s.enabled);
  const otherStates = states.filter((s) => !s.enabled);
  const suggestedTz = locationDefault(stateId, municipalityId);
  const err = (name: string) => (state && !state.ok ? (state.fieldErrors?.[name] ?? null) : null);

  const lat = parseDecimalText(latitude);
  const lng = parseDecimalText(longitude);
  const coords = lat !== null && lng !== null ? checkCoordinates(lat, lng) : null;
  const coordsPreview = coords && coords.ok && coords.latitude !== null && coords.longitude !== null ? osmLink(coords.latitude, coords.longitude) : null;

  function changeLocation(nextState: string, nextMunicipality: string) {
    setStateId(nextState);
    setMunicipalityId(nextMunicipality);
    if (tzFollows) setTimezone(locationDefault(nextState, nextMunicipality));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-6">
      {facilityId ? <input type="hidden" name="id" value={facilityId} /> : null}

      <Alert tone="warning" title="Fuentes oficiales">
        {OFFICIAL_SOURCES_NOTICE}
      </Alert>

      {/* Identificación */}
      <fieldset className="space-y-4">
        <legend className="mb-1 text-lg font-semibold text-gray-900">Identificación</legend>

        <Field label="Nombre oficial" htmlFor="official_name" required error={err("official_name")} hint="Escríbelo como aparece en la fuente oficial.">
          <Input
            id="official_name"
            name="official_name"
            required
            minLength={OFFICIAL_NAME_MIN}
            maxLength={OFFICIAL_NAME_MAX}
            autoComplete="off"
            defaultValue={defaults.official_name}
            {...invalidProps(err("official_name"), "official_name")}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Clave de unidad" htmlFor="unit_key" error={err("unit_key")} hint="Clave oficial si existe. No se repite entre instalaciones.">
            <Input
              id="unit_key"
              name="unit_key"
              maxLength={UNIT_KEY_MAX}
              autoComplete="off"
              defaultValue={defaults.unit_key}
              {...invalidProps(err("unit_key"), "unit_key")}
            />
          </Field>
          <Field label="Categoría" htmlFor="category_id" required error={err("category_id")}>
            <Select id="category_id" name="category_id" required defaultValue={defaults.category_id} {...invalidProps(err("category_id"), "category_id")}>
              <option value="" disabled>
                Elige la categoría…
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.active && String(c.id) !== defaults.category_id}>
                  {c.active ? c.name : `${c.name} (inactiva)`}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Descripción" htmlFor="description" error={err("description")}>
          <Textarea
            id="description"
            name="description"
            maxLength={DESCRIPTION_MAX}
            className="min-h-20"
            defaultValue={defaults.description}
            {...invalidProps(err("description"), "description")}
          />
        </Field>
      </fieldset>

      {/* Ubicación */}
      <fieldset className="space-y-4">
        <legend className="mb-1 text-lg font-semibold text-gray-900">Ubicación</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Estado (entidad federativa)" htmlFor="state_id" required error={err("state_id")}>
            <Select
              id="state_id"
              name="state_id"
              required
              value={stateId}
              onChange={(e) => changeLocation(e.currentTarget.value, "")}
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
            hint={stateId && stateMunicipalities.length === 0 ? "No hay municipios cargados para este estado." : "Según el estado elegido."}
          >
            <Select
              id="municipality_id"
              name="municipality_id"
              value={municipalityId}
              onChange={(e) => changeLocation(stateId, e.currentTarget.value)}
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

        <Field label="Dirección" htmlFor="address" error={err("address")}>
          <Textarea
            id="address"
            name="address"
            maxLength={ADDRESS_MAX}
            className="min-h-16"
            defaultValue={defaults.address}
            {...invalidProps(err("address"), "address")}
          />
        </Field>

        <div className="space-y-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Latitud" htmlFor="latitude" error={err("latitude")} hint={`Entre ${MEXICO_BOUNDS.latMin} y ${MEXICO_BOUNDS.latMax}. Ej.: 21.5039`}>
              <Input
                id="latitude"
                name="latitude"
                inputMode="decimal"
                autoComplete="off"
                value={latitude}
                onChange={(e) => setLatitude(e.currentTarget.value)}
                {...invalidProps(err("latitude"), "latitude")}
              />
            </Field>
            <Field
              label="Longitud"
              htmlFor="longitude"
              error={err("longitude")}
              hint={`Entre ${MEXICO_BOUNDS.lngMin} y ${MEXICO_BOUNDS.lngMax} (negativa). Ej.: -104.8946`}
            >
              <Input
                id="longitude"
                name="longitude"
                inputMode="decimal"
                autoComplete="off"
                value={longitude}
                onChange={(e) => setLongitude(e.currentTarget.value)}
                {...invalidProps(err("longitude"), "longitude")}
              />
            </Field>
          </div>
          <p className="text-sm text-gray-600" aria-live="polite">
            Captura latitud y longitud juntas, o ninguna. Sin coordenadas la instalación no aparece en el mapa.
            {coords && !coords.ok ? <span className="block font-medium text-red-700">{coords.message}</span> : null}
            {coordsPreview ? (
              <>
                {" "}
                <a href={coordsPreview} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-800 underline underline-offset-2">
                  Revisar el punto en OpenStreetMap (abre otra pestaña)
                </a>
              </>
            ) : null}
          </p>
        </div>

        <Field
          label="Zona horaria"
          htmlFor="timezone"
          required
          error={err("timezone")}
          hint={
            tzFollows
              ? "Se ajusta sola a la del municipio o del estado. Las horas de guardias y registros se muestran en esta zona."
              : timezone !== suggestedTz
                ? `Elegida a mano. La de la ubicación es ${suggestedTz}.`
                : "Las horas de guardias y registros se muestran en esta zona."
          }
        >
          <Select
            id="timezone"
            name="timezone"
            required
            value={timezone}
            onChange={(e) => {
              setTimezone(e.currentTarget.value);
              setTzFollows(e.currentTarget.value === suggestedTz);
            }}
            {...invalidProps(err("timezone"), "timezone")}
          >
            {isMexicoTimezone(timezone) ? null : (
              <option value={timezone} disabled>
                {timezone} (registrada; no es una zona de México válida, elige otra)
              </option>
            )}
            {MEXICO_TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} — {t.value}
              </option>
            ))}
          </Select>
        </Field>
        {!tzFollows && timezone !== suggestedTz ? (
          <Button
            variant="ghost"
            onClick={() => {
              setTimezone(suggestedTz);
              setTzFollows(true);
            }}
          >
            Usar la zona de la ubicación ({suggestedTz})
          </Button>
        ) : null}
      </fieldset>

      {/* Contacto y servicios */}
      <fieldset className="space-y-4">
        <legend className="mb-1 text-lg font-semibold text-gray-900">Contacto y servicios</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Teléfono institucional" htmlFor="phone" error={err("phone")} hint="Solo teléfonos públicos de la instalación, nunca personales.">
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              maxLength={PHONE_MAX}
              autoComplete="off"
              defaultValue={defaults.phone}
              {...invalidProps(err("phone"), "phone")}
            />
          </Field>
          <Field label="Horario" htmlFor="schedule" error={err("schedule")} hint="Ej.: Lunes a viernes de 8:00 a 20:00">
            <Input id="schedule" name="schedule" maxLength={SCHEDULE_MAX} defaultValue={defaults.schedule} {...invalidProps(err("schedule"), "schedule")} />
          </Field>
        </div>
        <Field
          label="Servicios"
          htmlFor="services"
          error={err("services")}
          hint="Uno por línea. En el directorio público solo se muestran si marcas «Servicios verificados»."
        >
          <Textarea id="services" name="services" className="min-h-28" defaultValue={defaults.services} {...invalidProps(err("services"), "services")} />
        </Field>
        <div>
          <Checkbox name="services_verified" value="1" defaultChecked={defaults.services_verified} label="Servicios verificados" />
          <p className="text-sm text-gray-500">Márcalo solo si confirmaste los servicios con una fuente oficial.</p>
        </div>
      </fieldset>

      {/* Fuente y verificación */}
      <fieldset className="space-y-4">
        <legend className="mb-1 text-lg font-semibold text-gray-900">Fuente y verificación</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fuente de información" htmlFor="source" required error={err("source")} hint="Documento, portal o dependencia oficial consultada.">
            <Input
              id="source"
              name="source"
              required
              minLength={2}
              maxLength={SOURCE_MAX}
              defaultValue={defaults.source}
              {...invalidProps(err("source"), "source")}
            />
          </Field>
          <Field label="URL de la fuente" htmlFor="source_url" error={err("source_url")} hint="Dirección completa (https://…).">
            <Input
              id="source_url"
              name="source_url"
              type="url"
              inputMode="url"
              maxLength={URL_MAX}
              placeholder="https://"
              defaultValue={defaults.source_url}
              {...invalidProps(err("source_url"), "source_url")}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Estado de verificación" htmlFor="verification_status" required error={err("verification_status")}>
            <Select
              id="verification_status"
              name="verification_status"
              required
              value={verification}
              onChange={(e) => setVerification(e.currentTarget.value === "verificado" ? "verificado" : "pendiente")}
              {...invalidProps(err("verification_status"), "verification_status")}
            >
              <option value="pendiente">{VERIFICATION_LABELS.pendiente}</option>
              <option value="verificado">{VERIFICATION_LABELS.verificado}</option>
            </Select>
          </Field>
          <Field
            label="Fecha de última verificación"
            htmlFor="last_verified_at"
            required={verification === "verificado"}
            error={err("last_verified_at")}
            hint={verification === "verificado" ? "Obligatoria para marcarla como verificada." : undefined}
          >
            <Input
              id="last_verified_at"
              name="last_verified_at"
              type="date"
              max={today}
              required={verification === "verificado"}
              defaultValue={defaults.last_verified_at}
              {...invalidProps(err("last_verified_at"), "last_verified_at")}
            />
          </Field>
        </div>
        <Field label="Observaciones" htmlFor="notes" error={err("notes")} hint="Se muestran en la ficha pública. No incluyas datos personales.">
          <Textarea id="notes" name="notes" maxLength={NOTES_MAX} className="min-h-20" defaultValue={defaults.notes} {...invalidProps(err("notes"), "notes")} />
        </Field>
      </fieldset>

      {/* Operación */}
      <fieldset className="space-y-4">
        <legend className="mb-1 text-lg font-semibold text-gray-900">Guardias y publicación</legend>
        <Field
          label="Tolerancia de llegada (minutos)"
          htmlFor="arrival_tolerance_minutes"
          required
          error={err("arrival_tolerance_minutes")}
          hint={`De ${TOLERANCE_MIN} a ${TOLERANCE_MAX}. Margen antes de señalar una llegada tardía para revisión (nunca es una sanción automática).`}
          className="max-w-xs"
        >
          <Input
            id="arrival_tolerance_minutes"
            name="arrival_tolerance_minutes"
            type="number"
            inputMode="numeric"
            min={TOLERANCE_MIN}
            max={TOLERANCE_MAX}
            step={1}
            required
            defaultValue={defaults.arrival_tolerance_minutes}
            {...invalidProps(err("arrival_tolerance_minutes"), "arrival_tolerance_minutes")}
          />
        </Field>
        <div className="space-y-1">
          <Checkbox name="is_public" value="1" defaultChecked={defaults.is_public} label="Visible en el directorio público" />
          <Checkbox name="active" value="1" defaultChecked={defaults.active} label="Activa" />
          <p className="text-sm text-gray-500">Desactiva en lugar de borrar: el historial se conserva y deja de ofrecerse para nuevas guardias.</p>
          <Checkbox name="is_demo" value="1" defaultChecked={defaults.is_demo} label="Marcar como datos de demostración" />
          <p className="text-sm text-gray-500">
            Solo para registros ficticios de prueba. Se recomienda que su nombre empiece con «[DEMO]». Las instalaciones reales se registran sin esta
            marca.
          </p>
        </div>
      </fieldset>

      <Field
        label="Motivo del cambio"
        htmlFor="change_reason"
        required={isEdit}
        error={err("change_reason")}
        hint={isEdit ? "Queda en la bitácora junto con los valores anteriores." : "Si lo dejas vacío se registra «Alta de instalación»."}
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
          {pending ? "Guardando…" : isEdit ? "Guardar cambios" : "Registrar instalación"}
        </Button>
        <Link href={cancelHref} className={buttonClasses("outline", "lg")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
