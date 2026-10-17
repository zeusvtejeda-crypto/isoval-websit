"use client";

import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormMessage, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/states";
import { RETENTION_MAX_MONTHS, retentionImpactIsEmpty, type RetentionImpact, type RetentionSettings } from "@/lib/admin/settings";
import { invalidProps, useActionForm } from "@/lib/admin/use-action-form";
import { DEFAULT_TIMEZONE, formatDate } from "@/lib/time";
import { applyRetention, previewRetention, saveRetention } from "../actions";
import { ReasonField } from "../../_components/reason-field";

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("es-MX")} ${n === 1 ? one : many}`;
}

function ImpactSummary({ impact }: { impact: RetentionImpact }) {
  const verb = impact.executed ? "Se eliminaron" : "Se eliminarían";
  if (retentionImpactIsEmpty(impact)) {
    return (
      <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-800">
        {impact.executed ? "No había datos anteriores a las fechas de corte; no se eliminó nada." : "Con los periodos guardados no hay datos por eliminar."}
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900">
      <p className="font-semibold">{verb}:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>
          {plural(impact.shifts, "guardia terminada", "guardias terminadas")} antes del{" "}
          {impact.attendanceCutoff ? formatDate(impact.attendanceCutoff, DEFAULT_TIMEZONE) : "corte"}, con sus asignaciones y solicitudes de corrección;
        </li>
        <li>{plural(impact.sessions, "registro de entrada y salida", "registros de entrada y salida")} de esas guardias;</li>
        <li>
          {plural(impact.auditRows, "evento de bitácora", "eventos de bitácora")} anteriores al{" "}
          {impact.auditCutoff ? formatDate(impact.auditCutoff, DEFAULT_TIMEZONE) : "corte"};
        </li>
        <li>
          número de trabajador y teléfono de {plural(impact.workerPrivateRows, "trabajador inactivo", "trabajadores inactivos")} sin cambios en su
          registro ni guardias desde el {impact.inactiveWorkerCutoff ? formatDate(impact.inactiveWorkerCutoff, DEFAULT_TIMEZONE) : "corte"} (se
          conserva su registro de trabajador);
        </li>
        <li>
          el contenido (valores anterior y nuevo) de{" "}
          {plural(impact.auditRowsRedacted, "evento de bitácora que copiaba", "eventos de bitácora que copiaban")} esos datos; los eventos se
          conservan con su autor, fecha, acción y motivo.
        </li>
      </ul>
    </div>
  );
}

export function RetentionSettingsForm({ retention }: { retention: RetentionSettings }) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(saveRetention);
  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Meses de conservación de guardias y asistencia"
          htmlFor="ret-attendance"
          required
          error={fieldError("attendance_months")}
          hint="Guardias terminadas hace más de este tiempo, con sus registros de entrada y salida."
        >
          <Input
            id="ret-attendance"
            name="attendance_months"
            type="number"
            inputMode="numeric"
            min={1}
            max={RETENTION_MAX_MONTHS}
            step={1}
            required
            defaultValue={retention.attendance_months}
            {...invalidProps(fieldError("attendance_months"), "ret-attendance")}
          />
        </Field>
        <Field
          label="Meses de conservación de bitácora"
          htmlFor="ret-audit"
          required
          error={fieldError("audit_months")}
          hint="Eventos de la bitácora más antiguos que este tiempo."
        >
          <Input
            id="ret-audit"
            name="audit_months"
            type="number"
            inputMode="numeric"
            min={1}
            max={RETENTION_MAX_MONTHS}
            step={1}
            required
            defaultValue={retention.audit_months}
            {...invalidProps(fieldError("audit_months"), "ret-audit")}
          />
        </Field>
        <Field
          label="Meses para conservar datos privados de trabajadores inactivos"
          htmlFor="ret-inactive"
          required
          error={fieldError("inactive_worker_months")}
          hint="Número de trabajador y teléfono de trabajadores inactivos cuyo registro no cambió y que no tuvieron guardias en este tiempo."
          className="sm:col-span-2"
        >
          <Input
            id="ret-inactive"
            name="inactive_worker_months"
            type="number"
            inputMode="numeric"
            min={1}
            max={RETENTION_MAX_MONTHS}
            step={1}
            required
            defaultValue={retention.inactive_worker_months}
            className="sm:max-w-xs"
            {...invalidProps(fieldError("inactive_worker_months"), "ret-inactive")}
          />
        </Field>
      </div>
      <ReasonField id="ret-reason" state={state} error={fieldError("reason")} />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Guardando…" : "Guardar periodos"}
      </Button>
    </form>
  );
}

/** «Calcular impacto» (sin eliminar) y «Aplicar ahora» (irreversible). */
export function RetentionActions() {
  const preview = useActionForm(previewRetention);
  const apply = useActionForm(applyRetention, {
    confirm: () =>
      "Se eliminarán DEFINITIVAMENTE las guardias, registros y eventos de bitácora anteriores a las fechas de corte, y el número de trabajador y teléfono de los trabajadores inactivos. También se borrarán las copias de esos datos en la bitácora (los eventos se conservan con autor, fecha, acción y motivo, sin los valores). Esta acción no se puede deshacer. ¿Aplicar ahora?",
  });
  const confirmError = apply.fieldError("confirm");
  const previewImpact = preview.state?.ok ? preview.state.data : undefined;
  const appliedImpact = apply.state?.ok ? apply.state.data : undefined;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h3 className="font-semibold text-gray-900">1. Calcular impacto</h3>
        <p className="text-sm text-gray-700">Usa los periodos guardados. Solo cuenta; no elimina nada.</p>
        <form action={preview.formAction} onSubmit={preview.onSubmit}>
          <Button type="submit" variant="outline" disabled={preview.pending} aria-disabled={preview.pending}>
            {preview.pending ? "Calculando…" : "Calcular impacto"}
          </Button>
        </form>
        {preview.state && !preview.state.ok ? <FormMessage state={preview.state} /> : null}
        {previewImpact ? <ImpactSummary impact={previewImpact} /> : null}
      </div>

      <div className="space-y-3 border-t border-gray-200 pt-4">
        <h3 className="font-semibold text-gray-900">2. Aplicar ahora</h3>
        <p className="text-sm text-gray-700">Usa los periodos guardados. Calcula el impacto antes de aplicar.</p>
        <Alert tone="warning" title="Eliminación irreversible">
          Los datos eliminados no se pueden recuperar desde la plataforma. Antes de aplicar, verifica que existan respaldos y que los periodos cumplan
          con las obligaciones que correspondan.
        </Alert>
        <form action={apply.formAction} onSubmit={apply.onSubmit} className="space-y-3">
          <div>
            <Checkbox
              name="confirm"
              label="Entiendo que la eliminación es definitiva e irreversible."
              required
              aria-invalid={confirmError ? true : undefined}
              aria-describedby={confirmError ? "ret-confirm-error" : undefined}
            />
            {confirmError ? (
              <p id="ret-confirm-error" className="text-sm font-medium text-red-700">
                {confirmError}
              </p>
            ) : null}
          </div>
          {apply.state && !confirmError ? <FormMessage state={apply.state} /> : null}
          <Button type="submit" variant="danger" disabled={apply.pending} aria-disabled={apply.pending}>
            {apply.pending ? "Aplicando…" : "Aplicar política ahora"}
          </Button>
        </form>
        {appliedImpact ? <ImpactSummary impact={appliedImpact} /> : null}
      </div>
    </div>
  );
}
