"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { parseImportFile, type ParsedFile } from "@/lib/import/parse";
import {
  FACILITY_IMPORT_MODES,
  checkFacilityHeaders,
  describeSummary,
  headerWarnings,
  importReason,
  toPreviewRows,
  validateFacilityRows,
  type FacilityImportOutcome,
} from "@/lib/import/facilities";
import { FACILITIES_BASE_PATH, todayYmd } from "@/lib/validation/facility";
import { applyFacilityImport, loadFacilityImportData } from "../_lib/import-server";

const requestSchema = z.object({
  intent: z.enum(["validar", "importar"], { error: "Acción inválida." }),
  mode: z.enum(FACILITY_IMPORT_MODES, { error: "Elige el modo de importación." }),
  markDemo: z.boolean(),
  fingerprint: z.string().max(400).optional(),
});

/**
 * Validar: lee el archivo y devuelve la vista previa por fila (no escribe).
 * Importar: vuelve a leer y validar el MISMO archivo y aplica solo las filas
 * válidas (nuevas y actualizaciones con cambios) con el motivo
 * «Importación: <archivo>».
 */
export async function processFacilityImport(
  _prev: ActionResult<FacilityImportOutcome> | null,
  formData: FormData,
): Promise<ActionResult<FacilityImportOutcome>> {
  await requireAdmin();

  const rawFingerprint = formData.get("fingerprint");
  const markDemoRaw = formData.get("mark_demo");
  const parsedRequest = requestSchema.safeParse({
    intent: formData.get("intent"),
    mode: formData.get("mode"),
    markDemo: typeof markDemoRaw === "string" && ["1", "on", "true"].includes(markDemoRaw),
    fingerprint: typeof rawFingerprint === "string" ? rawFingerprint : undefined,
  });
  if (!parsedRequest.success) {
    return { ok: false, message: parsedRequest.error.issues[0]?.message ?? "Solicitud inválida.", fieldErrors: { mode: "Elige el modo." } };
  }
  const { intent, mode, markDemo, fingerprint = "" } = parsedRequest.data;

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

  const headers = checkFacilityHeaders(parsed.headers);
  if (headers.missing.length > 0) {
    return {
      ok: false,
      message: `${headers.missing.length === 1 ? "Falta la columna obligatoria" : "Faltan las columnas obligatorias"} «${headers.missing.join("», «")}». Usa los encabezados de la plantilla.`,
      fieldErrors: { archivo: "Encabezados incompletos." },
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, message: "El archivo no tiene filas de datos.", fieldErrors: { archivo: "Archivo sin filas." } };
  }

  const supabase = await createClient();
  let data: Awaited<ReturnType<typeof loadFacilityImportData>>;
  try {
    data = await loadFacilityImportData(supabase);
  } catch {
    return { ok: false, message: "No se pudieron cargar los catálogos para validar. Inténtalo de nuevo." };
  }
  const validation = validateFacilityRows(parsed.rows, data.catalogs, data.existing, mode, { markDemo, today: todayYmd() });
  const base: FacilityImportOutcome = {
    intent,
    fingerprint,
    fileName: file.name,
    mode,
    markDemo,
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

  const applied = await applyFacilityImport(supabase, validation.rows, importReason(file.name), data.storedReasons);

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

  revalidatePath(FACILITIES_BASE_PATH, "layout");
  revalidatePath("/directorio", "layout");

  const message =
    `Importación terminada: ${counts.created} ${counts.created === 1 ? "instalación creada" : "instalaciones creadas"}, ` +
    `${counts.updated} ${counts.updated === 1 ? "actualizada" : "actualizadas"}` +
    (counts.unchanged ? `, ${counts.unchanged} sin cambios` : "") +
    (counts.failed ? `, ${counts.failed} no se ${counts.failed === 1 ? "pudo" : "pudieron"} guardar` : "") +
    `. Filas omitidas: ${validation.summary.duplicada} duplicadas y ${validation.summary.error} con error.`;

  // Se devuelve ok aunque alguna fila falle: el detalle por fila explica qué no se guardó.
  return { ok: true, message, data: { ...base, rows, applied: counts } };
}
