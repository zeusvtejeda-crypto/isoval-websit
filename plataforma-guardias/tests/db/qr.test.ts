/**
 * Registro con código QR: códigos temporales emitidos y validados por el
 * servidor. El QR no prueba presencia física; solo deja método «qr».
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asSuper,
  asUser,
  assignSuper,
  createAuthUser,
  createFacilitySuper,
  createShiftSuper,
  createWorkerSuper,
  expectPgError,
  grantScope,
  pool,
  uid,
} from "./helpers";

let facilityA: string;
let facilityB: string;
let coordA: string;
let coordB: string;
let worker: string;
let workerUser: string;
let outsider: string;
let shiftId: string;

beforeAll(async () => {
  facilityA = await createFacilitySuper();
  facilityB = await createFacilitySuper();
  coordA = await createAuthUser({ role: "coordinador" });
  await grantScope(coordA, facilityA);
  coordB = await createAuthUser({ role: "coordinador" });
  await grantScope(coordB, facilityB);
  worker = await createWorkerSuper(facilityA);
  workerUser = await createAuthUser({ role: "trabajador", workerId: worker });
  outsider = await createAuthUser({ role: "trabajador", workerId: await createWorkerSuper(facilityA) });
  shiftId = await createShiftSuper(facilityA, -30, 240);
  await assignSuper(shiftId, worker);
});

afterAll(async () => {
  await pool.end();
});

async function issue(user: string, shift = shiftId): Promise<string> {
  const r = await asUser(user, (c) => c.query("select public.issue_qr_token($1) as r", [shift]));
  return r.rows[0].r.token as string;
}

describe("Registro con QR", () => {
  it("coordinación emite un código; se guarda solo su hash", async () => {
    const token = await issue(coordA);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const stored = await asSuper((c) => c.query("select token_hash from public.attendance_qr_tokens where shift_id = $1", [shiftId]));
    expect(stored.rows.map((r) => r.token_hash)).not.toContain(token);
  });

  it("solo coordinación de la sede o administración emiten códigos", async () => {
    expect(await expectPgError(asUser(coordB, (c) => c.query("select public.issue_qr_token($1)", [shiftId])))).toMatch(/permiso/);
    expect(await expectPgError(asUser(workerUser, (c) => c.query("select public.issue_qr_token($1)", [shiftId])))).toMatch(/permiso/);
    expect(await expectPgError(asUser(null, (c) => c.query("select public.issue_qr_token($1)", [shiftId])))).toMatch(/permission denied/);
  });

  it("el trabajador asignado ve el contexto y registra entrada y salida con método qr; reintentos no duplican", async () => {
    const token = await issue(coordA);
    const ctx = await asUser(workerUser, (c) => c.query("select public.qr_token_context($1) as r", [token]));
    expect(ctx.rows[0].r.shift_id).toBe(shiftId);
    expect(ctx.rows[0].r.has_open_session).toBe(false);

    const req = uid();
    const a = await asUser(workerUser, (c) => c.query("select public.check_in_qr($1, $2) as r", [token, req]));
    expect(a.rows[0].r.result).toBe("created");
    expect(a.rows[0].r.session.check_in_method).toBe("qr");

    // Reintento con el mismo identificador después de que el código caducó: mismo registro.
    await asSuper((c) => c.query("update public.attendance_qr_tokens set expires_at = now() - interval '1 second', created_at = now() - interval '5 minutes' where token_hash is not null and shift_id = $1", [shiftId]));
    const b = await asUser(workerUser, (c) => c.query("select public.check_in_qr($1, $2) as r", [token, req]));
    expect(b.rows[0].r.result).toBe("duplicate");
    expect(b.rows[0].r.session.id).toBe(a.rows[0].r.session.id);

    // Un código caducado no sirve para un registro nuevo.
    expect(await expectPgError(asUser(workerUser, (c) => c.query("select public.check_out_qr($1, $2)", [token, uid()])))).toMatch(/expiró/);

    const fresh = await issue(coordA);
    const out = await asUser(workerUser, (c) => c.query("select public.check_out_qr($1, $2) as r", [fresh, uid()]));
    expect(out.rows[0].r.result).toBe("created");
    expect(out.rows[0].r.session.check_out_method).toBe("qr");
  });

  it("una persona no asignada no puede usar el código", async () => {
    const token = await issue(coordA);
    expect(await expectPgError(asUser(outsider, (c) => c.query("select public.qr_token_context($1)", [token])))).toMatch(/No estás asignado/);
    expect(await expectPgError(asUser(outsider, (c) => c.query("select public.check_in_qr($1, $2)", [token, uid()])))).toMatch(/No estás asignado/);
  });

  it("un código inventado se rechaza y la tabla no es accesible directamente", async () => {
    expect(await expectPgError(asUser(workerUser, (c) => c.query("select public.check_in_qr($1, $2)", ["codigo-inventado-1234567890", uid()])))).toMatch(/expiró o no es válido/);
    expect(await expectPgError(asUser(coordA, (c) => c.query("select * from public.attendance_qr_tokens")))).toMatch(/permission denied/);
  });

  it("no se emiten códigos fuera de la ventana de la guardia ni para guardias canceladas", async () => {
    const future = await createShiftSuper(facilityA, 60 * 24 * 3, 60 * 24 * 3 + 120);
    expect(await expectPgError(asUser(coordA, (c) => c.query("select public.issue_qr_token($1)", [future])))).toMatch(/ventana de registro/);
    const cancelled = await createShiftSuper(facilityA, -30, 120);
    await asSuper((c) => c.query("update public.shifts set status = 'cancelada', cancel_reason = 'Prueba' where id = $1", [cancelled]));
    expect(await expectPgError(asUser(coordA, (c) => c.query("select public.issue_qr_token($1)", [cancelled])))).toMatch(/cancelada/);
  });

  it("los registros normales siguen con método propio", async () => {
    const s = await createShiftSuper(facilityA, -30, 120);
    const w = await createWorkerSuper(facilityA);
    const u = await createAuthUser({ role: "trabajador", workerId: w });
    const a = await assignSuper(s, w);
    const r = await asUser(u, (c) => c.query("select public.check_in($1, $2) as r", [a, uid()]));
    expect(r.rows[0].r.session.check_in_method).toBe("propio");
  });
});
