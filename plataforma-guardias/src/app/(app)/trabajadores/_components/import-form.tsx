"use client";

import { startTransition, useActionState, useMemo, useState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/form";
import { Alert } from "@/components/ui/states";
import { Table, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import {
  IMPORT_APPLY_LABELS,
  IMPORT_APPLY_TONE,
  IMPORT_MODE_LABELS,
  IMPORT_STATUS_LABELS,
  IMPORT_STATUS_TONE,
  WORKER_IMPORT_MODES,
  type ImportOutcome,
  type ImportPreviewRow,
  type WorkerImportMode,
  type WorkerImportStatus,
} from "@/lib/import/workers";

type ImportAction = (prev: ActionResult<ImportOutcome> | null, formData: FormData) => Promise<ActionResult<ImportOutcome>>;

/**
 * Las Server Actions aceptan hasta 1 MB por solicitud (valor por omisión de
 * Next.js). Se deja margen para los encabezados multipart.
 */
const UPLOAD_LIMIT_BYTES = 1_000_000 - 40_000;
const PAGE = 100;

type StatusFilter = "" | WorkerImportStatus;

function fingerprintOf(file: File | null, mode: WorkerImportMode): string {
  return file ? `${file.name}|${file.size}|${file.lastModified}|${mode}` : "";
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Carga de archivo en dos pasos: «Validar» muestra la vista previa por fila y
 * «Importar» vuelve a enviar el MISMO archivo (el servidor lo re-procesa) y
 * aplica solo las filas válidas.
 */
export function ImportForm({ action }: { action: ImportAction }) {
  const [state, formAction, pending] = useActionState<ActionResult<ImportOutcome> | null, FormData>(action, null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<WorkerImportMode>("crear_actualizar");
  const [localError, setLocalError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("");
  const [shown, setShown] = useState(PAGE);
  const [submitted, setSubmitted] = useState<"validar" | "importar" | null>(null);

  const fingerprint = fingerprintOf(file, mode);
  const outcome = state?.ok ? state.data : undefined;
  const validated = outcome?.intent === "validar" && outcome.fingerprint === fingerprint && fingerprint !== "";
  const imported = outcome?.intent === "importar";
  const stale = outcome && outcome.intent === "validar" && outcome.fingerprint !== fingerprint;
  const canImport = validated && (outcome?.summary.aplicables ?? 0) > 0 && !pending;

  const rows = useMemo(() => (outcome ? outcome.rows.filter((r) => !filter || r.status === filter) : []), [outcome, filter]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === "importar" ? "importar" : "validar";
    if (!file) {
      setLocalError("Elige un archivo CSV o Excel (.xlsx).");
      return;
    }
    if (file.size > UPLOAD_LIMIT_BYTES) {
      setLocalError(`El archivo pesa ${formatBytes(file.size)} y el máximo por envío es ${formatBytes(UPLOAD_LIMIT_BYTES)}. Divídelo en partes.`);
      return;
    }
    if (intent === "importar") {
      if (!canImport || !outcome) return;
      const s = outcome.summary;
      const ok = window.confirm(
        `Se crearán ${s.nueva} y se actualizarán ${s.actualizacion - s.sinCambios} registros. ` +
          `Las filas duplicadas o con error no se importan. ¿Continuar?`,
      );
      if (!ok) return;
    }
    setLocalError(null);
    setFilter("");
    setShown(PAGE);
    setSubmitted(intent);
    const data = new FormData(event.currentTarget);
    data.set("intent", intent);
    data.set("fingerprint", fingerprint);
    startTransition(() => formAction(data));
  }

  return (
    <div className="space-y-5">
      <form action={formAction} onSubmit={onSubmit} className="space-y-4">
        <Field
          label="Archivo CSV o Excel (.xlsx)"
          htmlFor="archivo"
          required
          hint={`Hasta 5000 filas y ${formatBytes(UPLOAD_LIMIT_BYTES)} por archivo. Usa los encabezados de la plantilla.`}
          error={localError ?? (state && !state.ok ? (state.fieldErrors?.archivo ?? null) : null)}
        >
          <input
            id="archivo"
            name="archivo"
            type="file"
            required
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.currentTarget.files?.[0] ?? null);
              setLocalError(null);
            }}
            className="block w-full min-h-11 rounded-xl border border-gray-300 bg-white px-3 py-2 text-base file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:font-semibold file:text-brand-900"
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-800">Modo de importación</legend>
          {WORKER_IMPORT_MODES.map((m) => (
            <label key={m} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-gray-200 px-3 py-2.5 has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50">
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="mt-1 size-5 border-gray-400 text-brand-800 focus:ring-brand-700"
              />
              <span>
                <span className="block font-medium text-gray-900">{IMPORT_MODE_LABELS[m]}</span>
                <span className="block text-sm text-gray-600">
                  {m === "crear_actualizar"
                    ? "Crea los nuevos y actualiza a quien ya existe (mismo número de trabajador, o mismo nombre y sede). Las celdas vacías conservan lo registrado."
                    : "Solo crea registros nuevos; quien ya existe se marca como duplicado y no se modifica."}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" name="intent" value="validar" size="lg" variant={validated ? "outline" : "primary"} disabled={pending} aria-disabled={pending}>
            {pending && submitted === "validar" ? "Validando…" : "Validar"}
          </Button>
          <Button type="submit" name="intent" value="importar" size="lg" variant="primary" disabled={!canImport} aria-disabled={!canImport}>
            {pending && submitted === "importar" ? "Importando…" : "Importar"}
          </Button>
        </div>
        {!validated && !pending ? (
          <p className="text-sm text-gray-600">
            {imported
              ? "Importación terminada. Para cargar otro archivo, elígelo y pulsa «Validar»."
              : stale
                ? "Cambiaste el archivo o el modo: valida de nuevo antes de importar."
                : "Primero valida el archivo; después podrás importarlo."}
          </p>
        ) : null}
        <FormMessage state={state && !state.ok ? state : null} />
      </form>

      {outcome ? (
        <section aria-labelledby="resultado-importacion" className="space-y-4">
          <h2 id="resultado-importacion" className="text-xl font-semibold text-gray-900">
            {imported ? "Resultado de la importación" : "Vista previa"}
            <span className="block text-sm font-normal text-gray-600">
              {outcome.fileName} · {IMPORT_MODE_LABELS[outcome.mode]}
            </span>
          </h2>

          <Alert tone={imported ? "success" : "info"} title={imported ? "Importación terminada" : "Validación lista (aún no se guardó nada)"}>
            {state?.message}
          </Alert>
          {outcome.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}

          {imported && outcome.applied ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Creados" value={outcome.applied.created} />
              <Stat label="Actualizados" value={outcome.applied.updated} />
              <Stat label="Sin cambios" value={outcome.applied.unchanged} />
              <Stat label="No guardados" value={outcome.applied.failed} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Nuevas" value={outcome.summary.nueva} />
              <Stat
                label="Actualizaciones"
                value={outcome.summary.actualizacion}
                hint={outcome.summary.sinCambios ? `${outcome.summary.sinCambios} sin cambios` : undefined}
              />
              <Stat label="Duplicadas" value={outcome.summary.duplicada} hint="No se importan" />
              <Stat label="Con error" value={outcome.summary.error} hint="No se importan" />
            </div>
          )}

          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar filas por estado">
            {(["", "nueva", "actualizacion", "duplicada", "error"] as StatusFilter[]).map((s) => {
              const count = s ? outcome.summary[s] : outcome.summary.total;
              return (
                <button
                  key={s || "todas"}
                  type="button"
                  onClick={() => {
                    setFilter(s);
                    setShown(PAGE);
                  }}
                  aria-pressed={filter === s}
                  className={cn(
                    "min-h-11 rounded-xl border px-3 text-sm font-semibold",
                    filter === s ? "border-brand-800 bg-brand-800 text-white" : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
                  )}
                >
                  {s ? IMPORT_STATUS_LABELS[s] : "Todas"} ({count})
                </button>
              );
            })}
          </div>

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-gray-600">No hay filas con este estado.</p>
          ) : (
            <>
              <PreviewCards rows={rows.slice(0, shown)} />
              <PreviewTable rows={rows.slice(0, shown)} />
              {rows.length > shown ? (
                <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                  Mostrar más filas ({rows.length - shown} restantes)
                </Button>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

function RowBadges({ row }: { row: ImportPreviewRow }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <Badge tone={IMPORT_STATUS_TONE[row.status]}>{IMPORT_STATUS_LABELS[row.status]}</Badge>
      {row.applied ? <Badge tone={IMPORT_APPLY_TONE[row.applied]}>{IMPORT_APPLY_LABELS[row.applied]}</Badge> : null}
    </span>
  );
}

function Messages({ messages }: { messages: string[] }) {
  if (messages.length === 0) return <span className="text-gray-500">—</span>;
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {messages.map((m, i) => (
        <li key={i}>{m}</li>
      ))}
    </ul>
  );
}

function PreviewCards({ rows }: { rows: ImportPreviewRow[] }) {
  return (
    <ul className="space-y-3 md:hidden" aria-label="Filas del archivo">
      {rows.map((r) => (
        <li key={r.row} className="rounded-[--radius-card] border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-gray-600">Fila {r.row}</p>
              <p className="font-semibold text-gray-900">{r.name}</p>
              {r.facility ? <p className="text-sm text-gray-700">{r.facility}</p> : null}
            </div>
            <RowBadges row={r} />
          </div>
          <div className="mt-2 text-sm text-gray-800">
            <Messages messages={r.messages} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PreviewTable({ rows }: { rows: ImportPreviewRow[] }) {
  return (
    <Table caption="Filas del archivo" className="hidden md:block">
      <thead>
        <tr>
          <Th>Fila</Th>
          <Th>Estado</Th>
          <Th>Nombre</Th>
          <Th>Instalación</Th>
          <Th>Mensajes</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((r) => (
          <tr key={r.row}>
            <Td className="whitespace-nowrap">{r.row}</Td>
            <Td>
              <RowBadges row={r} />
            </Td>
            <Td className="min-w-40">{r.name}</Td>
            <Td className="min-w-40">{r.facility ?? <span className="text-gray-500">—</span>}</Td>
            <Td className="min-w-72">
              <Messages messages={r.messages} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
