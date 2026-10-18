/**
 * Sesiones revocadas (20261017001320_sesiones.sql): un JWT todavía vigente deja
 * de dar acceso cuando su sesión ya no existe en auth.sessions (cierre de
 * sesión, cuenta desactivada) o venció (not_after). Sin claim `session_id`
 * (servicio, pruebas anteriores) se sigue considerando viva.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asSuper,
  asUser,
  createAuthUser,
  createFacilitySuper,
  createShiftSuper,
  createWorkerSuper,
  expectPgError,
  grantScope,
  pool,
  uid,
  type Db,
} from "./helpers";

/** Como asUser, pero con los claims que emite GoTrue: incluye `session_id`. */
async function asSession<T>(userId: string, sessionId: string, fn: (c: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", session_id: sessionId, aal: "aal1" }),
    ]);
    await c.query("set local role authenticated");
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (error) {
    await c.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    c.release();
  }
}

const createdSessions: string[] = [];

async function createSession(userId: string, notAfter: string | null = null): Promise<string> {
  const id = uid();
  await asSuper((c) =>
    c.query(
      "insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after) values ($1, $2, now(), now(), 'aal1', $3)",
      [id, userId, notAfter],
    ),
  );
  createdSessions.push(id);
  return id;
}

async function deleteSession(sessionId: string) {
  await asSuper((c) => c.query("delete from auth.sessions where id = $1", [sessionId]));
}

/** Lo que una cuenta puede hacer o ver con unos claims dados. */
async function snapshot(run: <T>(fn: (c: Db) => Promise<T>) => Promise<T>, facilityId: string) {
  return run(async (c) => {
    const helpers = await c.query(
      `select app.session_alive() as alive, app.my_role()::text as role, app.is_admin() as is_admin,
              app.my_worker_id() as worker_id, app.has_scope($1) as has_scope, app.can_manage($1) as can_manage,
              app.can_check_employee_number() as can_check`,
      [facilityId],
    );
    // La misma consulta que getSessionUser() en src/lib/auth.ts.
    const profile = await c.query("select id, role, active from public.profiles where id = auth.uid()");
    const scopes = await c.query("select facility_id from public.user_facility_scopes where user_id = auth.uid()");
    const shifts = await c.query("select id from public.shifts where facility_id = $1", [facilityId]);
    return { ...helpers.rows[0], profiles: profile.rowCount, scopes: scopes.rowCount, shifts: shifts.rowCount };
  });
}

let facilityId: string;
let workerId: string;
let coordId: string;
let adminId: string;

beforeAll(async () => {
  facilityId = await createFacilitySuper();
  workerId = await createWorkerSuper(facilityId);
  coordId = await createAuthUser({ role: "coordinador", workerId });
  await grantScope(coordId, facilityId);
  adminId = await createAuthUser({ role: "admin" });
  await createShiftSuper(facilityId, 60, 600);
});

afterAll(async () => {
  if (createdSessions.length > 0) {
    await asSuper((c) => c.query("delete from auth.sessions where id = any($1::uuid[])", [createdSessions]));
  }
  await pool.end();
});

describe("app.session_alive()", () => {
  it("sin session_id (servicio o pruebas que solo fijan sub) se considera viva", async () => {
    const r = await asUser(coordId, (c) => c.query("select app.session_alive() as alive"));
    expect(r.rows[0].alive).toBe(true);
    const anon = await asUser(null, (c) => c.query("select app.session_alive() as alive"));
    expect(anon.rows[0].alive).toBe(true);
    const service = await asSuper((c) => c.query("select app.session_alive() as alive"));
    expect(service.rows[0].alive).toBe(true);
  });

  it("verdadera con la sesión en auth.sessions y falsa al borrarla", async () => {
    const sessionId = await createSession(coordId);
    const before = await asSession(coordId, sessionId, (c) => c.query("select app.session_alive() as alive"));
    expect(before.rows[0].alive).toBe(true);
    await deleteSession(sessionId);
    const after = await asSession(coordId, sessionId, (c) => c.query("select app.session_alive() as alive"));
    expect(after.rows[0].alive).toBe(false);
  });

  it("falsa si not_after ya pasó, si la sesión es de otra cuenta o si el session_id no es un UUID", async () => {
    const expired = await createSession(coordId, new Date(Date.now() - 60_000).toISOString());
    expect((await asSession(coordId, expired, (c) => c.query("select app.session_alive() as alive"))).rows[0].alive).toBe(false);

    const future = await createSession(coordId, new Date(Date.now() + 3_600_000).toISOString());
    expect((await asSession(coordId, future, (c) => c.query("select app.session_alive() as alive"))).rows[0].alive).toBe(true);

    const adminSession = await createSession(adminId);
    expect((await asSession(coordId, adminSession, (c) => c.query("select app.session_alive() as alive"))).rows[0].alive).toBe(false);

    expect((await asSession(coordId, "no-es-uuid", (c) => c.query("select app.session_alive() as alive"))).rows[0].alive).toBe(false);
    expect((await asSession(coordId, "", (c) => c.query("select app.session_alive() as alive"))).rows[0].alive).toBe(false);
  });
});

describe("Funciones de autorización con una sesión revocada", () => {
  it("coordinación pierde rol, sede, perfil y datos con los mismos claims al borrar su sesión", async () => {
    const sessionId = await createSession(coordId);
    const run = <T,>(fn: (c: Db) => Promise<T>) => asSession(coordId, sessionId, fn);

    const live = await snapshot(run, facilityId);
    expect(live).toMatchObject({
      alive: true,
      role: "coordinador",
      is_admin: false,
      worker_id: workerId,
      has_scope: true,
      can_manage: true,
      can_check: true,
      profiles: 1,
      scopes: 1,
    });
    expect(live.shifts).toBeGreaterThanOrEqual(1);

    await deleteSession(sessionId);

    const revoked = await snapshot(run, facilityId);
    expect(revoked).toEqual({
      alive: false,
      role: null,
      is_admin: false,
      worker_id: null,
      has_scope: false,
      can_manage: false,
      can_check: false,
      profiles: 0,
      scopes: 0,
      shifts: 0,
    });
  });

  it("administración pierde el acceso total y las funciones de registro rechazan la sesión", async () => {
    const sessionId = await createSession(adminId);
    const run = <T,>(fn: (c: Db) => Promise<T>) => asSession(adminId, sessionId, fn);

    const otherProfiles = (fn: typeof run) =>
      fn((c) => c.query("select count(*)::int as n from public.profiles where id <> auth.uid()"));

    const live = await snapshot(run, facilityId);
    expect(live).toMatchObject({ alive: true, role: "admin", is_admin: true, has_scope: true, can_manage: true, profiles: 1 });
    expect((await otherProfiles(run)).rows[0].n).toBeGreaterThan(0);

    await deleteSession(sessionId);

    const revoked = await snapshot(run, facilityId);
    expect(revoked).toMatchObject({ alive: false, role: null, is_admin: false, has_scope: false, can_manage: false, profiles: 0 });
    expect((await otherProfiles(run)).rows[0].n).toBe(0);
    // Las funciones que usan app.require_profile() fallan antes de hacer nada.
    expect(await expectPgError(run((c) => c.query("select public.check_in($1, $2)", [uid(), uid()])))).toMatch(
      /Sesión no válida/,
    );
  });

  it("una sesión vencida por not_after se trata igual que una revocada", async () => {
    const sessionId = await createSession(coordId, new Date(Date.now() - 1_000).toISOString());
    const revoked = await snapshot(<T,>(fn: (c: Db) => Promise<T>) => asSession(coordId, sessionId, fn), facilityId);
    expect(revoked).toMatchObject({ alive: false, role: null, has_scope: false, can_manage: false, profiles: 0, shifts: 0 });
  });

  it("sin session_id los claims siguen funcionando como antes (compatibilidad con las demás pruebas)", async () => {
    const r = await snapshot(<T,>(fn: (c: Db) => Promise<T>) => asUser(coordId, fn), facilityId);
    expect(r).toMatchObject({ alive: true, role: "coordinador", has_scope: true, can_manage: true, profiles: 1, scopes: 1 });
  });
});
