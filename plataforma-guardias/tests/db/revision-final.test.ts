/**
 * Ajustes de la revisión final: cuota de comprobación de números de trabajador
 * y mensajes de traslape que no revelan guardias de otras sedes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  assignSuper,
  createAuthUser,
  createFacilitySuper,
  createShiftSuper,
  createWorkerSuper,
  expectPgError,
  grantScope,
  pool,
  suffix,
} from "./helpers";

let facilityA: string;
let facilityB: string;
let coord: string;
let admin: string;

beforeAll(async () => {
  facilityA = await createFacilitySuper();
  facilityB = await createFacilitySuper();
  coord = await createAuthUser({ role: "coordinador" });
  await grantScope(coord, facilityA);
  admin = await createAuthUser({ role: "admin" });
});

afterAll(async () => {
  await pool.end();
});

const numbers = (prefix: string, from: number, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${from + i}`);

describe("cuota de comprobación de números de trabajador", () => {
  it("coordinación comprueba hasta 2000 números distintos en 24 h; repetirlos no consume cuota", async () => {
    const prefix = `Q${suffix()}`;
    const first = numbers(prefix, 0, 1500);
    await asUser(coord, (c) => c.query("select public.employee_numbers_taken($1)", [first]));
    await asUser(coord, (c) => c.query("select public.employee_numbers_taken($1)", [first])); // mismos números
    await asUser(coord, (c) => c.query("select public.employee_number_taken($1)", [first[0]]));

    const msg = await expectPgError(asUser(coord, (c) => c.query("select public.employee_numbers_taken($1)", [numbers(prefix, 1500, 600)])));
    expect(msg).toMatch(/límite de 2000 números/);
    // Una consulta rechazada no consume cuota: todavía caben 500.
    await asUser(coord, (c) => c.query("select public.employee_numbers_taken($1)", [numbers(prefix, 1500, 500)]));
    expect(await expectPgError(asUser(coord, (c) => c.query("select public.employee_number_taken($1)", [`${prefix}-9999`])))).toMatch(/límite/);
  });

  it("administración no tiene cuota y la tabla de huellas no es accesible", async () => {
    await asUser(admin, (c) => c.query("select public.employee_numbers_taken($1)", [numbers(`A${suffix()}`, 0, 2500)]));
    expect(await expectPgError(asUser(coord, (c) => c.query("select count(*) from app.employee_number_checks")))).toMatch(/permission denied/);
  });
});

describe("traslapes de asignaciones", () => {
  it("no revela el horario de una guardia de otra sede", async () => {
    const worker = await createWorkerSuper(facilityA);
    await assignSuper(await createShiftSuper(facilityB, 3000, 3480), worker); // sede sin alcance

    const own = await createShiftSuper(facilityA, 2900, 3600);
    const msg = await expectPgError(
      asUser(coord, (c) => c.query("insert into public.shift_assignments (shift_id, worker_id) values ($1, $2)", [own, worker])),
    );
    expect(msg).toMatch(/otra guardia que se traslapa/);
    expect(msg).not.toMatch(/\(del /);

    // Con alcance (o como administración) sí se indica el horario.
    const mine = await createShiftSuper(facilityA, 4000, 4480);
    await assignSuper(mine, worker);
    const own2 = await createShiftSuper(facilityA, 3900, 4600);
    const detailed = await expectPgError(
      asUser(coord, (c) => c.query("insert into public.shift_assignments (shift_id, worker_id) values ($1, $2)", [own2, worker])),
    );
    expect(detailed).toMatch(/\(del \d{2}\/\d{2}\/\d{4}/);
  });
});
