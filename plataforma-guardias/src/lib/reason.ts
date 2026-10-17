import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";

type ReasonTable = "facilities" | "workers" | "worker_private" | "profiles" | "shifts" | "shift_assignments";

/**
 * El trigger app.touch_row() deja change_reason en NULL cuando el motivo nuevo
 * es igual al guardado (para no arrastrar motivos viejos a la bitácora). Para
 * que un motivo repetido sí quede registrado, se limpia antes de escribir.
 * Una actualización que solo toca change_reason no genera entrada en la bitácora.
 */
export async function clearStoredReason(supabase: ServerSupabase, table: ReasonTable, id: string): Promise<{ message: string } | null> {
  const { error } =
    table === "worker_private"
      ? await supabase.from("worker_private").update({ change_reason: null }).eq("worker_id", id)
      : await supabase.from(table).update({ change_reason: null }).eq("id", id);
  return error ? { message: error.message } : null;
}
