import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import { summarizeAttendance, type AttendanceSummary } from "./calc";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { getSettingNumber } from "@/lib/data/catalogs";

type Tables = Database["public"]["Tables"];
export type ShiftRow = Tables["shifts"]["Row"];
export type AssignmentRow = Tables["shift_assignments"]["Row"];
export type SessionRow = Tables["attendance_sessions"]["Row"];
export type ShiftStatus = Database["public"]["Enums"]["shift_status"];

export type ShiftFacility = {
  id: string;
  official_name: string;
  timezone: string;
  arrival_tolerance_minutes: number;
  state_id: number;
  municipality_id: number | null;
};
export type WorkerRef = { id: string; full_name: string; internal_code: string; area: string | null; position: string | null; facility_id: string | null };

export type AssignmentWithAttendance = {
  assignment: AssignmentRow;
  worker: WorkerRef | null;
  substituteFor: { id: string; full_name: string } | null;
  /** Todas las versiones (vigentes, corregidas y anuladas) para trazabilidad. */
  sessions: SessionRow[];
  summary: AttendanceSummary;
};

export type ShiftWithAttendance = {
  shift: ShiftRow;
  effectiveStatus: ShiftStatus;
  facility: ShiftFacility | null;
  responsible: { id: string; full_name: string } | null;
  assignments: AssignmentWithAttendance[];
  coverage: {
    assigned: number;
    inService: number;
    minStaff: number;
    maxStaff: number | null;
    /** En curso con menos personas en servicio que el mínimo, o futura con menos asignadas que el mínimo. */
    insufficient: boolean;
  };
};

export type LoadFilters = {
  /** Guardias que se traslapan con [from, to). */
  from: Date;
  to: Date;
  facilityIds?: string[] | null;
  shiftIds?: string[] | null;
  /** Solo asignaciones de este trabajador. */
  workerId?: string | null;
  stateId?: number | null;
  includeCancelled?: boolean;
  now?: Date;
};

const SHIFT_SELECT =
  "*, effective_status, facility:facilities!shifts_facility_id_fkey(id, official_name, timezone, arrival_tolerance_minutes, state_id, municipality_id), responsible:workers!shifts_responsible_worker_id_fkey(id, full_name)";

const ASSIGNMENT_SELECT =
  "*, worker:workers!shift_assignments_worker_id_fkey(id, full_name, internal_code, area, position, facility_id), substitute:workers!shift_assignments_substitute_for_worker_id_fkey(id, full_name)";

type ShiftQueryRow = ShiftRow & {
  effective_status: ShiftStatus;
  facility: ShiftFacility | null;
  responsible: { id: string; full_name: string } | null;
};
type AssignmentQueryRow = AssignmentRow & {
  worker: WorkerRef | null;
  substitute: { id: string; full_name: string } | null;
};

/**
 * Carga guardias con asignaciones, sesiones y el cálculo de asistencia.
 * Usa el cliente del usuario: RLS limita lo que se ve.
 */
export async function loadShiftsWithAttendance(supabase: ServerSupabase, filters: LoadFilters): Promise<ShiftWithAttendance[]> {
  const now = filters.now ?? new Date();
  if (filters.facilityIds && filters.facilityIds.length === 0) return [];

  let shiftIdFilter = filters.shiftIds ?? null;
  if (filters.workerId) {
    const own = await fetchAll<{ shift_id: string }>((from, to) =>
      supabase.from("shift_assignments").select("shift_id").eq("worker_id", filters.workerId as string).range(from, to),
    );
    const ids = [...new Set(own.map((a) => a.shift_id))];
    shiftIdFilter = shiftIdFilter ? shiftIdFilter.filter((id) => ids.includes(id)) : ids;
    if (shiftIdFilter.length === 0) return [];
  }

  const shiftBatches = shiftIdFilter ? chunk(shiftIdFilter) : [null];
  const shifts: ShiftQueryRow[] = [];
  for (const batch of shiftBatches) {
    const rows = await fetchAll<ShiftQueryRow>((from, to) => {
      let q = supabase
        .from("shifts")
        .select(SHIFT_SELECT)
        .lt("starts_at", filters.to.toISOString())
        .gt("ends_at", filters.from.toISOString())
        .order("starts_at")
        .range(from, to);
      if (batch) q = q.in("id", batch);
      if (filters.facilityIds) q = q.in("facility_id", filters.facilityIds);
      if (!filters.includeCancelled) q = q.neq("status", "cancelada");
      return q as unknown as PromiseLike<{ data: ShiftQueryRow[] | null; error: { message: string } | null }>;
    });
    shifts.push(...rows);
  }

  const filteredShifts = filters.stateId ? shifts.filter((s) => s.facility?.state_id === filters.stateId) : shifts;
  if (filteredShifts.length === 0) return [];

  const assignments: AssignmentQueryRow[] = [];
  for (const batch of chunk(filteredShifts.map((s) => s.id))) {
    const rows = await fetchAll<AssignmentQueryRow>((from, to) => {
      let q = supabase.from("shift_assignments").select(ASSIGNMENT_SELECT).in("shift_id", batch).order("created_at").range(from, to);
      if (filters.workerId) q = q.eq("worker_id", filters.workerId);
      return q as unknown as PromiseLike<{ data: AssignmentQueryRow[] | null; error: { message: string } | null }>;
    });
    assignments.push(...rows);
  }

  const sessions: SessionRow[] = [];
  for (const batch of chunk(assignments.map((a) => a.id))) {
    const rows = await fetchAll<SessionRow>((from, to) =>
      supabase.from("attendance_sessions").select("*").in("assignment_id", batch).order("check_in_at").range(from, to),
    );
    sessions.push(...rows);
  }

  const grace = await getSettingNumber(supabase, "attendance", "open_session_grace_minutes", 240);

  const sessionsByAssignment = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const list = sessionsByAssignment.get(s.assignment_id) ?? [];
    list.push(s);
    sessionsByAssignment.set(s.assignment_id, list);
  }
  const assignmentsByShift = new Map<string, AssignmentQueryRow[]>();
  for (const a of assignments) {
    const list = assignmentsByShift.get(a.shift_id) ?? [];
    list.push(a);
    assignmentsByShift.set(a.shift_id, list);
  }

  return filteredShifts.map((shift) => {
    const tolerance = shift.facility?.arrival_tolerance_minutes ?? 10;
    const items: AssignmentWithAttendance[] = (assignmentsByShift.get(shift.id) ?? []).map((a) => {
      const own = sessionsByAssignment.get(a.id) ?? [];
      const summary = summarizeAttendance(
        { startsAt: shift.starts_at, endsAt: shift.ends_at, status: shift.status },
        { status: a.status, substituteForWorkerId: a.substitute_for_worker_id },
        own.map((s) => ({
          id: s.id,
          checkInAt: s.check_in_at,
          checkOutAt: s.check_out_at,
          recordStatus: s.record_status,
          checkInMethod: s.check_in_method,
          checkOutMethod: s.check_out_method,
          supersedesId: s.supersedes_id,
        })),
        { toleranceMinutes: tolerance, openSessionGraceMinutes: grace, now },
      );
      const { worker, substitute, ...assignment } = a;
      return { assignment: assignment as AssignmentRow, worker, substituteFor: substitute, sessions: own, summary };
    });

    const active = items.filter((i) => i.assignment.status === "asignado");
    const inService = items.filter((i) => i.summary.status === "en_servicio").length;
    const status = shift.effective_status;
    const insufficient =
      status === "en_curso"
        ? inService < shift.min_staff
        : status === "programada"
          ? active.length < shift.min_staff
          : false;

    const { facility, responsible, effective_status, ...rest } = shift;
    void effective_status;
    return {
      shift: rest as ShiftRow,
      effectiveStatus: status,
      facility,
      responsible,
      assignments: items,
      coverage: { assigned: active.length, inService, minStaff: shift.min_staff, maxStaff: shift.max_staff, insufficient },
    };
  });
}
