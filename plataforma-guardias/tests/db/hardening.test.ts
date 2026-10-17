/**
 * Endurecimiento de seguridad (revisión adversarial): separación de funciones,
 * columnas protegidas, alcance de incidencias y servicios públicos.
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
let coordWorker: string; // la coordinadora también es trabajadora
let coordA: string;
let coordA2: string; // otra persona de coordinación en la misma sede
let adminId: string;

beforeAll(async () => {
  adminId = await createAuthUser({ role: "admin" });
  facilityA = await createFacilitySuper();
  facilityB = await createFacilitySuper();
  coordWorker = await createWorkerSuper(facilityA);
  coordA = await createAuthUser({ role: "coordinador", workerId: coordWorker });
  await grantScope(coordA, facilityA);
  coordA2 = await createAuthUser({ role: "coordinador" });
  await grantScope(coordA2, facilityA);
});

afterAll(async () => {
  await pool.end();
});

describe("Separación de funciones", () => {
  it("coordinación no agrega, corrige ni anula su propia asistencia; otra persona sí", async () => {
    const shiftId = await createShiftSuper(facilityA, -600, -60);
    const assignmentId = await assignSuper(shiftId, coordWorker);
    const own = await expectPgError(
      asUser(coordA, (c) =>
        c.query("select public.add_manual_attendance($1, now() - interval '9 hours', now() - interval '2 hours', 'Me lo autorizo yo', $2)", [assignmentId, uid()]),
      ),
    );
    expect(own).toMatch(/propia asistencia/);

    const created = await asUser(coordA2, (c) =>
      c.query("select public.add_manual_attendance($1, now() - interval '9 hours', now() - interval '2 hours', 'Registro por otra coordinación', $2) as r", [assignmentId, uid()]),
    );
    const sessionId = created.rows[0].r.session.id;
    expect(await expectPgError(asUser(coordA, (c) => c.query("select public.correct_attendance($1, now() - interval '10 hours', now() - interval '2 hours', 'Ajuste propio')", [sessionId])))).toMatch(/propia asistencia/);
    expect(await expectPgError(asUser(coordA, (c) => c.query("select public.void_attendance($1, 'Anulación propia')", [sessionId])))).toMatch(/propia asistencia/);
    // Administración sí puede.
    const fixed = await asUser(adminId, (c) => c.query("select public.correct_attendance($1, now() - interval '9 hours 30 minutes', now() - interval '2 hours', 'Ajuste de administración') as r", [sessionId]));
    expect(fixed.rows[0].r.result).toBe("corrected");
  });

  it("nadie revisa su propia solicitud de corrección", async () => {
    // Otro día distinto del caso anterior para no traslaparse con su registro.
    const shiftId = await createShiftSuper(facilityA, -1800, -1300);
    const assignmentId = await assignSuper(shiftId, coordWorker);
    const req = await asUser(coordA, (c) =>
      c.query("select * from public.request_correction($1, null, now() - interval '29 hours', now() - interval '23 hours', 'No pude registrar')", [assignmentId]),
    );
    expect(await expectPgError(asUser(coordA, (c) => c.query("select * from public.review_correction($1, true, 'Autoaprobada')", [req.rows[0].id])))).toMatch(/solicitud que tú hiciste|propia asistencia/);
    const ok = await asUser(coordA2, (c) => c.query("select * from public.review_correction($1, true, 'Confirmado')", [req.rows[0].id]));
    expect(ok.rows[0].status).toBe("aprobada");
  });

  it("las horas manuales deben estar dentro de la guardia (±12 h) y la guardia no puede estar cancelada", async () => {
    const shiftId = await createShiftSuper(facilityA, -600, -60);
    const assignmentId = await assignSuper(shiftId, await createWorkerSuper(facilityA));
    const far = await expectPgError(
      asUser(coordA2, (c) =>
        c.query("select public.add_manual_attendance($1, now() - interval '40 days', now() - interval '39 days', 'Fuera de rango', $2)", [assignmentId, uid()]),
      ),
    );
    expect(far).toMatch(/dentro del horario de la guardia/);
    await asSuper((c) => c.query("update public.shifts set status = 'cancelada', cancel_reason = 'Prueba' where id = $1", [shiftId]));
    const cancelled = await expectPgError(
      asUser(coordA2, (c) =>
        c.query("select public.add_manual_attendance($1, now() - interval '9 hours', now() - interval '2 hours', 'Guardia cancelada', $2)", [assignmentId, uid()]),
      ),
    );
    expect(cancelled).toMatch(/cancelada/);
  });
});

describe("Salida inventada", () => {
  it("coordinación tampoco cierra con la hora actual una entrada abierta fuera del margen", async () => {
    const shiftId = await createShiftSuper(facilityA, -60, 30);
    const worker = await createWorkerSuper(facilityA);
    const assignmentId = await assignSuper(shiftId, worker);
    await asUser(coordA2, (c) => c.query("select public.check_in($1, $2, null, 'Registro por coordinación')", [assignmentId, uid()]));
    await asSuper((c) => c.query("update public.shifts set starts_at = now() - interval '10 hours', ends_at = now() - interval '5 hours' where id = $1", [shiftId]));
    const msg = await expectPgError(asUser(coordA2, (c) => c.query("select public.check_out($1, $2, null, 'Cierre tardío')", [assignmentId, uid()])));
    expect(msg).toMatch(/requiere revisión/);
  });
});

describe("Alcance de datos", () => {
  it("incident_notes toma la sede de la asignación, no la del cliente", async () => {
    const shiftB = await createShiftSuper(facilityB, -120, 60);
    const assignmentB = await assignSuper(shiftB, await createWorkerSuper(facilityB));
    const msg = await expectPgError(
      asUser(coordA2, (c) =>
        c.query("insert into public.incident_notes (assignment_id, facility_id, incident_type, note) values ($1, $2, 'llegada_tardia', 'Nota ajena')", [assignmentB, facilityA]),
      ),
    );
    expect(msg).toMatch(/row-level security/);
  });

  it("el estado de una asignación no se cambia directamente (solo con la función)", async () => {
    const shiftId = await createShiftSuper(facilityA, -30, 120);
    const assignmentId = await assignSuper(shiftId, await createWorkerSuper(facilityA));
    const msg = await expectPgError(
      asUser(coordA2, (c) => c.query("update public.shift_assignments set status = 'inasistencia_confirmada', status_reason = 'x' where id = $1", [assignmentId])),
    );
    expect(msg).toMatch(/permission denied/);
    const ok = await asUser(coordA2, (c) => c.query("update public.shift_assignments set assigned_point = 'Puerta 2' where id = $1", [assignmentId]));
    expect(ok.rowCount).toBe(1);
  });

  it("coordinación no marca registros como demostración ni falsifica el autor", async () => {
    const worker = await createWorkerSuper(facilityA);
    const msg = await expectPgError(asUser(coordA2, (c) => c.query("update public.workers set is_demo = true where id = $1", [worker])));
    expect(msg).toMatch(/Solo administración/);
    const inserted = await asUser(coordA2, (c) =>
      c.query("insert into public.workers (full_name, state_id, facility_id, is_demo, created_by) values ('Persona protegida', 18, $1, true, $2) returning is_demo, created_by", [facilityA, adminId]),
    );
    expect(inserted.rows[0].is_demo).toBe(false);
    expect(inserted.rows[0].created_by).toBe(coordA2);
  });

  it("no se cambia la sede de una guardia con asignaciones ni su horario si ya hay asistencia", async () => {
    const shiftId = await createShiftSuper(facilityA, -30, 120);
    const assignmentId = await assignSuper(shiftId, await createWorkerSuper(facilityA));
    await grantScope(coordA2, facilityB);
    expect(await expectPgError(asUser(coordA2, (c) => c.query("update public.shifts set facility_id = $1 where id = $2", [facilityB, shiftId])))).toMatch(/cambiar la sede/);
    await asUser(coordA2, (c) => c.query("select public.check_in($1, $2, null, 'Registro por coordinación')", [assignmentId, uid()]));
    expect(await expectPgError(asUser(coordA2, (c) => c.query("update public.shifts set starts_at = starts_at - interval '1 hour' where id = $1", [shiftId])))).toMatch(/horario solo lo puede cambiar administración/);
  });

  it("check_in no entrega la sesión abierta de otra sede", async () => {
    const shiftB = await createShiftSuper(facilityB, -30, 120);
    const shared = await createWorkerSuper(facilityB);
    const assignmentB = await assignSuper(shiftB, shared);
    await asUser(adminId, (c) => c.query("select public.check_in($1, $2, null, 'Registro de prueba')", [assignmentB, uid()]));
    const shiftA = await createShiftSuper(facilityA, -30, 120);
    const assignmentA = await assignSuper(shiftA, shared);
    const coordOnlyA = await createAuthUser({ role: "coordinador" });
    await grantScope(coordOnlyA, facilityA);
    const r = await asUser(coordOnlyA, (c) => c.query("select public.check_in($1, $2, null, 'Sustitución entre sedes') as r", [assignmentA, uid()]));
    expect(r.rows[0].r.result).toBe("open_elsewhere");
    expect(r.rows[0].r.session).toBeNull();
  });

  it("add_manual_attendance no devuelve sesiones de otra asignación por su identificador", async () => {
    const shiftB = await createShiftSuper(facilityB, -600, -60);
    const assignmentB = await assignSuper(shiftB, await createWorkerSuper(facilityB));
    const req = uid();
    await asUser(adminId, (c) => c.query("select public.add_manual_attendance($1, now() - interval '9 hours', now() - interval '2 hours', 'Registro de admin', $2)", [assignmentB, req]));
    const shiftA = await createShiftSuper(facilityA, -600, -60);
    const assignmentA = await assignSuper(shiftA, await createWorkerSuper(facilityA));
    const msg = await expectPgError(
      asUser(coordA2, (c) => c.query("select public.add_manual_attendance($1, now() - interval '9 hours', now() - interval '2 hours', 'Reuso de id', $2)", [assignmentA, req])),
    );
    expect(msg).toMatch(/otra asignación/);
  });

  it("el público no lee servicios no verificados ni siquiera en la tabla", async () => {
    const id = await createFacilitySuper();
    await asSuper((c) => c.query("update public.facilities set services = '{Urgencias}', services_verified = false where id = $1", [id]));
    expect(await expectPgError(asUser(null, (c) => c.query("select services from public.facilities where id = $1", [id])))).toMatch(/permission denied/);
    const r = await asUser(null, (c) => c.query("select public_services from public.facilities where id = $1", [id]));
    expect(r.rows[0].public_services).toEqual([]);
    const v = await asUser(null, (c) => c.query("select services from public.public_facilities where id = $1", [id]));
    expect(v.rows[0].services).toEqual([]);
  });

  it("la vista pública no admite escritura y anon no ejecuta funciones nuevas", async () => {
    expect(await expectPgError(asUser(null, (c) => c.query("delete from public.public_facilities")))).toMatch(/permission denied/);
    const priv = await asSuper((c) =>
      c.query("select has_function_privilege('anon', 'public.check_in(uuid, uuid, text, text)', 'execute') as can"),
    );
    expect(priv.rows[0].can).toBe(false);
  });
});

describe("Caminos alternos de la separación de funciones", () => {
  it("coordinación no se quita de una guardia ni cambia su propia asignación; otra persona sí", async () => {
    const shiftId = await createShiftSuper(facilityA, -3000, -2900);
    const assignmentId = await assignSuper(shiftId, coordWorker);
    expect(await expectPgError(asUser(coordA, (c) => c.query("delete from public.shift_assignments where id = $1", [assignmentId])))).toMatch(/propia asistencia/);
    expect(await expectPgError(asUser(coordA, (c) => c.query("update public.shift_assignments set notes = 'propia' where id = $1", [assignmentId])))).toMatch(/propia asistencia/);
    // Limpiar solo el motivo sí se permite (clearStoredReason).
    const ok = await asUser(coordA, (c) => c.query("update public.shift_assignments set change_reason = null where id = $1", [assignmentId]));
    expect(ok.rowCount).toBe(1);
    const other = await asUser(coordA2, (c) => c.query("update public.shift_assignments set notes = 'Revisado' where id = $1", [assignmentId]));
    expect(other.rowCount).toBe(1);
  });

  it("coordinación no cancela, reprograma ni borra una guardia en la que está asignada", async () => {
    const shiftId = await createShiftSuper(facilityA, 3000, 3100);
    await assignSuper(shiftId, coordWorker);
    expect(await expectPgError(asUser(coordA, (c) => c.query("update public.shifts set status = 'cancelada', cancel_reason = 'Propia' where id = $1", [shiftId])))).toMatch(/estás asignado/);
    expect(await expectPgError(asUser(coordA, (c) => c.query("update public.shifts set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = $1", [shiftId])))).toMatch(/estás asignado/);
    expect(await expectPgError(asUser(coordA, (c) => c.query("delete from public.shifts where id = $1", [shiftId])))).toMatch(/propia asistencia/);
    const ok = await asUser(coordA2, (c) => c.query("update public.shifts set status = 'cancelada', cancel_reason = 'Reprogramación general' where id = $1", [shiftId]));
    expect(ok.rowCount).toBe(1);
  });

  it("no se cancela una guardia con asistencia vigente", async () => {
    const shiftId = await createShiftSuper(facilityA, -30, 120);
    const assignmentId = await assignSuper(shiftId, await createWorkerSuper(facilityA));
    await asUser(coordA2, (c) => c.query("select public.check_in($1, $2, null, 'Registro por coordinación')", [assignmentId, uid()]));
    expect(await expectPgError(asUser(coordA2, (c) => c.query("update public.shifts set status = 'cancelada', cancel_reason = 'Cancelación' where id = $1", [shiftId])))).toMatch(/registros de asistencia vigentes/);
  });

  it("coordinación no borra justificaciones de su propia asistencia", async () => {
    const shiftId = await createShiftSuper(facilityA, -4000, -3900);
    const assignmentId = await assignSuper(shiftId, coordWorker);
    await asUser(adminId, (c) => c.query("insert into public.incident_notes (assignment_id, facility_id, incident_type, note) values ($1, $2, 'llegada_tardia', 'Nota de admin')", [assignmentId, facilityA]));
    expect(await expectPgError(asUser(coordA, (c) => c.query("delete from public.incident_notes where assignment_id = $1", [assignmentId])))).toMatch(/propia asistencia/);
  });

  it("las funciones nuevas no quedan ejecutables por anon", async () => {
    await asSuper(async (c) => {
      await c.query("begin");
      await c.query("create function public.zz_prueba_privilegios() returns int language sql as 'select 1'");
      const r = await c.query("select has_function_privilege('anon', 'public.zz_prueba_privilegios()', 'execute') as can");
      await c.query("rollback");
      expect(r.rows[0].can).toBe(false);
    });
  });
});

describe("Catálogo nacional", () => {
  it("incluye los municipios de las 32 entidades con nombres INEGI", async () => {
    const r = await asSuper((c) => c.query("select count(*)::int as n, count(distinct state_id)::int as e from public.municipalities"));
    expect(r.rows[0].e).toBe(32);
    expect(r.rows[0].n).toBeGreaterThan(2400);
    const ruiz = await asSuper((c) => c.query("select name from public.municipalities where state_id = 18 and inegi_code = '011'"));
    expect(ruiz.rows[0].name).toBe("Ruiz");
  });
});
