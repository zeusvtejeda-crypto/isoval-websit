/**
 * Bitácora con motivo (configuración, categorías, catálogos geográficos, sedes
 * asignadas y restablecimientos de contraseña) y auditoría de solo lectura.
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
  suffix,
  uid,
  type Db,
} from "./helpers";

let facilityA: string;
let facilityB: string;
let admin: string;
let coordA: string;
let auditor: string;
let worker: string;
let workerUser: string;
let assignmentId: string;
let sessionId: string;

beforeAll(async () => {
  facilityA = await createFacilitySuper();
  facilityB = await createFacilitySuper();
  admin = await createAuthUser({ role: "admin" });
  coordA = await createAuthUser({ role: "coordinador" });
  await grantScope(coordA, facilityA);
  auditor = await createAuthUser({ role: "auditor" });
  await grantScope(auditor, facilityA);
  worker = await createWorkerSuper(facilityA);
  workerUser = await createAuthUser({ role: "trabajador", workerId: worker });
  const shiftId = await createShiftSuper(facilityA, -30, 240);
  assignmentId = await assignSuper(shiftId, worker);
  const r = await asUser(workerUser, (c) => c.query("select public.check_in($1, $2) as r", [assignmentId, uid()]));
  sessionId = r.rows[0].r.session.id;
});

afterAll(async () => {
  await pool.end();
});

/**
 * Como asUser, pero siempre revierte: permite tocar datos compartidos
 * (configuración y catálogos) sin afectar otras pruebas. La bitácora escrita
 * en la transacción se consulta antes de revertir.
 */
async function asUserRolledBack<T>(userId: string, fn: (c: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated" }),
    ]);
    await c.query("set local role authenticated");
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
}

type AuditRow = { action: string; reason: string | null; changed_fields: string[] | null; actor_id: string | null };

async function lastAudit(c: Db, table: string, recordId: string | number): Promise<AuditRow> {
  const r = await c.query(
    "select action, reason, changed_fields, actor_id from public.audit_log where table_name = $1 and record_id = $2 order by id desc limit 1",
    [table, String(recordId)],
  );
  return r.rows[0];
}

describe("Bitácora con motivo", () => {
  it("configuración: el motivo llega a la bitácora; uno repetido se pierde si no se limpia antes", async () => {
    await asUserRolledBack(admin, async (c) => {
      await c.query(
        `update public.app_settings set value = value || '{"prueba": 1}'::jsonb, change_reason = 'Ajuste de ventana de registro' where key = 'attendance'`,
      );
      expect(await lastAudit(c, "app_settings", "attendance")).toMatchObject({
        action: "UPDATE",
        reason: "Ajuste de ventana de registro",
        changed_fields: ["value"],
        actor_id: admin,
      });

      // app.touch_row() borra un motivo igual al guardado (no arrastra motivos viejos)…
      await c.query(
        `update public.app_settings set value = value || '{"prueba": 2}'::jsonb, change_reason = 'Ajuste de ventana de registro' where key = 'attendance'`,
      );
      expect((await lastAudit(c, "app_settings", "attendance")).reason).toBeNull();
      // …por eso la aplicación limpia primero (sin generar otra entrada) y luego escribe.
      const before = await c.query("select count(*)::int as n from public.audit_log where table_name = 'app_settings' and record_id = 'attendance'");
      await c.query("update public.app_settings set change_reason = null where key = 'attendance'");
      const after = await c.query("select count(*)::int as n from public.audit_log where table_name = 'app_settings' and record_id = 'attendance'");
      expect(after.rows[0].n).toBe(before.rows[0].n);
      await c.query(
        `update public.app_settings set value = value || '{"prueba": 3}'::jsonb, change_reason = 'Ajuste de ventana de registro' where key = 'attendance'`,
      );
      expect((await lastAudit(c, "app_settings", "attendance")).reason).toBe("Ajuste de ventana de registro");
    });
  });

  it("categorías: alta, cambio y eliminación con motivo", async () => {
    await asUserRolledBack(admin, async (c) => {
      const s = suffix();
      const ins = await c.query(
        "insert into public.facility_categories (slug, name, change_reason) values ($1, $2, 'Alta de categoría de prueba') returning id",
        [`prueba-${s}`, `Prueba ${s}`],
      );
      const id = ins.rows[0].id as number;
      expect(await lastAudit(c, "facility_categories", id)).toMatchObject({ action: "INSERT", reason: "Alta de categoría de prueba" });

      await c.query("update public.facility_categories set name = $2, change_reason = 'Nombre oficial nuevo' where id = $1", [id, `Prueba ${s} (b)`]);
      expect(await lastAudit(c, "facility_categories", id)).toMatchObject({ action: "UPDATE", reason: "Nombre oficial nuevo", changed_fields: ["name"] });

      // El borrado toma el motivo guardado en la fila.
      await c.query("update public.facility_categories set change_reason = 'Creada por error' where id = $1", [id]);
      await c.query("delete from public.facility_categories where id = $1", [id]);
      expect(await lastAudit(c, "facility_categories", id)).toMatchObject({ action: "DELETE", reason: "Creada por error" });
    });
  });

  it("entidades y municipios: el motivo llega a la bitácora y no se arrastra al siguiente cambio", async () => {
    await asUserRolledBack(admin, async (c) => {
      await c.query("update public.states set enabled = not enabled, change_reason = 'Cobertura por convenio' where id = 20");
      expect(await lastAudit(c, "states", 20)).toMatchObject({ action: "UPDATE", reason: "Cobertura por convenio", changed_fields: ["enabled"] });
      await c.query("update public.states set default_timezone = 'America/Merida' where id = 20");
      expect(await lastAudit(c, "states", 20)).toMatchObject({ changed_fields: ["default_timezone"], reason: null });

      const code = String(500 + Math.floor(Math.random() * 499)).padStart(3, "0");
      const ins = await c.query(
        "insert into public.municipalities (state_id, inegi_code, name, change_reason) values (18, $1, $2, 'Publicación del INEGI') returning id",
        [code, `Municipio de prueba ${suffix()}`],
      );
      const id = ins.rows[0].id as number;
      expect(await lastAudit(c, "municipalities", id)).toMatchObject({ action: "INSERT", reason: "Publicación del INEGI" });
      await c.query("update public.municipalities set timezone = 'America/Bahia_Banderas', change_reason = 'Horario de la costa' where id = $1", [id]);
      expect(await lastAudit(c, "municipalities", id)).toMatchObject({ action: "UPDATE", reason: "Horario de la costa", changed_fields: ["timezone"] });
    });
  });

  it("sedes asignadas: altas y retiros con motivo mediante set_user_scopes", async () => {
    const coordX = await createAuthUser({ role: "coordinador" });
    const added = await asUser(admin, (c) =>
      c.query("select public.set_user_scopes($1, $2::uuid[], 'Cobertura de dos sedes') as r", [coordX, [facilityA, facilityB, facilityA]]),
    );
    expect(added.rows[0].r).toEqual({ added: 2, removed: 0 });

    await asUser(admin, async (c) => {
      const r = await c.query("select public.set_user_scopes($1, $2::uuid[], 'Deja la sede A') as r", [coordX, [facilityB]]);
      expect(r.rows[0].r).toEqual({ added: 0, removed: 1 });
      // El motivo no alcanza otras escrituras de la misma transacción.
      const guc = await c.query("select coalesce(current_setting('app.change_reason', true), '') as v");
      expect(guc.rows[0].v).toBe("");
    });

    const rows = await asSuper((c) =>
      c.query("select action, reason, record_id, actor_id from public.audit_log where table_name = 'user_facility_scopes' and record_id like $1 order by id", [
        `${coordX}:%`,
      ]),
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({ action: "INSERT", reason: "Cobertura de dos sedes", actor_id: admin }),
      expect.objectContaining({ action: "INSERT", reason: "Cobertura de dos sedes", actor_id: admin }),
      { action: "DELETE", reason: "Deja la sede A", record_id: `${coordX}:${facilityA}`, actor_id: admin },
    ]);
    const scopes = await asSuper((c) => c.query("select facility_id from public.user_facility_scopes where user_id = $1", [coordX]));
    expect(scopes.rows.map((r) => r.facility_id)).toEqual([facilityB]);
  });

  it("set_user_scopes: solo administración, con motivo y para coordinación o auditoría", async () => {
    const coordX = await createAuthUser({ role: "coordinador" });
    const call = (user: string | null, target: string, ids: string[], reason: string) =>
      asUser(user, (c) => c.query("select public.set_user_scopes($1, $2::uuid[], $3)", [target, ids, reason]));
    expect(await expectPgError(call(coordA, coordX, [facilityA], "Me asigno la sede"))).toMatch(/Solo administración/);
    expect(await expectPgError(call(auditor, coordX, [facilityA], "Me asigno la sede"))).toMatch(/Solo administración/);
    expect(await expectPgError(call(null, coordX, [facilityA], "Sin sesión válida"))).toMatch(/permission denied/);
    expect(await expectPgError(call(admin, coordX, [facilityA], " abc "))).toMatch(/motivo/);
    expect(await expectPgError(call(admin, workerUser, [facilityA], "Sede para un trabajador"))).toMatch(/coordinación y auditoría/);
    expect(await expectPgError(call(admin, coordX, [uid()], "Sede inexistente"))).toMatch(/ya no existe/);
    expect(await expectPgError(call(admin, uid(), [], "Cuenta inexistente"))).toMatch(/no existe/);
    const none = await asSuper((c) => c.query("select count(*)::int as n from public.user_facility_scopes where user_id = $1", [coordX]));
    expect(none.rows[0].n).toBe(0);
  });

  it("restablecer contraseña deja constancia con motivo, sin la contraseña, visible solo para administración", async () => {
    const target = await createAuthUser({ role: "coordinador" });
    const r = await asUser(admin, (c) => c.query("select public.log_password_reset($1, 'La titular olvidó su contraseña') as id", [target]));
    const row = await asSuper((c) => c.query("select * from public.audit_log where id = $1", [r.rows[0].id]));
    expect(row.rows[0]).toMatchObject({
      table_name: "auth.users",
      record_id: target,
      action: "UPDATE",
      changed_fields: ["password"],
      reason: "La titular olvidó su contraseña",
      actor_id: admin,
      actor_role: "admin",
      facility_id: null,
    });
    expect(Object.keys(row.rows[0].new_data).sort()).toEqual(["password", "user_id"]);
    expect(row.rows[0].new_data.password).toMatch(/no se guarda/);

    expect(await expectPgError(asUser(coordA, (c) => c.query("select public.log_password_reset($1, 'Intento de coordinación')", [target])))).toMatch(
      /Solo administración/,
    );
    expect(await expectPgError(asUser(admin, (c) => c.query("select public.log_password_reset($1, 'abc')", [target])))).toMatch(/motivo/);
    expect(await expectPgError(asUser(admin, (c) => c.query("select public.log_password_reset($1, 'Cuenta inexistente')", [uid()])))).toMatch(/no existe/);
    expect(await expectPgError(asUser(null, (c) => c.query("select public.log_password_reset($1, 'Sin sesión válida')", [target])))).toMatch(
      /permission denied/,
    );
    const seen = await asUser(coordA, (c) => c.query("select count(*)::int as n from public.audit_log where table_name = 'auth.users' and record_id = $1", [target]));
    expect(seen.rows[0].n).toBe(0);
  });

  it("el público lee catálogos y configuración pública, pero no los motivos", async () => {
    for (const table of ["states", "municipalities", "facility_categories", "app_settings"]) {
      expect(await expectPgError(asUser(null, (c) => c.query(`select change_reason from public.${table} limit 1`)))).toMatch(/permission denied/);
    }
    const states = await asUser(null, (c) => c.query("select id, name, abbreviation, default_timezone, enabled from public.states where id = 18"));
    expect(states.rows).toHaveLength(1);
    const cats = await asUser(null, (c) => c.query("select id, slug, name, color, icon, active from public.facility_categories limit 1"));
    expect(cats.rows).toHaveLength(1);
    const notice = await asUser(null, (c) => c.query("select value, updated_at from public.app_settings where key = 'privacy_notice'"));
    expect(notice.rows).toHaveLength(1);
    const head = await asUser(null, (c) => c.query("select count(*)::int as n from public.municipalities where state_id = 18"));
    expect(head.rows[0].n).toBeGreaterThan(0);
    // Tampoco las cuentas autenticadas (ni administración): el motivo solo lo conserva la bitácora.
    for (const table of ["states", "municipalities", "facility_categories", "app_settings", "user_facility_scopes"]) {
      expect(await expectPgError(asUser(admin, (c) => c.query(`select change_reason from public.${table} limit 1`)))).toMatch(/permission denied/);
    }
  });
});

describe("Auditoría: solo lectura", () => {
  it("con la sede asignada consulta, pero no programa guardias ni registra o corrige asistencia", async () => {
    const shifts = await asUser(auditor, (c) => c.query("select id from public.shifts where facility_id = $1", [facilityA]));
    expect(shifts.rows.length).toBeGreaterThan(0);

    expect(
      await expectPgError(
        asUser(auditor, (c) =>
          c.query(
            "insert into public.shifts (facility_id, meeting_point, starts_at, ends_at) values ($1, 'Acceso principal', now() + interval '1 day', now() + interval '1 day 8 hours')",
            [facilityA],
          ),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(await expectPgError(asUser(auditor, (c) => c.query("select public.check_in($1, $2, null, 'Registro en nombre de otra persona')", [assignmentId, uid()])))).toMatch(
      /No tienes permiso/,
    );
    expect(
      await expectPgError(
        asUser(auditor, (c) =>
          c.query("select public.correct_attendance($1, now() - interval '20 minutes', null, 'Corrección de auditoría')", [sessionId]),
        ),
      ),
    ).toMatch(/No tienes permiso/);
    expect(
      await expectPgError(asUser(auditor, (c) => c.query("select public.set_assignment_status($1, 'ausencia_justificada', 'Justificada por auditoría')", [assignmentId]))),
    ).toMatch(/No tienes permiso/);
    expect(
      await expectPgError(
        asUser(auditor, (c) =>
          c.query("insert into public.incident_notes (assignment_id, facility_id, incident_type, note) values ($1, $2, 'llegada_tardia', 'Nota de auditoría')", [
            assignmentId,
            facilityA,
          ]),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await expectPgError(
        asUser(auditor, (c) => c.query("select * from public.request_correction($1, $2, now() - interval '25 minutes', null, 'Solicitud de auditoría')", [assignmentId, sessionId])),
      ),
    ).toMatch(/propios registros/);
  });

  it("no modifica la configuración", async () => {
    await asUserRolledBack(auditor, async (c) => {
      const r = await c.query(`update public.app_settings set value = value || '{"prueba": 1}'::jsonb, change_reason = 'Intento de auditoría' where key = 'attendance'`);
      expect(r.rowCount).toBe(0);
    });
    expect(
      await expectPgError(
        asUser(auditor, (c) => c.query(`insert into public.app_settings (key, value) values ($1, '{}'::jsonb)`, [`prueba_${suffix().replace(/-/g, "")}`])),
      ),
    ).toMatch(/row-level security/);
  });

  it("no se vincula a un trabajador", async () => {
    const other = await createWorkerSuper(facilityA);
    expect(await expectPgError(asUser(admin, (c) => c.query("update public.profiles set worker_id = $1 where id = $2", [other, auditor])))).toMatch(
      /profiles_auditor_without_worker/,
    );
    // Tampoco al cambiar a auditoría una cuenta ya vinculada.
    expect(await expectPgError(asUser(admin, (c) => c.query("update public.profiles set role = 'auditor' where id = $1", [workerUser])))).toMatch(
      /profiles_auditor_without_worker/,
    );
    // El alta desde Auth ignora el trabajador si el rol es auditoría (en lugar de fallar).
    const fresh = await createAuthUser({ role: "auditor", workerId: await createWorkerSuper(facilityA) });
    const profile = await asSuper((c) => c.query("select role, worker_id from public.profiles where id = $1", [fresh]));
    expect(profile.rows[0]).toEqual({ role: "auditor", worker_id: null });
  });
});
