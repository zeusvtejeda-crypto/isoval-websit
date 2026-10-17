import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions de guardias con la BD simulada: validación previa (separación
 * de funciones, ventana de captura, horario bloqueado) y limpieza del motivo
 * guardado antes de cada escritura con change_reason.
 */

const MAZ = "America/Mazatlan";
const FAC = "d0000000-0000-4000-8000-000000000001";
const OTHER = "d0000000-0000-4000-8000-000000000002";
const SHIFT = "d2000000-0000-4000-8000-000000000001";
const ASSIGNMENT = "d3000000-0000-4000-8000-000000000001";
const SESSION = "d4000000-0000-4000-8000-000000000001";
const REQUEST = "d5000000-0000-4000-8000-000000000001";

type Op = { table: string; op: string; payload?: unknown };

const h = vi.hoisted(() => ({
  log: [] as string[],
  ops: [] as Op[],
  user: null as unknown as { id: string; isAdmin: boolean; workerId: string | null; facilityIds: string[]; role: string },
  shiftCtx: null as unknown,
  assignmentCtx: null as unknown,
  sessionCtx: null as unknown,
  assignments: 0,
  validSessions: 0,
  sessionCount: 0,
  facility: null as unknown,
  writeError: null as unknown,
  rpcError: null as unknown,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/auth", () => ({
  requireManager: vi.fn(async () => h.user),
  canManageFacility: (u: { isAdmin: boolean; facilityIds: string[] }, f: string) => u.isAdmin || u.facilityIds.includes(f),
}));
vi.mock("@/lib/reason", () => ({
  clearStoredReason: vi.fn(async (_s: unknown, table: string, id: string) => {
    h.log.push(`clear:${table}:${id}`);
    return null;
  }),
}));
vi.mock("@/lib/shifts/queries", () => ({
  getShiftContext: vi.fn(async () => h.shiftCtx),
  getAssignmentContext: vi.fn(async () => h.assignmentCtx),
  getSessionContext: vi.fn(async () => h.sessionCtx),
  countAssignments: vi.fn(async () => h.assignments),
  countValidSessions: vi.fn(async () => {
    h.log.push("countValidSessions");
    return h.validSessions;
  }),
}));

function chain(table: string) {
  let result: Record<string, unknown> = { data: null, error: null };
  const c: Record<string, unknown> = {};
  const self = () => c;
  for (const m of ["eq", "in", "is", "order", "range", "or", "limit"]) c[m] = self;
  c.select = (_cols?: string, opts?: { head?: boolean }) => {
    if (opts?.head) result = { count: h.sessionCount, error: null };
    return c;
  };
  c.update = (payload: unknown) => {
    h.log.push(`update:${table}`);
    h.ops.push({ table, op: "update", payload });
    result = { error: h.writeError };
    return c;
  };
  c.insert = (payload: unknown) => {
    h.log.push(`insert:${table}`);
    h.ops.push({ table, op: "insert", payload });
    result = { data: { id: SHIFT }, error: h.writeError };
    return c;
  };
  c.upsert = (payload: unknown) => {
    h.log.push(`upsert:${table}`);
    h.ops.push({ table, op: "upsert", payload });
    result = { error: h.writeError };
    return c;
  };
  c.delete = () => {
    h.log.push(`delete:${table}`);
    result = { error: null };
    return c;
  };
  c.maybeSingle = async () => {
    if (table === "facilities") return { data: h.facility, error: null };
    if (table === "shifts") return { data: { responsible_worker_id: null }, error: null };
    return { data: null, error: null };
  };
  c.single = async () => result;
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => chain(table),
    rpc: async (name: string) => {
      h.log.push(`rpc:${name}`);
      return { data: { result: "created" }, error: h.rpcError };
    },
  }),
}));

import { saveShift, setShiftStatus } from "@/app/(app)/guardias/actions";
import {
  addManualSession,
  changeAssignmentStatus,
  correctSession,
  removeAssignment,
  saveIncidentNote,
  voidSession,
} from "@/app/(app)/guardias/[id]/actions";
import { FACILITY_LOCKED_NOTICE, OUTSIDE_WINDOW_MESSAGE, OWN_RECORD_DB_MESSAGE, SCHEDULE_LOCKED_NOTICE } from "@/lib/shifts/rules";

const coordinator = { id: "p-coord", isAdmin: false, workerId: "w-coord", facilityIds: [FAC, OTHER], role: "coordinador" };
const admin = { id: "p-admin", isAdmin: true, workerId: "w-admin", facilityIds: [], role: "admin" };

// Guardia 22:00 (17/10) – 06:00 (18/10) en Mazatlán.
const shift = {
  id: SHIFT,
  facility_id: FAC,
  status: "programada",
  starts_at: "2026-10-18T05:00:00Z",
  ends_at: "2026-10-18T13:00:00Z",
  meeting_point: "Acceso",
  title: null,
};

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

const editForm = (overrides: Record<string, string> = {}) =>
  form({
    id: SHIFT,
    facility_id: FAC,
    meeting_point: "Acceso",
    date: "2026-10-17",
    start_time: "22:00",
    end_time: "06:00",
    min_staff: "1",
    change_reason: "Cambio de instrucciones",
    ...overrides,
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
  h.log = [];
  h.ops = [];
  h.user = coordinator;
  h.shiftCtx = { shift, timezone: MAZ };
  h.assignmentCtx = { shift, timezone: MAZ, assignment: { id: ASSIGNMENT, shift_id: SHIFT, worker_id: "w1", status: "asignado" } };
  h.sessionCtx = { shift, timezone: MAZ, session: { id: SESSION, assignment_id: ASSIGNMENT, shift_id: SHIFT, worker_id: "w1", record_status: "vigente" } };
  h.assignments = 1;
  h.validSessions = 0;
  h.sessionCount = 0;
  h.facility = { id: FAC, timezone: MAZ, active: true };
  h.writeError = null;
  h.rpcError = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saveShift (edición)", () => {
  it("sin cambiar fecha ni horas conserva el horario y limpia el motivo guardado antes de escribir", async () => {
    h.validSessions = 3;
    await expect(saveShift(null, editForm())).rejects.toThrow(`NEXT_REDIRECT:/guardias/${SHIFT}`);
    expect(h.log).toEqual([`clear:shifts:${SHIFT}`, "update:shifts"]);
    const payload = h.ops[0].payload as Record<string, unknown>;
    expect(payload.starts_at).toBe("2026-10-18T05:00:00.000Z");
    expect(payload.ends_at).toBe("2026-10-18T13:00:00.000Z");
    expect(payload.change_reason).toBe("Cambio de instrucciones");
  });

  it("coordinación no cambia el horario si ya hay asistencia vigente", async () => {
    h.validSessions = 1;
    const r = await saveShift(null, editForm({ start_time: "21:00" }));
    expect(r).toMatchObject({ ok: false, message: SCHEDULE_LOCKED_NOTICE });
    expect(h.log).toEqual(["countValidSessions"]);
  });

  it("coordinación sí cambia el horario cuando no hay asistencia vigente", async () => {
    h.validSessions = 0;
    await expect(saveShift(null, editForm({ start_time: "21:00" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(h.log).toEqual(["countValidSessions", `clear:shifts:${SHIFT}`, "update:shifts"]);
    expect((h.ops[0].payload as Record<string, unknown>).starts_at).toBe("2026-10-18T04:00:00.000Z");
  });

  it("administración puede cambiar el horario; si la BD rechaza, se muestra su mensaje tal cual", async () => {
    h.user = admin;
    h.validSessions = 4;
    h.writeError = { code: "22023", message: "La guardia ya tiene registros de asistencia: su horario solo lo puede cambiar administración" };
    const r = await saveShift(null, editForm({ start_time: "21:00" }));
    expect(r).toEqual({ ok: false, message: "La guardia ya tiene registros de asistencia: su horario solo lo puede cambiar administración" });
    expect(h.log).toEqual([`clear:shifts:${SHIFT}`, "update:shifts"]);
  });

  it("no cambia la sede de una guardia con asignaciones", async () => {
    h.assignments = 2;
    h.facility = { id: OTHER, timezone: MAZ, active: true };
    const r = await saveShift(null, editForm({ facility_id: OTHER }));
    expect(r).toMatchObject({ ok: false, message: FACILITY_LOCKED_NOTICE });
    expect(h.log).toEqual([]);
  });

  it("alta: inserta sin limpiar (no hay motivo guardado)", async () => {
    h.shiftCtx = null;
    const fd = editForm();
    fd.delete("id");
    fd.delete("change_reason");
    await expect(saveShift(null, fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(h.log).toEqual(["insert:shifts"]);
  });
});

describe("setShiftStatus", () => {
  it("limpia el motivo guardado antes de cambiar el estado", async () => {
    const r = await setShiftStatus(null, form({ shift_id: SHIFT, status: "cancelada", reason: "Sin personal disponible" }));
    expect(r.ok).toBe(true);
    expect(h.log).toEqual([`clear:shifts:${SHIFT}`, "update:shifts"]);
    expect(h.ops[0].payload).toMatchObject({ status: "cancelada", cancel_reason: "Sin personal disponible", change_reason: "Sin personal disponible" });
  });
});

describe("acciones sobre asignaciones y registros", () => {
  it("quitar asignación: limpia, guarda el motivo y después borra", async () => {
    const r = await removeAssignment(null, form({ assignment_id: ASSIGNMENT, reason: "Asignada por error" }));
    expect(r.ok).toBe(true);
    expect(h.log).toEqual([`clear:shift_assignments:${ASSIGNMENT}`, "update:shift_assignments", "delete:shift_assignments"]);
    expect(h.ops[0].payload).toEqual({ change_reason: "Asignada por error" });
  });

  it("propia asistencia: coordinación no corrige, anula, agrega, cambia estado ni justifica", async () => {
    h.user = { ...coordinator, workerId: "w1" };
    const results = await Promise.all([
      correctSession(null, form({ session_id: SESSION, check_in: "2026-10-17T22:00", reason: "Hora mal capturada" })),
      voidSession(null, form({ session_id: SESSION, reason: "Registro duplicado" })),
      addManualSession(
        null,
        form({ assignment_id: ASSIGNMENT, request_id: REQUEST, check_in: "2026-10-17T22:00", check_out: "2026-10-18T06:00", reason: "No pudo registrar" }),
      ),
      changeAssignmentStatus(null, form({ assignment_id: ASSIGNMENT, status: "ausencia_justificada", reason: "Incapacidad médica" })),
      saveIncidentNote(null, form({ assignment_id: ASSIGNMENT, incident_type: "llegada_tardia", note: "Tráfico" })),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, message: OWN_RECORD_DB_MESSAGE });
    expect(h.log).toEqual([]);
  });

  it("administración sí puede actuar sobre su propia asignación", async () => {
    h.user = { ...admin, workerId: "w1" };
    const r = await changeAssignmentStatus(null, form({ assignment_id: ASSIGNMENT, status: "ausencia_justificada", reason: "Incapacidad médica" }));
    expect(r.ok).toBe(true);
    expect(h.log).toEqual(["rpc:set_assignment_status"]);
  });

  it("corrección: valida la ventana de la guardia ±12 h antes de llamar a la BD", async () => {
    // 09:00 del 17/10 en Mazatlán = 16:00 UTC, una hora antes del límite (17:00 UTC).
    const out = await correctSession(null, form({ session_id: SESSION, check_in: "2026-10-17T09:00", reason: "Hora mal capturada" }));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toBe(`${OUTSIDE_WINDOW_MESSAGE}: entre 17/10/2026 10:00 y 18/10/2026 18:00.`);
      expect(out.fieldErrors?.check_in).toBeDefined();
    }
    expect(h.log).toEqual([]);

    const ok = await correctSession(
      null,
      form({ session_id: SESSION, check_in: "2026-10-17T22:05", check_out: "2026-10-18T06:00", reason: "Hora mal capturada" }),
    );
    expect(ok.ok).toBe(true);
    expect(h.log).toEqual(["rpc:correct_attendance"]);
  });

  it("corrección: muestra el mensaje de la BD tal cual", async () => {
    h.rpcError = { code: "42501", message: OWN_RECORD_DB_MESSAGE };
    const r = await correctSession(null, form({ session_id: SESSION, check_in: "2026-10-17T22:05", reason: "Hora mal capturada" }));
    expect(r).toEqual({ ok: false, message: OWN_RECORD_DB_MESSAGE });
  });

  it("registro manual: guardia cancelada, asignación inactiva y horas fuera de la ventana no llegan a la BD", async () => {
    const manual = (entries: Record<string, string> = {}) =>
      form({ assignment_id: ASSIGNMENT, request_id: REQUEST, check_in: "2026-10-17T22:00", check_out: "2026-10-18T06:00", reason: "No pudo registrar", ...entries });

    h.assignmentCtx = { shift: { ...shift, status: "cancelada" }, timezone: MAZ, assignment: { id: ASSIGNMENT, shift_id: SHIFT, worker_id: "w1", status: "asignado" } };
    expect(await addManualSession(null, manual())).toEqual({ ok: false, message: "La guardia está cancelada: no se agregan registros." });

    h.assignmentCtx = { shift, timezone: MAZ, assignment: { id: ASSIGNMENT, shift_id: SHIFT, worker_id: "w1", status: "cancelado" } };
    const inactive = await addManualSession(null, manual());
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) expect(inactive.message).toMatch(/^La asignación no está activa \(Asignación cancelada\)/);

    h.assignmentCtx = { shift, timezone: MAZ, assignment: { id: ASSIGNMENT, shift_id: SHIFT, worker_id: "w1", status: "asignado" } };
    const late = await addManualSession(null, manual({ check_out: "2026-10-18T19:00" }));
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.fieldErrors).toHaveProperty("check_out");
    expect(h.log).toEqual([]);

    const ok = await addManualSession(null, manual());
    expect(ok).toEqual({ ok: true, message: "Registro manual agregado (corrección administrativa)." });
    expect(h.log).toEqual(["rpc:add_manual_attendance"]);
  });
});
