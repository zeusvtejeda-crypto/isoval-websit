import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import { CATEGORY_COLUMNS, getCategories, type Category } from "@/lib/data/catalogs";

export type CategoryWithUsage = Category & { usage: number };

/** Instalaciones que usan cada categoría (administración ve todas por RLS). */
async function usageOf(supabase: ServerSupabase, categoryId: number): Promise<number> {
  const { count, error } = await supabase.from("facilities").select("id", { count: "exact", head: true }).eq("category_id", categoryId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getCategoriesWithUsage(supabase: ServerSupabase): Promise<CategoryWithUsage[]> {
  const categories = await getCategories(supabase);
  const usage = await Promise.all(categories.map((c) => usageOf(supabase, c.id)));
  return categories.map((c, i) => ({ ...c, usage: usage[i] }));
}

export async function getCategoryWithUsage(supabase: ServerSupabase, id: number): Promise<CategoryWithUsage | null> {
  const { data, error } = await supabase.from("facility_categories").select(CATEGORY_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { ...data, usage: await usageOf(supabase, id) };
}
