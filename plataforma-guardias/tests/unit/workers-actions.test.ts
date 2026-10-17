import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPLOYEE_NUMBER_TAKEN, FACILITY_REQUIRED } from "@/lib/validation/worker";
import type { WorkerImportRowResult } from "@/lib/import/workers";

/**
 * Alta de trabajadores con la BD simulada: sede obligatoria, comprobación previa
 * del número de trabajador en todas las sedes (employee_number_taken) y alta
 * atómica por RPC (create_worker / create_workers) sin INSERT directos.
 */

const FAC = "d0000000-0000-4000-8000-000000000001";
const OTHER = "d0000000-0000-4000-8000-000000000002";
const WORKER = "c0000000-0000-4000-8000-000000000001";
const NEW_ID = "c0000000-0000-4000-8000-000000000099";

type Result = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  user: null as unknown as { id: string; isAdmin: boolean; canManage: boolean; facilityIds: string[]; role: string },
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  rpcResult: {} as Record<string, Result>,
  writes: [] as { table: string; op: string; payload: unknown }[],
  rows: {} as Record<string, unknown>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/auth", () => ({
  requireManager: vi.fn(async () => h.user),
  requireAdmin: vi.fn(async () => h.user),
  canManageFacility: (u: { isAdmin: boolean; facilityIds: string[] }, f: string | null) => u.isAdmin || (!!f && u.facilityIds.includes(f)),
}));
vi.mock("@/lib/data/catalogs", () => ({
  getStates: vi.fn(async () => [{ id: 18, name: "Nayarit", abbreviation: "NAY" }]),
  getMunicipalities: vi.fn(async () => []),
}));

function chain(table: string) {
  let result: Result = { data: h.rows[table] ?? null, error: null };
  let writing = false;
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "ilike", "limit", "order", "in", "is"]) c[m] = () => c;
  c.range = () => c;
  c.select = () => {
    if (!writing) result = { data: h.rows[table] ?? null, error: null };
    return c;
  };
  for (const op of ["insert", "update", "upsert"]) {
    c[op] = (payload: unknown) => {
      h.writes.push({ table, op, payload });
      writing = true;
      result = { data: [{ id: WORKER }], error: null };
      return c;
    };
  }
  c.maybeSingle = async () => result;
  c.single = async () => result;
  c.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return c;
}

const supabase = {
  from: (table: string) => chain(table),
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    h.rpc.push({ name, args });
    return h.rpcResult[name] ?? { data: null, error: null };
  }),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => supabase) }));

const { saveWorker } = await import("@/app/(app)/trabajadores/actions");
const { applyWorkerImport, loadImportContext } = await import("@/app/(app)/trabajadores/_lib/import-server");

const coordinator = { id: "u1", isAdmin: false, canManage: true, facilityIds: [FAC], role: "coordinador" };
const admin = { id: "u0", isAdmin: true, canManage: true, facilityIds: [], role: "admin" };

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ full_name: "María López", state_id: "18", active: "1", ...values })) fd.set(k, v);
  return fd;
}

async function run(fd: FormData) {
  try {
    return { result: await saveWorker(null, fd), redirect: null };
  } catch (e) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec((e as Error).message);
    if (!m) throw e;
    return { result: null, redirect: m[1] };
  }
}

beforeEach(() => {
  h.user = coordinator;
  h.rpc = [];
  h.rpcResult = {};
  h.writes = [];
  h.rows = { states: { id: 18 }, facilities: { id: FAC, active: true } };
});

describe("saveWorker: alta", () => {
  it("exige la instalación de adscripción, también a administración", async () => {
    h.user = admin;
    const { result } = await run(form({ facility_id: "" }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { facility_id: FACILITY_REQUIRED } });
    expect(h.rpc).toEqual([]);
    expect(h.writes).toEqual([]);
  });

  it("número registrado en otra sede: error en el campo antes de guardar", async () => {
    h.rpcResult.employee_number_taken = { data: true, error: null };
    const { result } = await run(form({ facility_id: FAC, employee_number: "E-77" }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { employee_number: EMPLOYEE_NUMBER_TAKEN } });
    expect(h.rpc).toEqual([{ name: "employee_number_taken", args: { p_number: "E-77", p_except_worker: undefined } }]);
    expect(h.writes).toEqual([]);
  });

  it("crea registro y datos privados en una sola llamada (create_worker)", async () => {
    h.rpcResult.employee_number_taken = { data: false, error: null };
    h.rpcResult.create_worker = { data: NEW_ID, error: null };
    const { redirect } = await run(form({ facility_id: FAC, employee_number: "E-78", phone: "311 000 0000", area: "Enfermería" }));
    expect(redirect).toBe(`/trabajadores/${NEW_ID}?guardado=1`);
    expect(h.rpc.map((r) => r.name)).toEqual(["employee_number_taken", "create_worker"]);
    expect(h.rpc[1].args).toMatchObject({
      p_full_name: "María López",
      p_state_id: 18,
      p_facility_id: FAC,
      p_area: "Enfermería",
      p_active: true,
      p_employee_number: "E-78",
      p_phone: "311 000 0000",
      p_change_reason: "Alta de trabajador",
    });
    // Sin INSERT directos a workers ni worker_private.
    expect(h.writes).toEqual([]);
  });

  it("si el número se registra entre la comprobación y el alta, no se crea nada y se marca el campo", async () => {
    h.rpcResult.employee_number_taken = { data: false, error: null };
    h.rpcResult.create_worker = { data: null, error: { code: "23505", message: EMPLOYEE_NUMBER_TAKEN } };
    const { result, redirect } = await run(form({ facility_id: FAC, employee_number: "E-79" }));
    expect(redirect).toBeNull();
    expect(result).toMatchObject({ ok: false, fieldErrors: { employee_number: EMPLOYEE_NUMBER_TAKEN } });
    expect(h.writes).toEqual([]);
  });

  it("coordinación no registra en una sede ajena", async () => {
    const { result } = await run(form({ facility_id: OTHER }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { facility_id: "Instalación fuera de tus sedes." } });
    expect(h.rpc).toEqual([]);
  });
});

describe("saveWorker: edición", () => {
  it("cambiar a un número ya registrado da error en el campo (excluye al propio trabajador)", async () => {
    h.rows.workers = { id: WORKER, facility_id: FAC, change_reason: null };
    h.rpcResult.employee_number_taken = { data: true, error: null };
    const { result } = await run(form({ id: WORKER, facility_id: FAC, employee_number: "E-80", change_reason: "Corrección de número" }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { employee_number: EMPLOYEE_NUMBER_TAKEN } });
    expect(h.rpc).toEqual([{ name: "employee_number_taken", args: { p_number: "E-80", p_except_worker: WORKER } }]);
    expect(h.writes).toEqual([]);
  });
});

describe("importación: servidor", () => {
  function createRow(row: number, name: string, privateData: WorkerImportRowResult["privateData"]): WorkerImportRowResult {
    return {
      row,
      status: "nueva",
      messages: [],
      name,
      facilityLabel: null,
      targetId: null,
      targetCode: null,
      create: { full_name: name, state_id: 18, municipality_id: null, facility_id: FAC, area: null, position: null, usual_shift: null, active: true },
      patch: null,
      privateData,
      changes: [],
      noop: false,
    };
  }

  it("comprueba solo los números del archivo que la cuenta no ve", async () => {
    h.rows = {
      facilities: [],
      workers: [],
      worker_private: [{ worker_id: WORKER, employee_number: "e-1", phone: null }],
    };
    h.rpcResult.employee_numbers_taken = { data: ["OCULTO-2"], error: null };
    const ctx = await loadImportContext(supabase as never, coordinator as never, "crear_actualizar", ["E-1", "OCULTO-2", "LIBRE-3"]);
    expect(h.rpc).toEqual([{ name: "employee_numbers_taken", args: { p_numbers: ["OCULTO-2", "LIBRE-3"] } }]);
    expect(ctx.takenEmployeeNumbers).toEqual(["OCULTO-2"]);
  });

  it("crea en lote con create_workers y reporta como fallo la fila con número repetido", async () => {
    h.rpcResult.create_workers = {
      data: [
        { ok: true, id: NEW_ID },
        { ok: false, code: "23505", message: EMPLOYEE_NUMBER_TAKEN },
      ],
      error: null,
    };
    const out = await applyWorkerImport(
      supabase as never,
      [createRow(2, "Persona Uno", { employee_number: "E-1", phone: null }), createRow(3, "Persona Dos", { employee_number: "OCULTO-2", phone: "311 000 0000" })],
      "Importación de prueba",
    );
    expect(h.rpc).toHaveLength(1);
    expect(h.rpc[0].name).toBe("create_workers");
    expect(h.rpc[0].args.p_change_reason).toBe("Importación de prueba");
    expect(h.rpc[0].args.p_rows).toEqual([
      expect.objectContaining({ full_name: "Persona Uno", facility_id: FAC, employee_number: "E-1", phone: null }),
      expect.objectContaining({ full_name: "Persona Dos", facility_id: FAC, employee_number: "OCULTO-2", phone: "311 000 0000" }),
    ]);
    expect(out.get(2)).toEqual({ result: "creada" });
    expect(out.get(3)).toEqual({ result: "fallo", message: EMPLOYEE_NUMBER_TAKEN });
    expect(h.writes).toEqual([]);
  });

  it("si el lote completo falla, ninguna fila se reporta como creada", async () => {
    h.rpcResult.create_workers = { data: null, error: { code: "42501", message: "permission denied for function create_workers" } };
    const out = await applyWorkerImport(supabase as never, [createRow(2, "Persona Uno", null)], "Importación de prueba");
    expect(out.get(2)).toEqual({ result: "fallo", message: "No tienes permiso para realizar esta acción." });
  });
});
