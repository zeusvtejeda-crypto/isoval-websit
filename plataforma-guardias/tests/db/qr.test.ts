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

async function issue(user: string, shift = shiftId, revoke = false): Promise<string> {
  const r = await asUser(user, (c) => c.query("select public.issue_qr_token($1, $2) as r", [shift, revoke]));
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

  it("el contexto informa si no se puede registrar (guardia cancelada, asignación inactiva, trabajador inactivo) y el servidor lo rechaza", async () => {
    const s1 = await createShiftSuper(facilityA, -30, 240);
    const w1 = await createWorkerSuper(facilityA);
    const u1 = await createAuthUser({ role: "trabajador", workerId: w1 });
    const a1 = await assignSuper(s1, w1);
    const t1 = await issue(coordA, s1);
    const okCtx = await asUser(u1, (c) => c.query("select public.qr_token_context($1) as r", [t1]));
    expect(okCtx.rows[0].r.can_register).toBe(true);
    // Guardia cancelada después de emitir
    await asSuper((c) => c.query("update public.shifts set status = 'cancelada', cancel_reason = 'Prueba' where id = $1", [s1]));
    const c1 = await asUser(u1, (c) => c.query("select public.qr_token_context($1) as r", [t1]));
    expect(c1.rows[0].r.can_register).toBe(false);
    expect(c1.rows[0].r.shift_status).toBe("cancelada");
    expect(await expectPgError(asUser(u1, (c) => c.query("select public.check_in_qr($1, $2)", [t1, uid()])))).toMatch(/cancelada/);

    // Asignación cancelada
    const s2 = await createShiftSuper(facilityA, -30, 240);
    const a2 = await assignSuper(s2, w1);
    await asSuper((c) => c.query("update public.shift_assignments set status = 'cancelado' where id = $1", [a2]));
    const t2 = await issue(coordA, s2);
    const c2 = await asUser(u1, (c) => c.query("select public.qr_token_context($1) as r", [t2]));
    expect(c2.rows[0].r.assignment_status).toBe("cancelado");
    expect(c2.rows[0].r.can_register).toBe(false);
    expect(await expectPgError(asUser(u1, (c) => c.query("select public.check_in_qr($1, $2)", [t2, uid()])))).toMatch(/no está activa/);

    // Trabajador inactivo
    const s3 = await createShiftSuper(facilityA, -30, 240);
    const w3 = await createWorkerSuper(facilityA);
    const u3 = await createAuthUser({ role: "trabajador", workerId: w3 });
    await assignSuper(s3, w3);
    await asSuper((c) => c.query("update public.workers set active = false where id = $1", [w3]));
    const t3 = await issue(coordA, s3);
    const c3 = await asUser(u3, (c) => c.query("select public.qr_token_context($1) as r", [t3]));
    expect(c3.rows[0].r.worker_active).toBe(false);
    expect(await expectPgError(asUser(u3, (c) => c.query("select public.check_in_qr($1, $2)", [t3, uid()])))).toMatch(/inactivo/);
    void a1;
  });

  it("la emisión queda en la bitácora sin el código, y el registro guarda qué código se usó", async () => {
    const s1 = await createShiftSuper(facilityA, -30, 240);
    const w1 = await createWorkerSuper(facilityA);
    const u1 = await createAuthUser({ role: "trabajador", workerId: w1 });
    await assignSuper(s1, w1);
    const token = await issue(coordA, s1);
    const audit = await asUser(coordA, (c) =>
      c.query("select record_id, actor_id, new_data::text as data from public.audit_log where table_name = 'attendance_qr_tokens' and new_data->>'shift_id' = $1", [s1]),
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].actor_id).toBe(coordA);
    expect(audit.rows[0].data).not.toContain(token);
    const r = await asUser(u1, (c) => c.query("select public.check_in_qr($1, $2) as r", [token, uid()]));
    expect(r.rows[0].r.session.qr_check_in_token_id).toBe(audit.rows[0].record_id);
    const out = await asUser(u1, (c) => c.query("select public.check_out_qr($1, $2) as r", [token, uid()]));
    expect(out.rows[0].r.session.qr_check_out_token_id).toBe(audit.rows[0].record_id);
  });

  it("la variable del método QR no se queda pegada para registros normales en la misma transacción", async () => {
    const s1 = await createShiftSuper(facilityA, -30, 240);
    const w1 = await createWorkerSuper(facilityA);
    const u1 = await createAuthUser({ role: "trabajador", workerId: w1 });
    const a1 = await assignSuper(s1, w1);
    const token = await issue(coordA, s1);
    const r = await asUser(u1, async (c) => {
      await c.query("select public.check_in_qr($1, $2)", [token, uid()]);
      return c.query(
        "select coalesce(current_setting('app.attendance_method', true), '') as method, coalesce(current_setting('app.qr_token_id', true), '') as token_id",
      );
    });
    expect(r.rows[0].method).toBe("");
    expect(r.rows[0].token_id).toBe("");
    // Un registro normal posterior queda con método propio y sin código.
    const out = await asUser(u1, (c) => c.query("select public.check_out($1, $2) as r", [a1, uid()]));
    expect(out.rows[0].r.session.check_out_method).toBe("propio");
    expect(out.rows[0].r.session.qr_check_out_token_id).toBeNull();
  });

  it("«Renovar ahora» invalida los códigos anteriores; la rotación automática no", async () => {
    const s1 = await createShiftSuper(facilityA, -30, 240);
    const w1 = await createWorkerSuper(facilityA);
    const u1 = await createAuthUser({ role: "trabajador", workerId: w1 });
    await assignSuper(s1, w1);
    const t1 = await issue(coordA, s1);
    const t2 = await issue(coordA, s1); // rotación automática: ambos vigentes
    await asUser(u1, (c) => c.query("select public.qr_token_context($1)", [t1]));
    await issue(coordA, s1, true); // renovación manual
    expect(await expectPgError(asUser(u1, (c) => c.query("select public.qr_token_context($1)", [t1])))).toMatch(/expiró/);
    expect(await expectPgError(asUser(u1, (c) => c.query("select public.qr_token_context($1)", [t2])))).toMatch(/expiró/);
  });

  it("limita la emisión de códigos por guardia", async () => {
    const s1 = await createShiftSuper(facilityA, -30, 240);
    for (let i = 0; i < 40; i++) await issue(coordA, s1);
    expect(await expectPgError(asUser(coordA, (c) => c.query("select public.issue_qr_token($1)", [s1])))).toMatch(/demasiados códigos/);
  });

  it("coordinación que se registra con QR no puede corregir su propio registro", async () => {
    const cw = await createWorkerSuper(facilityA);
    const coordWorker = await createAuthUser({ role: "coordinador", workerId: cw });
    await grantScope(coordWorker, facilityA);
    const s1 = await createShiftSuper(facilityA, -30, 240);
    await assignSuper(s1, cw);
    const token = await issue(coordWorker, s1);
    const r = await asUser(coordWorker, (c) => c.query("select public.check_in_qr($1, $2) as r", [token, uid()]));
    expect(r.rows[0].r.session.check_in_method).toBe("qr");
    expect(
      await expectPgError(
        asUser(coordWorker, (c) => c.query("select public.void_attendance($1, 'Anulación propia')", [r.rows[0].r.session.id])),
      ),
    ).toMatch(/propia asistencia/);
  });
});

