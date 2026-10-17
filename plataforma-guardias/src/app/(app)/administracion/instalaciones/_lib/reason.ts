import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import { needsReasonReset } from "@/lib/validation/facility";

type DbError = { message: string; code?: string } | null;

/**
 * app.touch_row() deja change_reason en null si el motivo nuevo es igual al
 * guardado. Para que un motivo repetido (p. ej. otra importación del mismo
 * archivo) llegue a la bitácora, antes se limpia el motivo guardado. Esa
 * escritura no crea entrada en la bitácora: app.audit_row() ignora los cambios
 * que solo tocan change_reason, updated_at y updated_by.
 */
export async function resetRepeatedReason(
  supabase: ServerSupabase,
  facilityId: string,
  storedReason: string | null | undefined,
  newReason: string | null | undefined,
): Promise<DbError> {
  if (!needsReasonReset(storedReason, newReason)) return null;
  const { error } = await supabase.from("facilities").update({ change_reason: null }).eq("id", facilityId);
  return error;
}
