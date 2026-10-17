import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

type CorrectionRow = Database["public"]["Tables"]["correction_requests"]["Row"];

export type CorrectionListItem = CorrectionRow & {
  worker: { id: string; full_name: string; internal_code: string } | null;
  facility: { id: string; official_name: string; timezone: string } | null;
  assignment: {
    id: string;
    shift: { id: string; title: string | null; meeting_point: string; starts_at: string; ends_at: string } | null;
  } | null;
  session: { id: string; check_in_at: string; check_out_at: string | null; record_status: Database["public"]["Enums"]["record_status"] } | null;
  resulting: { id: string; check_in_at: string; check_out_at: string | null } | null;
};

const CORRECTION_SELECT = [
  "*",
  "worker:workers!correction_requests_worker_id_fkey(id, full_name, internal_code)",
  "facility:facilities!correction_requests_facility_id_fkey(id, official_name, timezone)",
  "assignment:shift_assignments!correction_requests_assignment_id_fkey(id, shift:shifts!shift_assignments_shift_id_fkey(id, title, meeting_point, starts_at, ends_at))",
  "session:attendance_sessions!correction_requests_session_id_fkey(id, check_in_at, check_out_at, record_status)",
  "resulting:attendance_sessions!correction_requests_resulting_session_id_fkey(id, check_in_at, check_out_at)",
].join(", ");

export type CorrectionQuery = {
  status: "pendiente" | "revisadas" | "todas";
  workerId?: string | null;
  facilityId?: string | null;
  limit?: number;
};

/**
 * Solicitudes de corrección visibles (RLS: administración todas; coordinación
 * las de sus sedes; cada persona las suyas). Pendientes de la más antigua a la
 * más reciente; revisadas de la más reciente a la más antigua.
 */
export async function loadCorrections(supabase: ServerSupabase, query: CorrectionQuery): Promise<{ items: CorrectionListItem[]; truncated: boolean }> {
  const limit = query.limit ?? 200;
  let q = supabase.from("correction_requests").select(CORRECTION_SELECT);
  if (query.status === "pendiente") q = q.eq("status", "pendiente").order("created_at", { ascending: true });
  else if (query.status === "revisadas") q = q.neq("status", "pendiente").order("reviewed_at", { ascending: false });
  else q = q.order("created_at", { ascending: false });
  if (query.workerId) q = q.eq("worker_id", query.workerId);
  if (query.facilityId) q = q.eq("facility_id", query.facilityId);
  const { data, error } = await q.limit(limit + 1).overrideTypes<CorrectionListItem[], { merge: false }>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return { items: rows.slice(0, limit), truncated: rows.length > limit };
}

/** Una solicitud (para mostrar el resultado de una revisión). */
export async function loadCorrection(supabase: ServerSupabase, id: string): Promise<CorrectionListItem | null> {
  const { data, error } = await supabase.from("correction_requests").select(CORRECTION_SELECT).eq("id", id).maybeSingle<CorrectionListItem>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Número de solicitudes pendientes visibles. */
export async function countPendingCorrections(supabase: ServerSupabase, facilityId?: string | null): Promise<number> {
  let q = supabase.from("correction_requests").select("id", { count: "exact", head: true }).eq("status", "pendiente");
  if (facilityId) q = q.eq("facility_id", facilityId);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}
