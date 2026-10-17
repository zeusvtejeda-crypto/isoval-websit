"use client";

import { Button } from "@/components/ui/button";
import { Checkbox, FormMessage } from "@/components/ui/form";
import { demoTotal, describeDemoCounts, type DemoCounts } from "@/lib/admin/settings";
import { useActionForm } from "@/lib/admin/use-action-form";
import { purgeDemoData } from "../actions";

export function DemoDataPanel({ counts }: { counts: DemoCounts }) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(purgeDemoData, {
    confirm: () => `Se eliminarán ${describeDemoCounts(counts)} de demostración, con sus asignaciones y registros. ¿Continuar?`,
  });
  const total = demoTotal(counts);
  const confirmError = fieldError("confirm");

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-3">
        {[
          { label: "Instalaciones", value: counts.facilities },
          { label: "Trabajadores", value: counts.workers },
          { label: "Guardias", value: counts.shifts },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-3">
            <dt className="text-sm text-gray-600">{item.label}</dt>
            <dd className="mt-1 text-2xl font-bold text-gray-900">{item.value.toLocaleString("es-MX")}</dd>
          </div>
        ))}
      </dl>

      {state?.ok ? <FormMessage state={state} /> : null}

      {total === 0 ? (
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-800">No hay datos de demostración.</p>
      ) : (
        <form action={formAction} onSubmit={onSubmit} className="space-y-3">
          <p className="text-sm text-gray-700">
            Solo se eliminan filas marcadas como demostración (con sus asignaciones, registros de entrada y salida y solicitudes de corrección). Las
            cuentas de acceso no se eliminan: si hay cuentas de demostración, desactívalas en Usuarios y permisos; quedarán sin trabajador vinculado.
          </p>
          <div>
            <Checkbox
              name="confirm"
              label="Confirmo que quiero eliminar los datos de demostración. No se puede deshacer."
              required
              aria-invalid={confirmError ? true : undefined}
              aria-describedby={confirmError ? "demo-confirm-error" : undefined}
            />
            {confirmError ? (
              <p id="demo-confirm-error" className="text-sm font-medium text-red-700">
                {confirmError}
              </p>
            ) : null}
          </div>
          {state && !state.ok && !confirmError ? <FormMessage state={state} /> : null}
          <Button type="submit" variant="danger" disabled={pending} aria-disabled={pending}>
            {pending ? "Eliminando…" : "Eliminar datos de demostración"}
          </Button>
        </form>
      )}
    </div>
  );
}
