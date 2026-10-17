/**
 * Conservación de datos y bitácora: al aplicar la política, las copias en la
 * bitácora de los datos eliminados (datos privados de trabajadores inactivos,
 * guardias antiguas con su asistencia) se redactan; la bitácora sigue siendo
 * inmutable fuera de esa redacción.
 *
 * Todo corre en UNA transacción que se revierte: los periodos de conservación
 * se cambian solo dentro de ella (40 años) y los datos «antiguos» son filas
 * propias fechadas en 1980, así que no se toca ningún otro dato.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { categoryId, createAuthUser, municipalityId, pool, suffix, uid, type Db } from "./helpers";

let adminId: string;
let category: number;
let municipality: number;

beforeAll(async () => {
  adminId = await createAuthUser({ role: "admin" });
  category = await categoryId();
  municipality = await municipalityId();
});

/** Como superusuario, siempre con ROLLBACK (nada queda guardado). */
async function inRollback(fn: (c: Db) => Promise<void>): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await fn(c);
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
}

async function asAdmin<T>(c: Db, fn: () => Promise<T>): Promise<T> {
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adminId, role: "authenticated", aud: "authenticated" })]);
  await c.query("set local role authenticated");
  try {
    return await fn();
  } finally {
    await c.query("reset role");
  }
}

/** Ejecuta una sentencia que debe fallar, sin abortar la transacción. */
async function expectFails(c: Db, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("savepoint intento");
  try {
    await c.query(sql, params);
  } catch (error) {
    await c.query("rollback to savepoint intento");
    return (error as Error).message;
  }
  await c.query("rollback to savepoint intento");
  throw new Error(`Se esperaba un error y no ocurrió: ${sql}`);
}

type Fixture = {
  facility: string;
  oldWorker: string;
  oldPhone: string;
  oldEmployee: string;
  keptWorker: string;
  keptPhone: string;
  oldShift: string;
  oldAssignment: string;
  oldSession: string;
  keptShift: string;
};

/** Datos propios: un trabajador que quedará inactivo con guardia en 1980 y otro vigente. */
async function prepare(c: Db): Promise<Fixture> {
  const tag = suffix();
  const one = async (sql: string, params: unknown[]) => (await c.query(sql, params)).rows[0].id as string;

  const facility = await one(
    `insert into public.facilities (official_name, category_id, state_id, municipality_id, latitude, longitude, source)
     values ($1, $2, 18, $3, 21.5, -104.9, 'Prueba automatizada') returning id`,
    [`Instalación conservación ${tag}`, category, municipality],
  );
  const oldWorker = await one(`insert into public.workers (full_name, state_id, facility_id) values ($1, 18, $2) returning id`, [
    `Persona antigua ${tag}`,
    facility,
  ]);
  const keptWorker = await one(`insert into public.workers (full_name, state_id, facility_id) values ($1, 18, $2) returning id`, [
    `Persona vigente ${tag}`,
    facility,
  ]);
  const digits = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  const oldPhone = `311 ${digits}`;
  const oldEmployee = `RET-${tag}`;
  const keptPhone = `322 ${digits}`;
  await c.query(`insert into public.worker_private (worker_id, employee_number, phone) values ($1, $2, '311 000 0000')`, [oldWorker, oldEmployee]);
  // Una modificación: la bitácora guarda el valor anterior y el nuevo.
  await c.query(`update public.worker_private set phone = $2, change_reason = 'Cambio de teléfono' where worker_id = $1`, [oldWorker, oldPhone]);
  await c.query(`insert into public.worker_private (worker_id, employee_number, phone) values ($1, $2, $3)`, [keptWorker, `KEEP-${tag}`, keptPhone]);

  const oldShift = await one(
    `insert into public.shifts (facility_id, meeting_point, starts_at, ends_at) values ($1, $2, now() - interval '2 hours', now() + interval '6 hours') returning id`,
    [facility, `Punto antiguo ${tag}`],
  );
  const keptShift = await one(
    `insert into public.shifts (facility_id, meeting_point, starts_at, ends_at) values ($1, $2, now() - interval '2 hours', now() + interval '6 hours') returning id`,
    [facility, `Punto vigente ${tag}`],
  );
  const oldAssignment = await one(`insert into public.shift_assignments (shift_id, worker_id) values ($1, $2) returning id`, [oldShift, oldWorker]);
  await c.query(`insert into public.shift_assignments (shift_id, worker_id) values ($1, $2)`, [keptShift, keptWorker]);
  const oldSession = await one(
    `insert into public.attendance_sessions (assignment_id, check_in_at, check_in_method, check_in_by, check_in_request_id, notes)
     values ($1, now() - interval '1 hour', 'coordinador', $2, $3, 'Llegó con su hija') returning id`,
    [oldAssignment, adminId, uid()],
  );
  await c.query(
    `insert into public.correction_requests (assignment_id, session_id, worker_id, facility_id, requested_by, reason, requested_check_in_at)
     values ($1, $2, $3, $4, $5, 'Registré tarde por una consulta médica', now() - interval '90 minutes')`,
    [oldAssignment, oldSession, oldWorker, facility, adminId],
  );
  await c.query(`insert into public.incident_notes (assignment_id, facility_id, incident_type, note) values ($1, $2, 'llegada_tardia', 'Avisó por teléfono')`, [
    oldAssignment,
    facility,
  ]);

  // «Antigüedad»: la guardia terminó en 1980 y el trabajador está inactivo desde entonces
  // (sin disparadores para que updated_at no se renueve).
  await c.query("set local session_replication_role = replica");
  await c.query(`update public.shifts set starts_at = '1980-03-01 08:00+00', ends_at = '1980-03-01 16:00+00' where id = $1`, [oldShift]);
  await c.query(`update public.workers set active = false, updated_at = '1980-03-02 00:00+00' where id = $1`, [oldWorker]);
  await c.query("set local session_replication_role = origin");

  // Periodos de 40 años (corte ≈ 1986): solo los datos propios de 1980 quedan antes del corte.
  await c.query(
    `update public.app_settings
     set value = value || '{"attendance_months": 480, "audit_months": 480, "inactive_worker_months": 480}'::jsonb
     where key = 'retention'`,
  );

  return { facility, oldWorker, oldPhone, oldEmployee, keptWorker, keptPhone, oldShift, oldAssignment, oldSession, keptShift };
}

const AUDIT_COLUMNS = "id, table_name, action, actor_id, occurred_at, changed_fields, reason, record_id, old_data, new_data, redacted_at";

/** Eventos de bitácora de los datos que la política elimina (antes de redactarlos). */
async function purgedAuditRows(c: Db, f: Fixture) {
  const r = await c.query(
    `select ${AUDIT_COLUMNS}
     from public.audit_log
     where (table_name = 'worker_private' and record_id = $1)
        or (table_name = 'shifts' and record_id = $2)
        or (table_name in ('shift_assignments', 'attendance_sessions') and coalesce(new_data, old_data) ->> 'shift_id' = $2)
        or (table_name in ('correction_requests', 'incident_notes') and coalesce(new_data, old_data) ->> 'assignment_id' = $3)
     order by id`,
    [f.oldWorker, f.oldShift, f.oldAssignment],
  );
  return r.rows;
}

async function auditRowsById(c: Db, ids: string[]) {
  return (await c.query(`select ${AUDIT_COLUMNS} from public.audit_log where id = any($1::bigint[]) order by id`, [ids])).rows;
}

describe("política de conservación y copias en la bitácora", () => {
  it("el cálculo sin eliminar informa cuántos eventos de bitácora se redactarían y no cambia nada", async () => {
    await inRollback(async (c) => {
      const f = await prepare(c);
      const before = await purgedAuditRows(c, f);
      // Alta y cambio de datos privados, guardia, asignación, registro, solicitud y justificación.
      expect(before.map((r) => r.table_name).sort()).toEqual(
        ["attendance_sessions", "correction_requests", "incident_notes", "shift_assignments", "shifts", "worker_private", "worker_private"].sort(),
      );

      const dry = await asAdmin(c, async () => (await c.query("select public.apply_retention_policy(false) as r")).rows[0].r);
      expect(dry).toMatchObject({ executed: false, shifts: 1, sessions: 1, audit_rows: 0, worker_private_rows: 1, audit_rows_redacted: before.length });

      const after = await purgedAuditRows(c, f);
      expect(after).toEqual(before);
      expect(after.every((r) => r.redacted_at === null)).toBe(true);
    });
  });

  it("al aplicar, las copias quedan sin datos personales y se conservan autor, fecha, acción, campos y motivo", async () => {
    await inRollback(async (c) => {
      const f = await prepare(c);
      const before = await purgedAuditRows(c, f);
      // La bitácora sí copiaba el teléfono y el número de trabajador.
      expect(JSON.stringify(before)).toContain(f.oldPhone);
      expect(JSON.stringify(before)).toContain(f.oldEmployee);

      const result = await asAdmin(c, async () => (await c.query("select public.apply_retention_policy(true) as r")).rows[0].r);
      expect(result).toMatchObject({ executed: true, shifts: 1, sessions: 1, worker_private_rows: 1, audit_rows_redacted: before.length });

      // Se eliminaron los datos…
      const left = await c.query(
        `select (select count(*)::int from public.worker_private where worker_id = $1) as private_rows,
                (select count(*)::int from public.shifts where id = $2) as shifts,
                (select count(*)::int from public.attendance_sessions where id = $3) as sessions,
                (select count(*)::int from public.workers where id = $1) as worker_rows`,
        [f.oldWorker, f.oldShift, f.oldSession],
      );
      expect(left.rows[0]).toEqual({ private_rows: 0, shifts: 0, sessions: 0, worker_rows: 1 });

      // …y sus copias en la bitácora.
      const after = await auditRowsById(
        c,
        before.map((r) => r.id),
      );
      expect(after).toHaveLength(before.length);
      const keptColumns = ["id", "table_name", "action", "actor_id", "occurred_at", "changed_fields", "reason", "record_id"];
      const pick = (row: Record<string, unknown>) => Object.fromEntries(keptColumns.map((k) => [k, row[k]]));
      for (const [i, row] of after.entries()) {
        expect(row.old_data).toBeNull();
        expect(row.new_data).toEqual({ redactado: "conservacion" });
        expect(row.redacted_at).not.toBeNull();
        expect(pick(row)).toEqual(pick(before[i]));
      }
      expect(after.find((r) => r.table_name === "worker_private" && r.action === "UPDATE")).toMatchObject({
        changed_fields: ["phone"],
        reason: "Cambio de teléfono",
      });
      const leaks = await c.query(
        `select count(*)::int as n from public.audit_log
         where coalesce(old_data::text, '') || coalesce(new_data::text, '') ~ $1`,
        [`${f.oldPhone}|${f.oldEmployee}|Llegó con su hija|consulta médica|Avisó por teléfono`],
      );
      expect(leaks.rows[0].n).toBe(0);

      // Lo que no se elimina conserva su bitácora completa.
      const kept = await c.query(
        `select count(*)::int as n, count(*) filter (where redacted_at is null and new_data ->> 'phone' = $3)::int as intact
         from public.audit_log where table_name = 'worker_private' and record_id = $1
         union all
         select count(*)::int, count(*) filter (where redacted_at is null and new_data ->> 'id' = $2)::int
         from public.audit_log where table_name = 'shifts' and record_id = $2`,
        [f.keptWorker, f.keptShift, f.keptPhone],
      );
      expect(kept.rows).toEqual([
        { n: 1, intact: 1 },
        { n: 1, intact: 1 },
      ]);

      // El evento PURGE registra cuántos se redactaron.
      const purge = await c.query(
        `select new_data from public.audit_log where table_name = 'retention' and action = 'PURGE' and actor_id = $1 order by id desc limit 1`,
        [adminId],
      );
      expect(purge.rows[0].new_data).toMatchObject({ worker_private_rows: 1, audit_rows_redacted: before.length });

      // Volver a calcular ya no encuentra nada que redactar de estos datos.
      const again = await asAdmin(c, async () => (await c.query("select public.apply_retention_policy(false) as r")).rows[0].r);
      expect(again).toMatchObject({ shifts: 0, worker_private_rows: 0, audit_rows_redacted: 0 });
    });
  });

  it("la bitácora sigue sin poder modificarse ni borrarse fuera de la redacción por conservación", async () => {
    await inRollback(async (c) => {
      const f = await prepare(c);
      const rows = await purgedAuditRows(c, f);
      await asAdmin(c, async () => c.query("select public.apply_retention_policy(true)"));
      const redacted = rows[0].id as string;
      const intact = (
        await c.query(`select id from public.audit_log where table_name = 'worker_private' and record_id = $1 limit 1`, [f.keptWorker])
      ).rows[0].id as string;

      // Fuera de una depuración, ni siquiera redactar está permitido.
      for (const sql of [
        `update public.audit_log set old_data = null, new_data = '{"redactado": "conservacion"}', redacted_at = now() where id = $1`,
        `update public.audit_log set reason = 'Otro motivo' where id = $1`,
      ]) {
        expect(await expectFails(c, sql, [intact])).toMatch(/La bitácora no se modifica/);
      }
      expect(await expectFails(c, `update public.audit_log set redacted_at = null where id = $1`, [redacted])).toMatch(/La bitácora no se modifica/);
      expect(await expectFails(c, `delete from public.audit_log where id = $1`, [intact])).toMatch(/La bitácora no se elimina/);

      // Durante una depuración solo se admite vaciar el contenido una vez.
      await c.query("select set_config('app.allow_purge', 'on', true)");
      for (const sql of [
        `update public.audit_log set reason = 'Otro motivo' where id = $1`,
        `update public.audit_log set old_data = null, new_data = '{"phone": "311 999 9999"}', redacted_at = now() where id = $1`,
        `update public.audit_log set old_data = null, new_data = '{"redactado": "conservacion"}', redacted_at = now(), table_name = 'shifts' where id = $1`,
        `update public.audit_log set old_data = null, new_data = '{"redactado": "conservacion"}', redacted_at = null where id = $1`,
      ]) {
        expect(await expectFails(c, sql, [intact])).toMatch(/La bitácora no se modifica/);
      }
      expect(await expectFails(c, `update public.audit_log set redacted_at = now() where id = $1`, [redacted])).toMatch(/La bitácora no se modifica/);
      await c.query(`update public.audit_log set old_data = null, new_data = '{"redactado": "conservacion"}', redacted_at = now() where id = $1`, [
        intact,
      ]);
      await c.query("select set_config('app.allow_purge', 'off', true)");

      // Las funciones internas no son invocables por cuentas de la aplicación.
      await asAdmin(c, async () => {
        expect(await expectFails(c, "select app.redact_audit_rows(array[$1::bigint], 'conservacion')", [intact])).toMatch(/permission denied/);
        expect(await expectFails(c, "select * from app.retention_audit_targets(now(), now(), now())")).toMatch(/permission denied/);
      });
    });
  });

  it("solo administración aplica la política", async () => {
    const coordinador = await createAuthUser({ role: "coordinador" });
    await inRollback(async (c) => {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: coordinador, role: "authenticated" })]);
      await c.query("set local role authenticated");
      expect(await expectFails(c, "select public.apply_retention_policy(false)")).toMatch(/Solo administración/);
    });
  });
});
