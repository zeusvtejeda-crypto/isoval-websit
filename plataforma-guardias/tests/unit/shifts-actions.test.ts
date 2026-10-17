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
  activeAssignments: 0,
  overlap: null as unknown,
  rows: {} as Record<string, unknown>,
  validSessions: 0,
  sessionCount: 0,
  /** Conteos por tabla (si no se indica, se usa sessionCount). */
  counts: {} as Record<string, number>,
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
  countActiveAssignments: vi.fn(async () => {
    h.log.push("countActiveAssignments");
    return h.activeAssignments;
  }),
  findOverlappingAssignment: vi.fn(async () => {
    h.log.push("findOverlappingAssignment");
    return h.overlap;
  }),
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
    if (opts?.head) result = { count: h.counts[table] ?? h.sessionCount, error: null };
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
    if (table in h.rows) return { data: h.rows[table], error: null };
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
  addAssignment,
  addManualSession,
  changeAssignmentStatus,
  correctSession,
  removeAssignment,
  saveIncidentNote,
  updateAssignment,
  voidSession,
} from "@/app/(app)/guardias/[id]/actions";
import { CONSECUTIVE_SHIFTS_NOTE, FACILITY_LOCKED_NOTICE, OUTSIDE_WINDOW_MESSAGE, OWN_RECORD_DB_MESSAGE, SCHEDULE_LOCKED_NOTICE } from "@/lib/shifts/rules";

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
  h.activeAssignments = 1;
  h.overlap = null;
  h.rows = {};
  h.validSessions = 0;
  h.sessionCount = 0;
  h.counts = {};
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
    // Antes de cancelar se revisa que no haya asistencia vigente.
    expect(h.log).toEqual(["countValidSessions", `clear:shifts:${SHIFT}`, "update:shifts"]);
    expect(h.ops[0].payload).toMatchObject({ status: "cancelada", cancel_reason: "Sin personal disponible", change_reason: "Sin personal disponible" });
  });

  it("no cancela una guardia con asistencia vigente (coordinación)", async () => {
    h.validSessions = 2;
    const r = await setShiftStatus(null, form({ shift_id: SHIFT, status: "cancelada", reason: "Sin personal disponible" }));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.message).toMatch(/registros de asistencia vigentes/);
    expect(h.log).toEqual(["countValidSessions"]);
  });
});

describe("acciones sobre asignaciones y registros", () => {
  it("quitar asignación: limpia, guarda el motivo y después borra", async () => {
    const r = await removeAssignment(null, form({ assignment_id: ASSIGNMENT, reason: "Asignada por error" }));
    expect(r.ok).toBe(true);
    expect(h.log).toEqual([`clear:shift_assignments:${ASSIGNMENT}`, "update:shift_assignments", "delete:shift_assignments"]);
    expect(h.ops[0].payload).toEqual({ change_reason: "Asignada por error" });
  });

  it("quitar asignación: no borra una asignación con estado registrado ni con historia", async () => {
    h.assignmentCtx = { shift, timezone: MAZ, assignment: { id: ASSIGNMENT, shift_id: SHIFT, worker_id: "w1", status: "inasistencia_confirmada" } };
    const absent = await removeAssignment(null, form({ assignment_id: ASSIGNMENT, reason: "Asignada por error" }));
    expect(absent).toMatchObject({ ok: false });
    expect(absent.ok ? "" : absent.message).toMatch(/Asignación cancelada/);

    h.assignmentCtx = { shift, timezone: MAZ, assignment: { id: ASSIGNMENT, shift_id: SHIFT, worker_id: "w1", status: "asignado" } };
    for (const table of ["attendance_sessions", "incident_notes", "correction_requests"]) {
      h.counts = { [table]: 1 };
      const withHistory = await removeAssignment(null, form({ assignment_id: ASSIGNMENT, reason: "Asignada por error" }));
      expect(withHistory, table).toMatchObject({ ok: false });
      expect(withHistory.ok ? "" : withHistory.message).toMatch(/no puede quitarse/);
    }
    expect(h.log).toEqual([]);
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

describe("cupo máximo y guardias traslapadas", () => {
  it("saveShift no reduce el cupo por debajo de las personas asignadas (antes de escribir)", async () => {
    h.activeAssignments = 3;
    h.rows.shifts = { responsible_worker_id: null, max_staff: 5 };
    const r = await saveShift(null, editForm({ max_staff: "2" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe("La guardia tiene 3 personas asignadas: el cupo máximo no puede ser menor. Quita o cancela asignaciones antes de reducirlo.");
      expect(r.fieldErrors).toHaveProperty("max_staff");
    }
    expect(h.log).toEqual(["countActiveAssignments"]);
  });

  it("saveShift: con el cupo sin cambios no se vuelve a contar; con un cupo suficiente sí se guarda", async () => {
    h.activeAssignments = 3;
    h.rows.shifts = { responsible_worker_id: null, max_staff: 2 };
    await expect(saveShift(null, editForm({ max_staff: "2" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(h.log).toEqual([`clear:shifts:${SHIFT}`, "update:shifts"]);

    h.log = [];
    h.rows.shifts = { responsible_worker_id: null, max_staff: 5 };
    await expect(saveShift(null, editForm({ max_staff: "3" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(h.log).toEqual(["countActiveAssignments", `clear:shifts:${SHIFT}`, "update:shifts"]);
  });

  it("addAssignment rechaza a una persona con otra guardia traslapada sin llegar a la BD", async () => {
    h.rows.workers = { id: "w1", active: true };
    h.overlap = { id: "s-otra", starts_at: "2026-10-18T03:00:00Z", ends_at: "2026-10-18T09:00:00Z", title: "Guardia de urgencias", meeting_point: "Acceso" };
    const r = await addAssignment(null, form({ shift_id: SHIFT, worker_id: "d1000000-0000-4000-8000-000000000001" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/^Esa persona ya está asignada a otra guardia que se traslapa con este horario: Guardia de urgencias, /);
      expect(r.message).toContain(CONSECUTIVE_SHIFTS_NOTE);
      expect(r.fieldErrors).toHaveProperty("worker_id");
    }
    expect(h.log).toEqual(["findOverlappingAssignment"]);

    h.log = [];
    h.overlap = null;
    const ok = await addAssignment(null, form({ shift_id: SHIFT, worker_id: "d1000000-0000-4000-8000-000000000001" }));
    expect(ok.ok).toBe(true);
    expect(h.log).toEqual(["findOverlappingAssignment", "insert:shift_assignments"]);
  });
});

describe("updateAssignment", () => {
  const SUB = "d1000000-0000-4000-8000-000000000009";
  const edit = (entries: Record<string, string> = {}) =>
    form({ assignment_id: ASSIGNMENT, assigned_point: "Puerta norte", substitute_for_worker_id: SUB, notes: "Trae radio", reason: "Cubre una incapacidad", ...entries });

  beforeEach(() => {
    h.rows.shift_assignments = { assigned_point: null, substitute_for_worker_id: null, notes: null, change_reason: "Asignación a la guardia" };
    h.rows.workers = { id: SUB };
  });

  it("guarda punto, «cubre a» y notas con el motivo; la bitácora toma los valores de la BD", async () => {
    const r = await updateAssignment(null, edit());
    expect(r).toEqual({ ok: true, message: "Asignación actualizada. El cambio quedó en la bitácora con su motivo." });
    // El motivo guardado es otro: no hace falta limpiarlo.
    expect(h.log).toEqual(["update:shift_assignments"]);
    expect(h.ops[0].payload).toEqual({ assigned_point: "Puerta norte", substitute_for_worker_id: SUB, notes: "Trae radio", change_reason: "Cubre una incapacidad" });
  });

  it("un motivo igual al guardado se limpia antes; vacío quita el valor", async () => {
    h.rows.shift_assignments = { assigned_point: "Puerta norte", substitute_for_worker_id: SUB, notes: "Trae radio", change_reason: "Cubre una incapacidad" };
    const r = await updateAssignment(null, edit({ assigned_point: "", substitute_for_worker_id: "" }));
    expect(r.ok).toBe(true);
    expect(h.log).toEqual([`clear:shift_assignments:${ASSIGNMENT}`, "update:shift_assignments"]);
    expect(h.ops[0].payload).toEqual({ assigned_point: null, substitute_for_worker_id: null, notes: "Trae radio", change_reason: "Cubre una incapacidad" });
  });

  it("exige motivo de al menos 5 caracteres y rechaza cambios vacíos", async () => {
    const short = await updateAssignment(null, edit({ reason: "ok" }));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.fieldErrors?.reason).toBe("Indica el motivo del cambio (mínimo 5 caracteres).");

    h.rows.shift_assignments = { assigned_point: "Puerta norte", substitute_for_worker_id: SUB, notes: "Trae radio", change_reason: null };
    expect(await updateAssignment(null, edit())).toEqual({ ok: false, message: "No hay cambios que guardar." });
    expect(h.log).toEqual([]);
  });

  it("la persona sustituida no puede ser la misma ni una no visible", async () => {
    h.assignmentCtx = { shift, timezone: MAZ, assignment: { id: ASSIGNMENT, shift_id: SHIFT, worker_id: SUB, status: "asignado" } };
    const same = await updateAssignment(null, edit());
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.fieldErrors?.substitute_for_worker_id).toBe("Una persona no puede sustituirse a sí misma.");

    h.assignmentCtx = { shift, timezone: MAZ, assignment: { id: ASSIGNMENT, shift_id: SHIFT, worker_id: "w1", status: "asignado" } };
    h.rows.workers = null;
    const hidden = await updateAssignment(null, edit());
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) {
      expect(hidden.message).toBe("La persona sustituida no existe o no es visible para tu cuenta.");
      expect(hidden.fieldErrors).toHaveProperty("substitute_for_worker_id");
    }
    expect(h.log).toEqual([]);
  });

  it("separación de funciones y alcance: ni la propia asignación ni otra sede", async () => {
    h.user = { ...coordinator, workerId: "w1" };
    expect(await updateAssignment(null, edit())).toEqual({ ok: false, message: OWN_RECORD_DB_MESSAGE });
    h.user = { ...coordinator, facilityIds: [OTHER] };
    expect(await updateAssignment(null, edit())).toEqual({ ok: false, message: "No tienes permiso para modificar guardias de esta sede." });
    expect(h.log).toEqual([]);

    // Administración sí corrige su propia asignación.
    h.user = { ...admin, workerId: "w1" };
    expect((await updateAssignment(null, edit())).ok).toBe(true);
  });

  it("muestra el mensaje de la BD tal cual", async () => {
    h.writeError = { code: "42501", message: "La persona sustituida no existe o no es visible para tu cuenta" };
    expect(await updateAssignment(null, edit())).toEqual({ ok: false, message: "La persona sustituida no existe o no es visible para tu cuenta" });
  });
});
