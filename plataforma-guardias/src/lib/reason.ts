import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";

type ReasonTable = "facilities" | "workers" | "worker_private" | "profiles" | "shifts" | "shift_assignments";
/** Catálogos con identificador numérico. */
type NumericReasonTable = "facility_categories" | "states" | "municipalities";

/**
 * El trigger app.touch_row() deja change_reason en NULL cuando el motivo nuevo
 * es igual al guardado (para no arrastrar motivos viejos a la bitácora). Para
 * que un motivo repetido sí quede registrado, se limpia antes de escribir.
 * Una actualización que solo toca change_reason no genera entrada en la bitácora.
 * En entidades y municipios la misma regla la aplica app.reset_change_reason();
 * app_settings se identifica por su clave.
 */
export async function clearStoredReason(
  supabase: ServerSupabase,
  table: ReasonTable | NumericReasonTable | "app_settings",
  id: string | number,
): Promise<{ message: string } | null> {
  let result: { error: { message: string } | null };
  if (table === "worker_private") result = await supabase.from("worker_private").update({ change_reason: null }).eq("worker_id", String(id));
  else if (table === "app_settings") result = await supabase.from("app_settings").update({ change_reason: null }).eq("key", String(id));
  else if (table === "facility_categories" || table === "states" || table === "municipalities") {
    result = await supabase.from(table).update({ change_reason: null }).eq("id", Number(id));
  } else result = await supabase.from(table).update({ change_reason: null }).eq("id", String(id));
  return result.error ? { message: result.error.message } : null;
}
