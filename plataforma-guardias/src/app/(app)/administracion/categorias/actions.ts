"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/actions";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import { clearStoredReason } from "@/lib/reason";
import { categoryActiveSchema, categoryDeleteSchema, categoryFormSchema, invalidResult, normalizeText, readCategoryForm, readFields } from "@/lib/validation/facility";

const CATEGORIES_PATH = "/administracion/categorias";

function revalidateCategories() {
  revalidatePath(CATEGORIES_PATH, "layout");
  revalidatePath("/administracion/instalaciones", "layout");
  revalidatePath("/directorio", "layout");
}

/**
 * Un motivo igual al guardado lo borraría app.touch_row() y la bitácora
 * quedaría sin motivo: en ese caso se limpia antes de escribir.
 */
async function prepareReason(supabase: ServerSupabase, id: number): Promise<string | null> {
  // El motivo guardado no es legible (solo lo conserva la bitácora): se limpia
  // siempre, para que app.touch_row() no descarte un motivo repetido.
  const error = await clearStoredReason(supabase, "facility_categories", id);
  return error ? friendlyDbError(error, "No se pudo guardar la categoría.") : null;
}

/**
 * Alta o edición de una categoría (solo administración). El identificador
 * (slug) se genera del nombre si se deja vacío.
 */
export async function saveCategory(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = categoryFormSchema.safeParse(readCategoryForm(formData));
  if (!parsed.success) return invalidResult(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: all, error: readError } = await supabase.from("facility_categories").select("id, name, slug");
  if (readError) return { ok: false, message: friendlyDbError(readError) };
  const current = v.id ? (all ?? []).find((c) => c.id === v.id) : undefined;
  if (v.id && !current) return { ok: false, message: "La categoría no existe o fue eliminada." };

  const others = (all ?? []).filter((c) => c.id !== v.id);
  const nameClash = others.find((c) => normalizeText(c.name) === normalizeText(v.name));
  if (nameClash) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { name: `Ya existe la categoría «${nameClash.name}».` } };
  const slugClash = others.find((c) => c.slug === v.slug);
  if (slugClash) {
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { slug: `El identificador «${v.slug}» ya lo usa la categoría «${slugClash.name}».` } };
  }

  const values = {
    name: v.name,
    slug: v.slug,
    description: v.description ?? null,
    icon: v.icon,
    color: v.color,
    sort_order: v.sort_order,
    active: v.active,
    change_reason: v.reason,
  };

  if (v.id) {
    const reasonIssue = await prepareReason(supabase, v.id);
    if (reasonIssue) return { ok: false, message: reasonIssue };
    const { data, error } = await supabase.from("facility_categories").update(values).eq("id", v.id).select("id");
    if (error) return { ok: false, message: friendlyDbError(error, "No se pudo guardar la categoría.") };
    if (!data || data.length === 0) return { ok: false, message: "No tienes permiso para modificar esta categoría." };
    revalidateCategories();
    redirect(`${CATEGORIES_PATH}?guardada=1`);
  }

  const { error } = await supabase.from("facility_categories").insert(values);
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo crear la categoría.") };
  revalidateCategories();
  return { ok: true, message: `Categoría «${v.name}» creada.` };
}

/** Activar o desactivar (en lugar de borrar), con motivo. */
export async function setCategoryActive(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = categoryActiveSchema.safeParse(readFields(formData, ["category_id", "active", "reason"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const { category_id, reason } = parsed.data;
  const active = parsed.data.active === "1";

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("facility_categories").select("id").eq("id", category_id).maybeSingle();
  if (readError) return { ok: false, message: friendlyDbError(readError) };
  if (!current) return { ok: false, message: "La categoría no existe o no tienes permiso para modificarla." };
  const reasonIssue = await prepareReason(supabase, category_id);
  if (reasonIssue) return { ok: false, message: reasonIssue };

  const { data, error } = await supabase.from("facility_categories").update({ active, change_reason: reason }).eq("id", category_id).select("id, name");
  if (error) return { ok: false, message: friendlyDbError(error, "No se pudo cambiar el estado.") };
  if (!data || data.length === 0) return { ok: false, message: "La categoría no existe o no tienes permiso para modificarla." };

  revalidateCategories();
  return {
    ok: true,
    message: active
      ? `Categoría «${data[0].name}» activada.`
      : `Categoría «${data[0].name}» desactivada. Las instalaciones que la usan la conservan; ya no se ofrece para nuevas altas.`,
  };
}

/** Eliminación definitiva con motivo: solo si ninguna instalación la usa. */
export async function deleteCategory(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = categoryDeleteSchema.safeParse(readFields(formData, ["category_id", "confirm", "reason"] as const));
  if (!parsed.success) return invalidResult(parsed.error);
  const { category_id, reason } = parsed.data;

  const supabase = await createClient();
  const { count, error: countError } = await supabase.from("facilities").select("id", { count: "exact", head: true }).eq("category_id", category_id);
  if (countError) return { ok: false, message: "No se pudo comprobar si la categoría está en uso. Inténtalo de nuevo." };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `No se puede eliminar: la usan ${count} ${count === 1 ? "instalación" : "instalaciones"}. Desactívala en su lugar.`,
    };
  }

  // La bitácora del borrado toma el motivo guardado en la fila: se guarda antes
  // de borrar (sin generar otra entrada), limpiando antes el anterior para que
  // app.touch_row() no lo descarte si se repite.
  const { data: current, error: readError } = await supabase.from("facility_categories").select("id").eq("id", category_id).maybeSingle();
  if (readError) return { ok: false, message: friendlyDbError(readError, "No se pudo eliminar la categoría.") };
  if (!current) return { ok: false, message: "La categoría no existe o ya fue eliminada." };
  const reasonIssue = await prepareReason(supabase, category_id);
  if (reasonIssue) return { ok: false, message: reasonIssue };
  const { error: reasonError } = await supabase.from("facility_categories").update({ change_reason: reason }).eq("id", category_id);
  if (reasonError) return { ok: false, message: friendlyDbError(reasonError, "No se pudo eliminar la categoría.") };

  const { data, error } = await supabase.from("facility_categories").delete().eq("id", category_id).select("id");
  if (error) {
    if (error.code === "23503") return { ok: false, message: "No se puede eliminar porque está en uso. Desactívala en su lugar." };
    return { ok: false, message: friendlyDbError(error, "No se pudo eliminar la categoría.") };
  }
  if (!data || data.length === 0) return { ok: false, message: "La categoría no existe o ya fue eliminada." };

  revalidateCategories();
  redirect(`${CATEGORIES_PATH}?eliminada=1`);
}
