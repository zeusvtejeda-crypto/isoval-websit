/**
 * Guardias: cupo máximo frente a las asignaciones, guardias traslapadas de una
 * misma persona y corrección de los datos de una asignación con bitácora.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuper, asUser, createAuthUser, createFacilitySuper, createWorkerSuper, grantScope, pool, suffix } from "./helpers";

let facilityA: string;
let facilityB: string;
let coordA: string;
let coordWorker: string; // la coordinadora también es trabajadora de la sede
let coordOwn: string;
let auditorA: string;
let adminId: string;
/** Base de los horarios: dentro de unos días, al minuto (lejos de otras guardias de prueba). */
let base: number;

const HOUR = 3_600_000;
const at = (hours: number) => new Date(base + hours * HOUR).toISOString();

beforeAll(async () => {
  adminId = await createAuthUser({ role: "admin" });
  facilityA = await createFacilitySuper();
  facilityB = await createFacilitySuper();
  coordA = await createAuthUser({ role: "coordinador" });
  await grantScope(coordA, facilityA);
  coordWorker = await createWorkerSuper(facilityA);
  coordOwn = await createAuthUser({ role: "coordinador", workerId: coordWorker });
  await grantScope(coordOwn, facilityA);
  auditorA = await createAuthUser({ role: "auditor" });
  await grantScope(auditorA, facilityA);
  base = Math.floor((Date.now() + 3 * 24 * HOUR) / 60_000) * 60_000;
});

afterAll(async () => {
  await pool.end();
});

/** Guardia con horario exacto (desplazamientos en horas desde la base). */
async function shiftAt(startHours: number, endHours: number, extra: { maxStaff?: number | null; minStaff?: number } = {}): Promise<string> {
  const r = await asSuper((c) =>
    c.query(
      `insert into public.shifts (facility_id, meeting_point, starts_at, ends_at, min_staff, max_staff)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [facilityA, `Punto ${suffix()}`, at(startHours), at(endHours), extra.minStaff ?? 1, extra.maxStaff ?? null],
    ),
  );
  return r.rows[0].id;
}

async function assignAs(userId: string, shiftId: string, workerId: string): Promise<string> {
  const r = await asUser(userId, (c) =>
    c.query("insert into public.shift_assignments (shift_id, worker_id, change_reason) values ($1, $2, 'Asignación a la guardia') returning id", [
      shiftId,
      workerId,
    ]),
  );
  return r.rows[0].id;
}

/** Espera un error de Postgres y devuelve mensaje y código. */
async function pgError(promise: Promise<unknown>): Promise<{ message: string; code: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { message: string; code?: string };
    return { message: e.message, code: e.code ?? "" };
  }
  throw new Error("Se esperaba un error de la base de datos y no ocurrió");
}

describe("Cupo máximo", () => {
  it("no se reduce por debajo de las personas asignadas; sí al cancelar una asignación", async () => {
    const shiftId = await shiftAt(0, 4, { maxStaff: 3 });
    const assignments: string[] = [];
    for (let i = 0; i < 3; i++) assignments.push(await assignAs(coordA, shiftId, await createWorkerSuper(facilityA)));

    const below = await pgError(asUser(coordA, (c) => c.query("update public.shifts set max_staff = 2, change_reason = 'Menos cupo' where id = $1", [shiftId])));
    expect(below.code).toBe("23514");
    expect(below.message).toBe(
      "El cupo máximo (2) no puede ser menor que las personas asignadas a la guardia (3). Quita o cancela asignaciones antes de reducirlo.",
    );
    // Tampoco la llave de servicio.
    expect((await pgError(asSuper((c) => c.query("update public.shifts set max_staff = 1 where id = $1", [shiftId])))).code).toBe("23514");

    // Sin cambiar el cupo, el resto de la guardia se edita normalmente.
    const other = await asUser(coordA, (c) => c.query("update public.shifts set instructions = 'Llevar chaleco', change_reason = 'Instrucciones' where id = $1", [shiftId]));
    expect(other.rowCount).toBe(1);

    await asUser(coordA, (c) => c.query("select public.set_assignment_status($1, 'cancelado', 'Ya no participa en la guardia')", [assignments[0]]));
    const ok = await asUser(coordA, (c) => c.query("update public.shifts set max_staff = 2, change_reason = 'Menos cupo' where id = $1 returning max_staff", [shiftId]));
    expect(ok.rows[0].max_staff).toBe(2);
    const unlimited = await asUser(coordA, (c) => c.query("update public.shifts set max_staff = null, change_reason = 'Sin límite' where id = $1", [shiftId]));
    expect(unlimited.rowCount).toBe(1);
  });
});

describe("Guardias traslapadas de una misma persona", () => {
  it("rechaza una asignación traslapada y permite guardias consecutivas", async () => {
    const worker = await createWorkerSuper(facilityA);
    const first = await shiftAt(10, 14);
    const overlapping = await shiftAt(12, 16);
    const consecutive = await shiftAt(14, 18);
    await assignAs(coordA, first, worker);

    const err = await pgError(assignAs(coordA, overlapping, worker));
    expect(err.code).toBe("22023");
    expect(err.message).toMatch(/^Esta persona ya está asignada a otra guardia que se traslapa con este horario \(del \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} al /);
    expect(err.message).toContain("Las guardias consecutivas sí se permiten.");
    // Administración y la llave de servicio tampoco.
    await expect(assignAs(adminId, overlapping, worker)).rejects.toThrow(/traslapa/);
    await expect(asSuper((c) => c.query("insert into public.shift_assignments (shift_id, worker_id) values ($1, $2)", [overlapping, worker]))).rejects.toThrow(
      /traslapa/,
    );

    // Termina a las 14:00 y la otra empieza a las 14:00: no se traslapan.
    expect(await assignAs(coordA, consecutive, worker)).toBeTruthy();
  });

  it("al reprogramar, ninguna persona asignada puede quedar en dos guardias traslapadas", async () => {
    const worker = await createWorkerSuper(facilityA);
    const first = await shiftAt(20, 24);
    const later = await shiftAt(24, 28);
    await assignAs(coordA, first, worker);
    await assignAs(coordA, later, worker);

    const moved = await pgError(
      asUser(coordA, (c) => c.query("update public.shifts set starts_at = $2, change_reason = 'Empieza antes' where id = $1", [later, at(23)])),
    );
    expect(moved.code).toBe("22023");
    expect(moved.message).toMatch(/^Con este horario, .+ tendría dos guardias asignadas que se traslapan\./);
    // Moverla más tarde sí se permite.
    const ok = await asUser(coordA, (c) =>
      c.query("update public.shifts set starts_at = $2, ends_at = $3, change_reason = 'Empieza después' where id = $1", [later, at(25), at(29)]),
    );
    expect(ok.rowCount).toBe(1);
  });

  it("las guardias canceladas no cuentan, pero reactivarlas sí se revisa", async () => {
    const worker = await createWorkerSuper(facilityA);
    const active = await shiftAt(30, 34);
    const cancelled = await shiftAt(32, 36);
    await assignAs(coordA, active, worker);
    await asSuper((c) => c.query("update public.shifts set status = 'cancelada', cancel_reason = 'Prueba de cancelación' where id = $1", [cancelled]));
    // Una asignación que ya estaba en la guardia cancelada no bloquea otras guardias.
    await asSuper((c) => c.query("insert into public.shift_assignments (shift_id, worker_id) values ($1, $2)", [cancelled, worker]));
    expect(await assignAs(coordA, await shiftAt(35, 38), worker)).toBeTruthy();

    const reactivate = await pgError(
      asUser(coordA, (c) => c.query("update public.shifts set status = 'programada', cancel_reason = null, change_reason = 'Se reactiva' where id = $1", [cancelled])),
    );
    expect(reactivate.message).toMatch(/tendría dos guardias asignadas que se traslapan/);
  });

  it("una asignación inactiva no cuenta; volver a «Asignado» sí se revisa", async () => {
    const worker = await createWorkerSuper(facilityA);
    const first = await shiftAt(40, 44);
    const second = await shiftAt(41, 45);
    const a1 = await assignAs(coordA, first, worker);
    await asUser(coordA, (c) => c.query("select public.set_assignment_status($1, 'ausencia_justificada', 'Incapacidad notificada')", [a1]));
    expect(await assignAs(coordA, second, worker)).toBeTruthy();

    const back = await pgError(asUser(coordA, (c) => c.query("select public.set_assignment_status($1, 'asignado', 'Sí podrá asistir')", [a1])));
    expect(back.message).toMatch(/ya está asignada a otra guardia que se traslapa/);
    const status = await asSuper((c) => c.query("select status from public.shift_assignments where id = $1", [a1]));
    expect(status.rows[0].status).toBe("ausencia_justificada");
  });
});

describe("Corregir los datos de una asignación", () => {
  it("coordinación corrige punto, «cubre a» y notas con motivo; la bitácora guarda anterior, nuevo y motivo", async () => {
    const shiftId = await shiftAt(50, 54);
    const worker = await createWorkerSuper(facilityA);
    const covered = await createWorkerSuper(facilityA);
    const assignmentId = await assignAs(coordA, shiftId, worker);

    const upd = await asUser(coordA, (c) =>
      c.query(
        "update public.shift_assignments set assigned_point = 'Puerta norte', substitute_for_worker_id = $2, notes = 'Trae radio', change_reason = 'Cubre la incapacidad registrada' where id = $1",
        [assignmentId, covered],
      ),
    );
    expect(upd.rowCount).toBe(1);

    const log = await asSuper((c) =>
      c.query(
        `select actor_id, action, reason, changed_fields, old_data, new_data, facility_id from public.audit_log
         where table_name = 'shift_assignments' and record_id = $1 and action = 'UPDATE' order by id desc limit 1`,
        [assignmentId],
      ),
    );
    const entry = log.rows[0];
    expect(entry.actor_id).toBe(coordA);
    expect(entry.reason).toBe("Cubre la incapacidad registrada");
    expect(entry.facility_id).toBe(facilityA);
    expect(entry.changed_fields).toEqual(expect.arrayContaining(["assigned_point", "notes", "substitute_for_worker_id"]));
    expect(entry.old_data).toMatchObject({ assigned_point: null, substitute_for_worker_id: null, notes: null });
    expect(entry.new_data).toMatchObject({ assigned_point: "Puerta norte", substitute_for_worker_id: covered, notes: "Trae radio" });

    // La coordinación de la sede ve la bitácora de la corrección.
    const visible = await asUser(coordA, (c) =>
      c.query("select count(*)::int as n from public.audit_log where table_name = 'shift_assignments' and record_id = $1 and action = 'UPDATE'", [assignmentId]),
    );
    expect(visible.rows[0].n).toBeGreaterThan(0);
  });

  it("la persona sustituida debe ser visible y distinta de la asignada; no se cambia la persona ni el estado directamente", async () => {
    const shiftId = await shiftAt(60, 64);
    const worker = await createWorkerSuper(facilityA);
    const assignmentId = await assignAs(coordA, shiftId, worker);
    const elsewhere = await createWorkerSuper(facilityB);

    const hidden = await pgError(
      asUser(coordA, (c) =>
        c.query("update public.shift_assignments set substitute_for_worker_id = $2, change_reason = 'Sustitución' where id = $1", [assignmentId, elsewhere]),
      ),
    );
    expect(hidden.code).toBe("42501");
    expect(hidden.message).toBe("La persona sustituida no existe o no es visible para tu cuenta");
    // Administración sí ve a todas las personas.
    const byAdmin = await asUser(adminId, (c) =>
      c.query("update public.shift_assignments set substitute_for_worker_id = $2, change_reason = 'Sustitución entre sedes' where id = $1", [assignmentId, elsewhere]),
    );
    expect(byAdmin.rowCount).toBe(1);

    const self = await pgError(
      asUser(coordA, (c) =>
        c.query("update public.shift_assignments set substitute_for_worker_id = $2, change_reason = 'Sustitución' where id = $1", [assignmentId, worker]),
      ),
    );
    expect(self.message).toMatch(/shift_assignments_not_self_substitute/);
    expect((await pgError(asUser(coordA, (c) => c.query("update public.shift_assignments set status = 'cancelado' where id = $1", [assignmentId])))).message).toMatch(
      /permission denied/,
    );
    expect(
      (await pgError(asUser(coordA, (c) => c.query("update public.shift_assignments set worker_id = $2 where id = $1", [assignmentId, worker])))).message,
    ).toMatch(/permission denied/);
  });

  it("nadie salvo administración corrige su propia asignación; auditoría no modifica", async () => {
    const shiftId = await shiftAt(70, 74);
    const assignmentId = await assignAs(coordA, shiftId, coordWorker);

    const own = await pgError(
      asUser(coordOwn, (c) => c.query("update public.shift_assignments set notes = 'Me cambio el punto', change_reason = 'Ajuste propio' where id = $1", [assignmentId])),
    );
    expect(own.message).toMatch(/propia asistencia/);

    const audit = await asUser(auditorA, (c) =>
      c.query("update public.shift_assignments set notes = 'Revisado por auditoría', change_reason = 'Revisión' where id = $1", [assignmentId]),
    );
    expect(audit.rowCount).toBe(0);
    const row = await asSuper((c) => c.query("select notes from public.shift_assignments where id = $1", [assignmentId]));
    expect(row.rows[0].notes).toBeNull();

    // Otra persona de coordinación sí puede.
    const other = await asUser(coordA, (c) =>
      c.query("update public.shift_assignments set notes = 'Revisado', change_reason = 'Revisión de coordinación' where id = $1", [assignmentId]),
    );
    expect(other.rowCount).toBe(1);
  });
});
