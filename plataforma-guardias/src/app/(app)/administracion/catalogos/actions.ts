"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import { clearStoredReason } from "@/lib/reason";
import { failure, fieldFailure, invalidResult } from "@/lib/admin/form";
import { loadStateMunicipalities } from "@/lib/admin/catalogs-server";
import {
  CATALOGS_PATH,
  MUNICIPALITY_NOT_FOUND_MESSAGE,
  duplicateNameFailure,
  friendlyCatalogError,
  municipalityTimezoneSchema,
  newMunicipalitySchema,
  readMunicipalityTimezoneForm,
  readNewMunicipalityForm,
  readStateCoverageForm,
  readStateTimezoneForm,
  sameNameMunicipalities,
  stateCoverageSchema,
  stateTimezoneSchema,
} from "@/lib/admin/catalogs";

/** Las entidades y municipios se usan en formularios de instalaciones y trabajadores, y en el directorio. */
function revalidateCatalogs() {
  revalidatePath(CATALOGS_PATH);
  revalidatePath("/administracion/instalaciones", "layout");
  revalidatePath("/trabajadores", "layout");
  revalidatePath("/directorio", "layout");
}

/**
 * app.reset_change_reason() deja en null un motivo igual al guardado (para no
 * arrastrar motivos viejos a la bitácora). El motivo guardado no es legible
 * (solo lo conserva la bitácora), así que se limpia siempre antes de escribir.
 */
async function prepareReason(supabase: ServerSupabase, table: "states" | "municipalities", id: number): Promise<string | null> {
  const cleared = await clearStoredReason(supabase, table, id);
  return cleared ? friendlyCatalogError(cleared, "No se pudo guardar el cambio.") : null;
}

/** Cobertura activa de una entidad (states.enabled). */
export async function setStateCoverage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = stateCoverageSchema.safeParse(readStateCoverageForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const { state_id, enabled, reason } = parsed.data;

  const supabase = await createClient();
  const reasonIssue = await prepareReason(supabase, "states", state_id);
  if (reasonIssue) return failure(reasonIssue);
  const { data, error } = await supabase.from("states").update({ enabled, change_reason: reason }).eq("id", state_id).select("id, name");
  if (error) return failure(friendlyCatalogError(error, "No se pudo cambiar la cobertura."));
  if (!data || data.length === 0) return failure("La entidad no existe o no tienes permiso para modificarla.");

  revalidateCatalogs();
  return {
    ok: true,
    message: enabled
      ? `Cobertura activa en ${data[0].name}. Aparecerá primero en los formularios.`
      : `Cobertura desactivada en ${data[0].name}. Sus instalaciones y trabajadores no cambian.`,
  };
}

/** Zona horaria por omisión de una entidad. */
export async function saveStateTimezone(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = stateTimezoneSchema.safeParse(readStateTimezoneForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const { state_id, default_timezone, reason } = parsed.data;

  const supabase = await createClient();
  const reasonIssue = await prepareReason(supabase, "states", state_id);
  if (reasonIssue) return failure(reasonIssue);
  const { data, error } = await supabase.from("states").update({ default_timezone, change_reason: reason }).eq("id", state_id).select("id, name");
  if (error) return failure(friendlyCatalogError(error, "No se pudo guardar la zona horaria."));
  if (!data || data.length === 0) return failure("La entidad no existe o no tienes permiso para modificarla.");

  revalidateCatalogs();
  return {
    ok: true,
    message: `Zona horaria de ${data[0].name}: ${default_timezone}. Las instalaciones ya registradas conservan la suya.`,
  };
}

/** Zona horaria propia de un municipio (vacío = la de la entidad). */
export async function saveMunicipalityTimezone(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = municipalityTimezoneSchema.safeParse(readMunicipalityTimezoneForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const { state_id, municipality_id, timezone, reason } = parsed.data;

  const supabase = await createClient();
  const reasonIssue = await prepareReason(supabase, "municipalities", municipality_id);
  if (reasonIssue) return failure(reasonIssue);
  const { data, error } = await supabase
    .from("municipalities")
    .update({ timezone, change_reason: reason })
    .eq("id", municipality_id)
    .eq("state_id", state_id)
    .select("id, name, inegi_code");
  if (error) return failure(friendlyCatalogError(error, "No se pudo guardar la zona horaria del municipio."));
  if (!data || data.length === 0) return failure(MUNICIPALITY_NOT_FOUND_MESSAGE);

  revalidateCatalogs();
  const m = data[0];
  return {
    ok: true,
    message: timezone
      ? `Zona horaria de ${m.name} (clave ${m.inegi_code}): ${timezone}.`
      : `${m.name} (clave ${m.inegi_code}) usará la zona horaria de la entidad.`,
  };
}

/** Alta de un municipio en una entidad. */
export async function createMunicipality(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = newMunicipalitySchema.safeParse(readNewMunicipalityForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const stateRes = await supabase.from("states").select("id, name").eq("id", v.state_id).maybeSingle();
  if (stateRes.error) return failure(friendlyCatalogError(stateRes.error, "No se pudo comprobar la entidad."));
  if (!stateRes.data) return failure("La entidad no existe.");
  let existing: Awaited<ReturnType<typeof loadStateMunicipalities>>;
  try {
    existing = await loadStateMunicipalities(supabase, v.state_id);
  } catch {
    return failure("No se pudieron comprobar los municipios de la entidad. Inténtalo de nuevo.");
  }

  const sameCode = existing.find((m) => m.inegi_code === v.inegi_code);
  if (sameCode) {
    return fieldFailure("inegi_code", `La clave ${v.inegi_code} ya pertenece a «${sameCode.name}» en ${stateRes.data.name}.`);
  }
  const sameName = sameNameMunicipalities(existing, v.name);
  if (sameName.length > 0 && !v.allow_duplicate_name) {
    return duplicateNameFailure(sameName, stateRes.data.name);
  }

  const { error } = await supabase
    .from("municipalities")
    .insert({ state_id: v.state_id, inegi_code: v.inegi_code, name: v.name, timezone: v.timezone, change_reason: v.reason })
    .select("id")
    .single();
  if (error) {
    const message = friendlyCatalogError(error, "No se pudo agregar el municipio.");
    return error.code === "23505" ? fieldFailure("inegi_code", message) : failure(message);
  }

  revalidateCatalogs();
  return {
    ok: true,
    message:
      sameName.length > 0
        ? `Municipio «${v.name}» (clave ${v.inegi_code}) agregado a ${stateRes.data.name}. Hay otro con el mismo nombre: se distinguen por la clave INEGI.`
        : `Municipio «${v.name}» (clave ${v.inegi_code}) agregado a ${stateRes.data.name}.`,
  };
}
