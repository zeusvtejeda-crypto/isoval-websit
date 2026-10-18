/**
 * Trabajadores: alta atómica (registro + datos privados), comprobación previa
 * del número de trabajador entre sedes y sede de adscripción obligatoria.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asSuper,
  asUser,
  createAuthUser,
  createFacilitySuper,
  createWorkerSuper,
  expectPgError,
  grantScope,
  pool,
  suffix,
  type Db,
} from "./helpers";

let facilityA: string;
let facilityB: string;
let adminId: string;
let coordA: string; // coordinación de la sede A (no ve la sede B)
let coordSinSede: string;
let auditorA: string;
let trabajadorId: string;
let workerB: string; // trabajador de la sede B con número registrado
let workerA: string; // trabajador de la sede A con número registrado
let numberB: string;
let numberA: string;

/** Como usuario autenticado, siempre con ROLLBACK (nada queda guardado). */
async function asUserRollback<T>(userId: string, fn: (c: Db) => Promise<T>, prepare?: (c: Db) => Promise<void>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (prepare) await prepare(c);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated" })]);
    await c.query("set local role authenticated");
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
}

async function countWorkersNamed(name: string): Promise<number> {
  const r = await asSuper((c) => c.query("select count(*)::int as n from public.workers where full_name = $1", [name]));
  return r.rows[0].n;
}

beforeAll(async () => {
  facilityA = await createFacilitySuper();
  facilityB = await createFacilitySuper();
  adminId = await createAuthUser({ role: "admin" });
  coordA = await createAuthUser({ role: "coordinador" });
  await grantScope(coordA, facilityA);
  coordSinSede = await createAuthUser({ role: "coordinador" });
  auditorA = await createAuthUser({ role: "auditor" });
  await grantScope(auditorA, facilityA);
  trabajadorId = await createAuthUser({ role: "trabajador" });

  workerB = await createWorkerSuper(facilityB);
  workerA = await createWorkerSuper(facilityA);
  numberB = `ATB-${suffix()}`;
  numberA = `ATA-${suffix()}`;
  await asSuper((c) =>
    c.query("insert into public.worker_private (worker_id, employee_number) values ($1, $2), ($3, $4)", [workerB, numberB, workerA, numberA]),
  );
});

afterAll(async () => {
  // Las instalaciones de prueba son de demostración: sus trabajadores también, para
  // que purge_demo_data no se detenga por personal real adscrito a ellas.
  await asSuper((c) => c.query("update public.workers set is_demo = true where facility_id = any($1::uuid[])", [[facilityA, facilityB]]));
  await pool.end();
});

describe("Sede de adscripción obligatoria", () => {
  it("workers.facility_id es NOT NULL", async () => {
    const col = await asSuper((c) =>
      c.query("select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'workers' and column_name = 'facility_id'"),
    );
    expect(col.rows[0].is_nullable).toBe("NO");
    const msg = await expectPgError(asSuper((c) => c.query("insert into public.workers (full_name, state_id) values ($1, 18)", [`Sin sede ${suffix()}`])));
    expect(msg).toMatch(/null value in column "facility_id"/);
  });

  it("create_worker exige la instalación con un mensaje en español", async () => {
    const msg = await expectPgError(asUser(adminId, (c) => c.query("select public.create_worker($1, 18, null)", [`Sin sede ${suffix()}`])));
    expect(msg).toMatch(/Elige la instalación de adscripción/);
  });
});

describe("Alta atómica de trabajador", () => {
  it("crea el registro y sus datos privados, con bitácora y motivo", async () => {
    const name = `Alta atómica ${suffix()}`;
    const number = `ATN-${suffix()}`;
    const r = await asUser(coordA, (c) =>
      c.query("select public.create_worker(p_full_name => $1, p_state_id => 18, p_facility_id => $2, p_employee_number => $3, p_phone => '311 000 1234') as r", [
        name,
        facilityA,
        number,
      ]),
    );
    expect(r.rows[0].r).toMatchObject({ ok: true });
    const id = r.rows[0].r.id as string;
    const row = await asSuper((c) =>
      c.query(
        "select w.facility_id, w.change_reason, w.created_by, p.employee_number, p.phone from public.workers w join public.worker_private p on p.worker_id = w.id where w.id = $1",
        [id],
      ),
    );
    expect(row.rows[0]).toMatchObject({ facility_id: facilityA, change_reason: "Alta de trabajador", created_by: coordA, employee_number: number, phone: "311 000 1234" });
    const audit = await asSuper((c) =>
      c.query("select table_name, reason from public.audit_log where record_id = $1 and action = 'INSERT' order by table_name", [id]),
    );
    expect(audit.rows).toEqual([
      { table_name: "worker_private", reason: "Alta de trabajador" },
      { table_name: "workers", reason: "Alta de trabajador" },
    ]);
  });

  it("número registrado en otra sede: responde «taken» sin error y NO queda ningún registro", async () => {
    const name = `Duplicado entre sedes ${suffix()}`;
    // La coordinación de A no ve el número (es de la sede B).
    const visible = await asUser(coordA, (c) => c.query("select 1 from public.worker_private where employee_number = $1", [numberB]));
    expect(visible.rowCount).toBe(0);

    // Sin error: así se conserva la cuota de comprobación consumida (20261017001330).
    const r = await asUser(coordA, (c) =>
      c.query("select public.create_worker(p_full_name => $1, p_state_id => 18, p_facility_id => $2, p_employee_number => $3) as r", [
        name,
        facilityA,
        ` ${numberB.toLowerCase()} `,
      ]),
    );
    expect(r.rows[0].r).toEqual({
      ok: false,
      taken: true,
      code: "23505",
      message: "Ese número de trabajador ya está registrado (posiblemente en otra sede).",
    });
    expect(await countWorkersNamed(name)).toBe(0);
  });

  it("coordinación no crea trabajadores en una sede ajena (mismo permiso que la política workers_insert)", async () => {
    const name = `Sede ajena ${suffix()}`;
    const msg = await expectPgError(asUser(coordA, (c) => c.query("select public.create_worker($1, 18, $2)", [name, facilityB])));
    expect(msg).toBe("No puedes registrar trabajadores en esa instalación.");
    expect(await countWorkersNamed(name)).toBe(0);
    for (const user of [trabajadorId, auditorA, coordSinSede]) {
      expect(await expectPgError(asUser(user, (c) => c.query("select public.create_worker($1, 18, $2)", [name, facilityA])))).toBe(
        "No puedes registrar trabajadores en esa instalación.",
      );
    }
    expect(await countWorkersNamed(name)).toBe(0);
  });

  it("create_workers: cada fila es atómica y no impide las demás", async () => {
    const names = [`Lote uno ${suffix()}`, `Lote dos ${suffix()}`, `Lote tres ${suffix()}`];
    const rows = [
      { full_name: names[0], state_id: 18, facility_id: facilityA, employee_number: `ATL-${suffix()}`, active: true },
      { full_name: names[1], state_id: 18, facility_id: facilityA, employee_number: numberB, phone: "311 000 0000" },
      { full_name: names[2], state_id: 18, facility_id: facilityA, area: "Enfermería" },
    ];
    const r = await asUser(coordA, (c) => c.query("select public.create_workers($1::jsonb, $2) as r", [JSON.stringify(rows), `Importación de prueba ${suffix()}`]));
    const results = r.rows[0].r as { ok: boolean; id?: string; code?: string; message?: string }[];
    expect(results.map((x) => x.ok)).toEqual([true, false, true]);
    expect(results[1]).toMatchObject({ taken: true, code: "23505", message: "Ese número de trabajador ya está registrado (posiblemente en otra sede)." });
    expect(await countWorkersNamed(names[0])).toBe(1);
    expect(await countWorkersNamed(names[1])).toBe(0);
    expect(await countWorkersNamed(names[2])).toBe(1);
  });

  it("create_workers no está disponible para anónimos", async () => {
    const msg = await expectPgError(asUser(null, (c) => c.query("select public.create_workers('[]'::jsonb, 'x')")));
    expect(msg).toMatch(/permission denied/);
  });
});

describe("employee_number_taken / employee_numbers_taken", () => {
  it("coordinación sabe si un número está registrado en cualquier sede (solo sí/no)", async () => {
    const r = await asUser(coordA, (c) =>
      c.query("select public.employee_number_taken($1) as otra_sede, public.employee_number_taken($2) as libre, public.employee_number_taken('  ') as vacio", [
        ` ${numberB.toLowerCase()}`,
        `LIBRE-${suffix()}`,
      ]),
    );
    expect(r.rows[0]).toEqual({ otra_sede: true, libre: false, vacio: false });
  });

  it("excluye al trabajador que se edita, solo si la cuenta lo gestiona", async () => {
    const own = await asUser(coordA, (c) => c.query("select public.employee_number_taken($1, $2) as taken", [numberA, workerA]));
    expect(own.rows[0].taken).toBe(false);
    const msg = await expectPgError(asUser(coordA, (c) => c.query("select public.employee_number_taken($1, $2)", [numberB, workerB])));
    expect(msg).toMatch(/No puedes consultar/);
    const admin = await asUser(adminId, (c) => c.query("select public.employee_number_taken($1, $2) as taken", [numberB, workerB]));
    expect(admin.rows[0].taken).toBe(false);
  });

  it("se niega a trabajador, auditoría, coordinación sin sedes y anónimos", async () => {
    for (const user of [trabajadorId, auditorA, coordSinSede]) {
      const msg = await expectPgError(asUser(user, (c) => c.query("select public.employee_number_taken($1)", [numberB])));
      expect(msg).toMatch(/Solo administración y coordinación/);
      const batch = await expectPgError(asUser(user, (c) => c.query("select public.employee_numbers_taken($1::text[])", [[numberB]])));
      expect(batch).toMatch(/Solo administración y coordinación/);
    }
    expect(await expectPgError(asUser(null, (c) => c.query("select public.employee_number_taken($1)", [numberB])))).toMatch(/permission denied/);
    expect(await expectPgError(asUser(null, (c) => c.query("select public.employee_numbers_taken($1::text[])", [[numberB]])))).toMatch(/permission denied/);
  });

  it("por lotes devuelve solo los números registrados (normalizados)", async () => {
    const libre = `LIBRE-${suffix()}`;
    const r = await asUser(coordA, (c) => c.query("select public.employee_numbers_taken($1::text[]) as taken", [[` ${numberB.toLowerCase()} `, libre, numberA, ""]]));
    expect((r.rows[0].taken as string[]).sort()).toEqual([numberA.toUpperCase(), numberB.toUpperCase()].sort());
  });
});

describe("Datos de demostración", () => {
  it("purge_demo_data se detiene si hay trabajadores reales en instalaciones de demostración", async () => {
    // Todo ocurre en una transacción que se revierte: no se borra nada ni quedan datos.
    const msg = await expectPgError(
      asUserRollback(
        adminId,
        (c) => c.query("select public.purge_demo_data()"),
        async (c) => {
          const f = await c.query(
            `insert into public.facilities (official_name, category_id, state_id, municipality_id, source, is_demo)
             values ($1, (select id from public.facility_categories where slug = 'umf'), 18,
               (select id from public.municipalities where state_id = 18 and inegi_code = '017'), 'Prueba automatizada', true) returning id`,
            [`Demo temporal ${suffix()}`],
          );
          await c.query("insert into public.workers (full_name, state_id, facility_id) values ($1, 18, $2)", [`Persona real ${suffix()}`, f.rows[0].id]);
        },
      ),
    );
    expect(msg).toMatch(/adscrito.* a instalaciones de demostración/);
  });
});
