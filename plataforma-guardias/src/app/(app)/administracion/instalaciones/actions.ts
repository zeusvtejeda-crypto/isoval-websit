"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import {
  FACILITIES_BASE_PATH,
  TOLERANCE_DEFAULT,
  changedFields,
  defaultTimezoneFor,
  facilityActiveSchema,
  facilityDeleteSchema,
  facilityFormSchema,
  invalidResult,
  normalizeText,
  readFacilityForm,
  readFields,
  todayYmd,
  unitKeyKey,
} from "@/lib/validation/facility";
import { countFacilityRelations, describeRelations, type FacilityRow } from "./_lib/queries";
import { resetRepeatedReason } from "./_lib/reason";

type SaveResult = ActionResult<{ id: string }>;

/** Escapa comodines de LIKE (%, _ y \) y elimina «*» (comodín de PostgREST). */
function escapeLike(value: string): string {
  return value.replace(/\*/g, "").replace(/[\\%_]/g, (c) => `\\${c}`);
}

function revalidateFacility(id?: string) {
  revalidatePath(FACILITIES_BASE_PATH, "layout");
  revalidatePath("/directorio", "layout");
  if (id) revalidatePath(`/directorio/${id}`);
}

function fieldError(field: string, message: string): Extract<SaveResult, { ok: false }> {
  return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { [field]: message } };
}

/**
 * Alta o edición de una instalación (solo administración). Valida catálogos y
 * duplicados antes de escribir; los índices únicos de la base cubren el resto.
 */
export async function saveFacility(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  await requireAdmin();
  const parsed = facilityFormSchema(todayYmd()).safeParse(readFacilityForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;
  const isEdit = Boolean(v.id);

  const supabase = await createClient();

  let current: FacilityRow | null = null;
  if (v.id) {
    const { data, error } = await supabase.from("facilities").select("*").eq("id", v.id).maybeSingle();
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data) return { ok: false, message: "La instalación no existe o fue eliminada." };
    current = data;
  }

  // Catálogos: categoría, estado y municipio del mismo estado.
  const [categoryRes, stateRes, municipalityRes] = await Promise.all([
    supabase.from("facility_categories").select("id, name, active").eq("id", v.category_id).maybeSingle(),
    supabase.from("states").select("id, default_timezone").eq("id", v.state_id).maybeSingle(),
    v.municipality_id
      ? supabase.from("municipalities").select("id, state_id, timezone").eq("id", v.municipality_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const catalogError = categoryRes.error ?? stateRes.error ?? municipalityRes.error;
  if (catalogError) return { ok: false, message: friendlyDbError(catalogError) };
  if (!categoryRes.data) return fieldError("category_id", "Categoría no válida.");
  if (!categoryRes.data.active && current?.category_id !== v.category_id) {
    return fieldError("category_id", `La categoría «${categoryRes.data.name}» está inactiva. Actívala o elige otra.`);
  }
  if (!stateRes.data) return fieldError("state_id", "Estado no válido.");
  if (v.municipality_id && (!municipalityRes.data || municipalityRes.data.state_id !== v.state_id)) {
    return fieldError("municipality_id", "El municipio no corresponde al estado elegido.");
  }
  const timezone = v.timezone ?? defaultTimezoneFor(stateRes.data.default_timezone, municipalityRes.data?.timezone);

  // Duplicados: clave de unidad y nombre oficial en el mismo estado y municipio.
  const unitKey = v.unit_key ? v.unit_key : null;
  if (unitKey) {
    const { data: dupes, error } = await supabase
      .from("facilities")
      .select("id, internal_code, official_name, unit_key")
      .ilike("unit_key", escapeLike(unitKey))
      .limit(5);
    if (error) return { ok: false, message: friendlyDbError(error) };
    const clash = (dupes ?? []).find((d) => d.id !== v.id && unitKeyKey(d.unit_key) === unitKeyKey(unitKey));
    if (clash) return fieldError("unit_key", `Esa clave de unidad ya pertenece a ${clash.internal_code} (${clash.official_name}).`);
  }
  {
    let q = supabase
      .from("facilities")
      .select("id, internal_code, official_name")
      .eq("normalized_name", normalizeText(v.official_name))
      .eq("state_id", v.state_id);
    q = v.municipality_id ? q.eq("municipality_id", v.municipality_id) : q.is("municipality_id", null);
    const { data: dupes, error } = await q.limit(5);
    if (error) return { ok: false, message: friendlyDbError(error) };
    const clash = (dupes ?? []).find((d) => d.id !== v.id);
    if (clash) {
      return fieldError("official_name", `Ya existe ${clash.internal_code} (${clash.official_name}) con el mismo nombre en el mismo estado y municipio.`);
    }
  }

  const values = {
    official_name: v.official_name,
    unit_key: unitKey,
    category_id: v.category_id,
    description: v.description ?? null,
    state_id: v.state_id,
    municipality_id: v.municipality_id ?? null,
    address: v.address ?? null,
    latitude: v.latitude,
    longitude: v.longitude,
    phone: v.phone ?? null,
    schedule: v.schedule ?? null,
    services: v.services,
    services_verified: v.services_verified,
    source: v.source,
    source_url: v.source_url ?? null,
    last_verified_at: v.last_verified_at ?? null,
    verification_status: v.verification_status,
    notes: v.notes ?? null,
    timezone,
    arrival_tolerance_minutes: v.arrival_tolerance_minutes ?? TOLERANCE_DEFAULT,
    is_public: v.is_public,
    active: v.active,
    is_demo: v.is_demo,
  };
  const reason = v.change_reason ?? (isEdit ? null : "Alta de instalación");

  let facilityId: string;
  if (v.id && current) {
    if (changedFields(current, values).length === 0) {
      return { ok: true, message: "No hay cambios que guardar: los datos son iguales a los registrados." };
    }
    const resetError = await resetRepeatedReason(supabase, v.id, current.change_reason, reason);
    if (resetError) return { ok: false, message: friendlyDbError(resetError, "No se pudo guardar la instalación.") };
    const { data, error } = await supabase
      .from("facilities")
      .update({ ...values, change_reason: reason })
      .eq("id", v.id)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error, "No se pudo guardar la instalación.") };
    if (!data || data.length === 0) return { ok: false, message: "No tienes permiso para modificar esta instalación." };
    facilityId = v.id;
  } else {
    const { data, error } = await supabase
      .from("facilities")
      .insert({ ...values, change_reason: reason })
      .select("id")
      .single();
    if (error || !data) return { ok: false, message: friendlyDbError(error, "No se pudo registrar la instalación.") };
    facilityId = data.id;
  }

  revalidateFacility(facilityId);
  redirect(`${FACILITIES_BASE_PATH}/${facilityId}/editar?guardado=${isEdit ? "cambios" : "alta"}`);
}

/** Desactivar (en lugar de borrar) o reactivar, con motivo. */
export async function setFacilityActive(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = facilityActiveSchema.safeParse(readFields(formData, ["facility_id", "active", "reason"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const { facility_id, reason } = parsed.data;
  const active = parsed.data.active === "1";

  const supabase = await createClient();
  const { data: facility, error } = await supabase.from("facilities").select("id, active, change_reason").eq("id", facility_id).maybeSingle();
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!facility) return { ok: false, message: "La instalación no existe o fue eliminada." };
  if (facility.active === active) return { ok: false, message: active ? "La instalación ya está activa." : "La instalación ya está inactiva." };

  const resetError = await resetRepeatedReason(supabase, facility_id, facility.change_reason, reason);
  if (resetError) return { ok: false, message: friendlyDbError(resetError, "No se pudo cambiar el estado.") };

  const { data, error: updateError } = await supabase
    .from("facilities")
    .update({ active, change_reason: reason })
    .eq("id", facility_id)
    .select("id");
  if (updateError) return { ok: false, message: friendlyDbError(updateError, "No se pudo cambiar el estado.") };
  if (!data || data.length === 0) return { ok: false, message: "No tienes permiso para modificar esta instalación." };

  revalidateFacility(facility_id);
  return {
    ok: true,
    message: active
      ? "Instalación reactivada. Vuelve a mostrarse en el directorio si está marcada como visible."
      : "Instalación desactivada. Se conserva su historial, ya no aparece en el directorio público ni en las listas de sedes activas.",
  };
}

/**
 * Eliminación definitiva: solo si no tiene relaciones (trabajadores, guardias,
 * asistencias, solicitudes, notas ni cuentas con la sede asignada).
 */
export async function deleteFacility(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = facilityDeleteSchema.safeParse(readFields(formData, ["facility_id", "reason", "confirm"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const { facility_id, reason } = parsed.data;

  const supabase = await createClient();
  const { data: facility, error } = await supabase.from("facilities").select("id, change_reason").eq("id", facility_id).maybeSingle();
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!facility) return { ok: false, message: "La instalación no existe o ya fue eliminada." };

  let relations: string[];
  try {
    relations = describeRelations(await countFacilityRelations(supabase, facility_id));
  } catch {
    return { ok: false, message: "No se pudo comprobar si la instalación tiene relaciones. Inténtalo de nuevo." };
  }
  if (relations.length > 0) {
    return {
      ok: false,
      message: `No se puede eliminar porque tiene ${relations.join(", ")}. Desactívala en su lugar: el historial se conserva.`,
    };
  }

  // La bitácora del borrado toma el motivo guardado en la fila: se guarda antes
  // de borrar (sin generar otra entrada). Si ya es el mismo no se reescribe,
  // porque app.touch_row() lo dejaría en null al ver un valor repetido.
  if (facility.change_reason !== reason) {
    const { error: reasonError } = await supabase.from("facilities").update({ change_reason: reason }).eq("id", facility_id);
    if (reasonError) return { ok: false, message: friendlyDbError(reasonError, "No se pudo eliminar la instalación.") };
  }
  const { data: deleted, error: deleteError } = await supabase.from("facilities").delete().eq("id", facility_id).select("id");
  if (deleteError) {
    if (deleteError.code === "23503") {
      return { ok: false, message: "No se puede eliminar porque tiene registros relacionados. Desactívala en su lugar: el historial se conserva." };
    }
    return { ok: false, message: friendlyDbError(deleteError, "No se pudo eliminar la instalación.") };
  }
  if (!deleted || deleted.length === 0) return { ok: false, message: "No tienes permiso para eliminar esta instalación o ya no existe." };

  revalidateFacility(facility_id);
  redirect(`${FACILITIES_BASE_PATH}?eliminada=1`);
}
