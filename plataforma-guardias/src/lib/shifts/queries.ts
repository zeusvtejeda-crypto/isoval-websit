import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import type { SessionUser } from "@/lib/auth";
import { canManageFacility } from "@/lib/auth";
import { getFacilityOptions, type FacilityOption } from "@/lib/data/catalogs";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import type { WorkerOption } from "./types";

type Tables = Database["public"]["Tables"];
export type ShiftRow = Tables["shifts"]["Row"];
export type IncidentNoteRow = Tables["incident_notes"]["Row"];
export type CorrectionRequestRow = Tables["correction_requests"]["Row"];
type ShiftStatus = Database["public"]["Enums"]["shift_status"];

/** Sedes visibles (consulta) para filtros: admin = todas; resto = su alcance. */
export async function getVisibleFacilities(supabase: ServerSupabase, user: SessionUser): Promise<FacilityOption[]> {
  return getFacilityOptions(supabase, user.isAdmin ? null : user.facilityIds);
}

/** Sedes donde el usuario puede programar guardias. */
export async function getManageableFacilities(supabase: ServerSupabase, user: SessionUser): Promise<FacilityOption[]> {
  if (!user.canManage) return [];
  const options = await getFacilityOptions(supabase, user.isAdmin ? null : user.facilityIds);
  return options.filter((f) => canManageFacility(user, f.id));
}

export type ShiftContext = {
  shift: { id: string; facility_id: string; status: ShiftStatus; starts_at: string; ends_at: string; meeting_point: string; title: string | null };
  timezone: string;
};

type ShiftContextRow = ShiftContext["shift"] & { facility: { timezone: string } | null };

/** Guardia mínima con la zona horaria de su sede (RLS aplica). */
export async function getShiftContext(supabase: ServerSupabase, shiftId: string): Promise<ShiftContext | null> {
  const { data, error } = await supabase
    .from("shifts")
    .select("id, facility_id, status, starts_at, ends_at, meeting_point, title, facility:facilities!shifts_facility_id_fkey(timezone)")
    .eq("id", shiftId)
    .maybeSingle<ShiftContextRow>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { facility, ...shift } = data;
  return { shift, timezone: facility?.timezone ?? DEFAULT_TIMEZONE };
}

export type AssignmentContext = ShiftContext & {
  assignment: { id: string; shift_id: string; worker_id: string; status: Database["public"]["Enums"]["assignment_status"] };
};

export async function getAssignmentContext(supabase: ServerSupabase, assignmentId: string): Promise<AssignmentContext | null> {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select("id, shift_id, worker_id, status")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const ctx = await getShiftContext(supabase, data.shift_id);
  return ctx ? { ...ctx, assignment: data } : null;
}

export type SessionContext = ShiftContext & {
  session: { id: string; assignment_id: string; shift_id: string; worker_id: string; record_status: Database["public"]["Enums"]["record_status"] };
};

export async function getSessionContext(supabase: ServerSupabase, sessionId: string): Promise<SessionContext | null> {
  const { data, error } = await supabase
    .from("attendance_sessions")
    .select("id, assignment_id, shift_id, worker_id, record_status")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const ctx = await getShiftContext(supabase, data.shift_id);
  return ctx ? { ...ctx, session: data } : null;
}

/** Guardia completa (para editar). */
export async function getShiftRow(supabase: ServerSupabase, shiftId: string): Promise<ShiftRow | null> {
  const { data, error } = await supabase.from("shifts").select("*").eq("id", shiftId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ShiftRow | null) ?? null;
}

export async function countAssignments(supabase: ServerSupabase, shiftId: string): Promise<number> {
  const { count, error } = await supabase
    .from("shift_assignments")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Asignaciones activas («Asignado»): las que ocupan el cupo máximo. */
export async function countActiveAssignments(supabase: ServerSupabase, shiftId: string): Promise<number> {
  const { count, error } = await supabase
    .from("shift_assignments")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId)
    .eq("status", "asignado");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type OverlappingShift = { id: string; starts_at: string; ends_at: string; title: string | null; meeting_point: string };

type OverlapRow = { id: string; shift: OverlappingShift & { status: ShiftStatus } };

/**
 * Otra guardia no cancelada en la que la persona tiene una asignación activa y
 * cuyo horario se traslapa con [inicio, término). Las consecutivas no cuentan.
 * Solo ve lo que RLS permita; la BD lo revisa en todas las sedes (app.check_assignment).
 */
export async function findOverlappingAssignment(
  supabase: ServerSupabase,
  workerId: string,
  range: { starts_at: string; ends_at: string },
  excludeShiftId: string,
): Promise<OverlappingShift | null> {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select("id, shift:shifts!inner(id, starts_at, ends_at, title, meeting_point, status)")
    .eq("worker_id", workerId)
    .eq("status", "asignado")
    .neq("shift_id", excludeShiftId)
    .neq("shift.status", "cancelada")
    .lt("shift.starts_at", range.ends_at)
    .gt("shift.ends_at", range.starts_at)
    .limit(1)
    .overrideTypes<OverlapRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  const shift = data?.[0]?.shift;
  if (!shift) return null;
  return { id: shift.id, starts_at: shift.starts_at, ends_at: shift.ends_at, title: shift.title, meeting_point: shift.meeting_point };
}

/** Personas con entrada abierta (vigente, sin salida) en la guardia. */
export async function countOpenSessions(supabase: ServerSupabase, shiftId: string): Promise<number> {
  const { count, error } = await supabase
    .from("attendance_sessions")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId)
    .eq("record_status", "vigente")
    .is("check_out_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Registros de asistencia vigentes (con o sin salida) de la guardia. */
export async function countValidSessions(supabase: ServerSupabase, shiftId: string): Promise<number> {
  const { count, error } = await supabase
    .from("attendance_sessions")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId)
    .eq("record_status", "vigente");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Trabajadores activos adscritos a una sede (orden alfabético). */
export async function getActiveWorkersOfFacility(supabase: ServerSupabase, facilityId: string): Promise<WorkerOption[]> {
  return fetchAll<WorkerOption>((from, to) =>
    supabase
      .from("workers")
      .select("id, full_name, internal_code, facility_id")
      .eq("active", true)
      .eq("facility_id", facilityId)
      .order("full_name")
      .range(from, to),
  );
}

type WorkerWithFacilityRow = { id: string; full_name: string; internal_code: string; facility_id: string | null; facility: { official_name: string } | null };

/** Trabajadores activos visibles de otras sedes (sustituciones). Limitado para no saturar la lista. */
export async function getOtherActiveWorkers(supabase: ServerSupabase, facilityId: string, limit = 400): Promise<{ workers: WorkerOption[]; truncated: boolean }> {
  const { data, error } = await supabase
    .from("workers")
    .select("id, full_name, internal_code, facility_id, facility:facilities!workers_facility_id_fkey(official_name)")
    .eq("active", true)
    .or(`facility_id.is.null,facility_id.neq.${facilityId}`)
    .order("full_name")
    .limit(limit + 1)
    .overrideTypes<WorkerWithFacilityRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    workers: rows.slice(0, limit).map((w) => ({
      id: w.id,
      full_name: w.full_name,
      internal_code: w.internal_code,
      facility_id: w.facility_id,
      facility_name: w.facility?.official_name ?? null,
    })),
    truncated: rows.length > limit,
  };
}

/** Nombres visibles de cuentas (lo que RLS permita leer). */
export async function getProfileNames(supabase: ServerSupabase, ids: string[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const batch of chunk([...new Set(ids)])) {
    if (batch.length === 0) continue;
    const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", batch);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) {
      if (p.display_name) names[p.id] = p.display_name;
    }
  }
  return names;
}

/** Cuenta de acceso vinculada a cada trabajador (si RLS permite verla). */
export async function getWorkerProfileIds(supabase: ServerSupabase, workerIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const batch of chunk([...new Set(workerIds)])) {
    if (batch.length === 0) continue;
    const { data, error } = await supabase.from("profiles").select("id, worker_id").in("worker_id", batch);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) {
      if (p.worker_id) out[p.worker_id] = p.id;
    }
  }
  return out;
}

export async function getIncidentNotes(supabase: ServerSupabase, assignmentIds: string[]): Promise<IncidentNoteRow[]> {
  const out: IncidentNoteRow[] = [];
  for (const batch of chunk(assignmentIds)) {
    if (batch.length === 0) continue;
    const rows = await fetchAll<IncidentNoteRow>((from, to) =>
      supabase.from("incident_notes").select("*").in("assignment_id", batch).order("created_at").range(from, to),
    );
    out.push(...rows);
  }
  return out;
}

export async function getPendingCorrections(supabase: ServerSupabase, assignmentIds: string[]): Promise<CorrectionRequestRow[]> {
  const out: CorrectionRequestRow[] = [];
  for (const batch of chunk(assignmentIds)) {
    if (batch.length === 0) continue;
    const rows = await fetchAll<CorrectionRequestRow>((from, to) =>
      supabase
        .from("correction_requests")
        .select("*")
        .in("assignment_id", batch)
        .eq("status", "pendiente")
        .order("created_at")
        .range(from, to),
    );
    out.push(...rows);
  }
  return out;
}

/** Identificador de solicitud generado en el servidor al mostrar un formulario (idempotencia). */
export function newRequestId(): string {
  return crypto.randomUUID();
}
