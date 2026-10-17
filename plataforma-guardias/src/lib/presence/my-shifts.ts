import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/actions";
import { buildMyShifts, type MyAssignmentRow, type MyShiftView, type OwnSession, type WorkerRules } from "./worker";

const DAY = 86_400_000;
const SESSION_COLUMNS = "id, assignment_id, check_in_at, check_out_at, record_status, check_in_method, check_out_method, supersedes_id";

export type MyShiftsData = {
  views: MyShiftView[];
  rules: WorkerRules;
  /** Hora del servidor de la aplicación al cargar. */
  loadedAt: Date;
};

async function loadRules(supabase: ServerSupabase): Promise<WorkerRules> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "attendance").maybeSingle();
  const value = (data?.value ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    windowBeforeMinutes: num(value.checkin_window_before_minutes, 120),
    graceMinutes: num(value.open_session_grace_minutes, 240),
  };
}

async function myAssignments(supabase: ServerSupabase, from: Date, to: Date): Promise<MyAssignmentRow[]> {
  const { data, error } = await supabase.rpc("get_my_assignments", { p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw new Error(friendlyDbError(error, "No se pudieron cargar tus guardias."));
  return (data ?? []) as MyAssignmentRow[];
}

/**
 * Asignaciones propias (ayer a +14 días) con sus sesiones, más la guardia de
 * cualquier entrada abierta aunque quede fuera de la ventana.
 * Las sesiones se filtran por worker_id: el personal de coordinación con
 * registro de trabajador vería por RLS también las de su sede.
 */
export async function loadMyShifts(supabase: ServerSupabase, workerId: string, now: Date = new Date()): Promise<MyShiftsData> {
  const [rows, rules, openRes] = await Promise.all([
    myAssignments(supabase, new Date(now.getTime() - DAY), new Date(now.getTime() + 14 * DAY)),
    loadRules(supabase),
    supabase
      .from("attendance_sessions")
      .select(SESSION_COLUMNS)
      .eq("worker_id", workerId)
      .is("check_out_at", null)
      .eq("record_status", "vigente")
      .order("check_in_at", { ascending: false })
      .limit(1),
  ]);
  if (openRes.error) throw new Error(friendlyDbError(openRes.error, "No se pudieron cargar tus registros."));

  const open = (openRes.data?.[0] ?? null) as OwnSession | null;
  if (open && !rows.some((r) => r.assignment_id === open.assignment_id)) {
    const at = Date.parse(open.check_in_at);
    const extra = await myAssignments(supabase, new Date(at - 2 * DAY), new Date(at + 2 * DAY));
    const row = extra.find((r) => r.assignment_id === open.assignment_id);
    if (row) rows.push(row);
  }

  let sessions: OwnSession[] = [];
  const ids = [...new Set(rows.map((r) => r.assignment_id))];
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("attendance_sessions")
      .select(SESSION_COLUMNS)
      .eq("worker_id", workerId)
      .in("assignment_id", ids)
      .order("check_in_at");
    if (error) throw new Error(friendlyDbError(error, "No se pudieron cargar tus registros."));
    sessions = (data ?? []) as OwnSession[];
  }
  // Aunque no se encuentre su guardia, la entrada abierta bloquea registrar otra entrada.
  if (open && !sessions.some((s) => s.id === open.id)) sessions.push(open);

  return { views: buildMyShifts(rows, sessions, now, rules), rules, loadedAt: now };
}
