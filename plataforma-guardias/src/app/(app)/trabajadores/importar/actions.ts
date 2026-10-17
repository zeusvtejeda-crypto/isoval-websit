"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { parseImportFile, type ParsedFile } from "@/lib/import/parse";
import {
  WORKER_IMPORT_MODES,
  checkWorkerHeaders,
  describeSummary,
  headerWarnings,
  toPreviewRows,
  validateWorkerRows,
  type ImportOutcome,
} from "@/lib/import/workers";
import { applyWorkerImport, loadImportContext } from "../_lib/import-server";

const requestSchema = z.object({
  intent: z.enum(["validar", "importar"], { error: "Acción inválida." }),
  mode: z.enum(WORKER_IMPORT_MODES, { error: "Elige el modo de importación." }),
  fingerprint: z.string().max(400).optional(),
});

/**
 * Validar: lee el archivo y devuelve la vista previa por fila (no escribe).
 * Importar: vuelve a leer y validar el MISMO archivo y aplica solo las filas
 * válidas (nuevas y actualizaciones con cambios).
 */
export async function processWorkerImport(_prev: ActionResult<ImportOutcome> | null, formData: FormData): Promise<ActionResult<ImportOutcome>> {
  const user = await requireManager();

  const parsedRequest = requestSchema.safeParse({
    intent: formData.get("intent"),
    mode: formData.get("mode"),
    fingerprint: typeof formData.get("fingerprint") === "string" ? formData.get("fingerprint") : undefined,
  });
  if (!parsedRequest.success) {
    return { ok: false, message: parsedRequest.error.issues[0]?.message ?? "Solicitud inválida.", fieldErrors: { mode: "Elige el modo." } };
  }
  const { intent, mode, fingerprint = "" } = parsedRequest.data;

  const file = formData.get("archivo");
  if (!(file instanceof File) || file.size === 0 || !file.name) {
    return { ok: false, message: "Elige un archivo CSV o Excel (.xlsx).", fieldErrors: { archivo: "Elige un archivo." } };
  }

  let parsed: ParsedFile;
  try {
    parsed = await parseImportFile(file);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo leer el archivo.", fieldErrors: { archivo: "Revisa el archivo." } };
  }

  const headers = checkWorkerHeaders(parsed.headers);
  if (headers.missing.length > 0) {
    return {
      ok: false,
      message: `Falta la columna obligatoria «${headers.missing.join(", ")}». Usa los encabezados de la plantilla.`,
      fieldErrors: { archivo: "Encabezados incompletos." },
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, message: "El archivo no tiene filas de datos.", fieldErrors: { archivo: "Archivo sin filas." } };
  }

  const supabase = await createClient();
  let context: Awaited<ReturnType<typeof loadImportContext>>;
  try {
    context = await loadImportContext(supabase, user, mode);
  } catch {
    return { ok: false, message: "No se pudieron cargar los catálogos para validar. Inténtalo de nuevo." };
  }
  const validation = validateWorkerRows(parsed.rows, context);
  const base: ImportOutcome = {
    intent,
    fingerprint,
    fileName: file.name,
    mode,
    summary: validation.summary,
    warnings: headerWarnings(headers),
    rows: toPreviewRows(validation.rows),
  };

  if (intent === "validar") {
    return { ok: true, message: `Validación lista. ${describeSummary(validation.summary)}`, data: base };
  }

  if (validation.summary.aplicables === 0) {
    return { ok: false, message: `No hay filas para importar. ${describeSummary(validation.summary)}` };
  }

  // Motivo único por importación: si se repitiera el de la vez anterior (mismo nombre
  // de archivo), app.touch_row() lo dejaría en NULL y la bitácora quedaría sin motivo.
  const batchId = crypto.randomUUID().slice(0, 8);
  const reason = `Importación de archivo «${file.name.slice(0, 120)}» (${formatDateTime(new Date())}, lote ${batchId})`;
  const applied = await applyWorkerImport(supabase, validation.rows, reason);

  const counts = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  const rows = base.rows.map((row) => {
    const a = applied.get(row.row);
    if (!a) return row;
    if (a.result === "creada") counts.created += 1;
    else if (a.result === "actualizada") counts.updated += 1;
    else if (a.result === "sin_cambios") counts.unchanged += 1;
    else counts.failed += 1;
    return { ...row, applied: a.result, messages: a.message ? [...row.messages, a.message] : row.messages };
  });

  revalidatePath("/trabajadores", "layout");

  const message =
    `Importación terminada: ${counts.created} ${counts.created === 1 ? "registro creado" : "registros creados"}, ` +
    `${counts.updated} ${counts.updated === 1 ? "actualizado" : "actualizados"}` +
    (counts.unchanged ? `, ${counts.unchanged} sin cambios` : "") +
    (counts.failed ? `, ${counts.failed} no se ${counts.failed === 1 ? "pudo" : "pudieron"} guardar` : "") +
    `. Filas omitidas: ${validation.summary.duplicada} duplicadas y ${validation.summary.error} con error.`;

  // Se devuelve ok aunque alguna fila falle: el detalle por fila explica qué no se guardó.
  return { ok: true, message, data: { ...base, rows, applied: counts } };
}
