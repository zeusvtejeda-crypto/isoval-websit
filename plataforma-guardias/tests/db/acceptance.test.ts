/**
 * Criterios de aceptación verificados contra la base de datos real
 * (Supabase local: migraciones, RLS, triggers y funciones).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asSuper,
  asUser,
  assignSuper,
  categoryId,
  createAuthUser,
  createFacilitySuper,
  createShiftSuper,
  createWorkerSuper,
  expectPgError,
  grantScope,
  municipalityId,
  pool,
  suffix,
  uid,
} from "./helpers";

let adminId: string;
let facilityA: string;
let facilityB: string;
let coordA: string; // coordinador de la sede A
let auditorA: string;
let workerA1: string;
let workerA2: string;
let workerB1: string;
let userA1: string; // cuenta del trabajador A1
let userA2: string;

beforeAll(async () => {
  adminId = await createAuthUser({ role: "admin" });
  facilityA = await createFacilitySuper();
  facilityB = await createFacilitySuper();
  coordA = await createAuthUser({ role: "coordinador" });
  await grantScope(coordA, facilityA);
  auditorA = await createAuthUser({ role: "auditor" });
  await grantScope(auditorA, facilityA);
  workerA1 = await createWorkerSuper(facilityA);
  workerA2 = await createWorkerSuper(facilityA);
  workerB1 = await createWorkerSuper(facilityB);
  userA1 = await createAuthUser({ role: "trabajador", workerId: workerA1 });
  userA2 = await createAuthUser({ role: "trabajador", workerId: workerA2 });
  await asSuper((c) =>
    c.query("insert into public.worker_private (worker_id, employee_number, phone) values ($1, $2, '311 555 0101'), ($3, $4, '311 555 0202')", [
      workerA1,
      `E-${suffix()}`,
      workerA2,
      `E-${suffix()}`,
    ]),
  );
});

afterAll(async () => {
  await pool.end();
});

describe("1. Crear una instalación y encontrarla en mapa y lista", () => {
  it("administración crea la instalación y aparece en el directorio público", async () => {
    const name = `Unidad creada en prueba ${suffix()}`;
    const cat = await categoryId("hospitales");
    const mun = await municipalityId("017");
    const created = await asUser(adminId, (c) =>
      c.query(
        `insert into public.facilities (official_name, category_id, state_id, municipality_id, latitude, longitude, address, source)
         values ($1, $2, 18, $3, 21.51, -104.89, 'Calle de prueba 1', 'Prueba') returning id, internal_code`,
        [name, cat, mun],
      ),
    );
    expect(created.rows[0].internal_code).toMatch(/^INS-\d{6}$/);

    // Lista y mapa leen la misma vista pública (el mapa usa latitud/longitud).
    const publicRows = await asUser(null, (c) =>
      c.query("select id, official_name, latitude, longitude from public.public_facilities where official_name = $1", [name]),
    );
    expect(publicRows.rowCount).toBe(1);
    expect(publicRows.rows[0].latitude).toBeCloseTo(21.51);

    const search = await asUser(null, (c) =>
      c.query("select id from public.public_facilities where official_name ilike $1", [`%${name.slice(-8)}%`]),
    );
    expect(search.rowCount).toBe(1);
  });

  it("un coordinador o trabajador no puede crear instalaciones", async () => {
    const cat = await categoryId();
    const msg = await expectPgError(
      asUser(coordA, (c) =>
        c.query("insert into public.facilities (official_name, category_id, state_id) values ($1, $2, 18)", [`No permitida ${suffix()}`, cat]),
      ),
    );
    expect(msg).toMatch(/row-level security/);
  });

  it("detecta duplicados por nombre normalizado en el mismo municipio", async () => {
    const cat = await categoryId();
    const mun = await municipalityId("008");
    const name = `Clínica Duplicada ${suffix()}`;
    await asUser(adminId, (c) =>
      c.query("insert into public.facilities (official_name, category_id, state_id, municipality_id) values ($1, $2, 18, $3)", [name, cat, mun]),
    );
    const msg = await expectPgError(
      asUser(adminId, (c) =>
        c.query("insert into public.facilities (official_name, category_id, state_id, municipality_id) values ($1, $2, 18, $3)", [
          `  ${name.toUpperCase().replace("Í", "I")} `,
          cat,
          mun,
        ]),
      ),
    );
    expect(msg).toMatch(/facilities_name_place_uq/);
  });

  it("el directorio público no expone servicios sin verificar ni columnas internas", async () => {
    const id = await createFacilitySuper(`Con servicios ${suffix()}`);
    await asSuper((c) => c.query("update public.facilities set services = '{Urgencias}', services_verified = false where id = $1", [id]));
    const r = await asUser(null, (c) => c.query("select services from public.public_facilities where id = $1", [id]));
    expect(r.rows[0].services).toEqual([]);
    const msg = await expectPgError(asUser(null, (c) => c.query("select created_by from public.facilities limit 1")));
    expect(msg).toMatch(/permission denied/);
  });
});

describe("2. Registrar un trabajador y asignarlo a una sede", () => {
  it("coordinación registra un trabajador en su sede; no en sedes ajenas", async () => {
    const r = await asUser(coordA, (c) =>
      c.query("insert into public.workers (full_name, state_id, facility_id, area) values ($1, 18, $2, 'Enfermería') returning id, internal_code", [
        `Nueva Persona ${suffix()}`,
        facilityA,
      ]),
    );
    expect(r.rows[0].internal_code).toMatch(/^TRA-\d{6}$/);
    const visible = await asUser(coordA, (c) => c.query("select facility_id from public.workers where id = $1", [r.rows[0].id]));
    expect(visible.rows[0].facility_id).toBe(facilityA);

    const msg = await expectPgError(
      asUser(coordA, (c) =>
        c.query("insert into public.workers (full_name, state_id, facility_id) values ($1, 18, $2)", [`Ajena ${suffix()}`, facilityB]),
      ),
    );
    expect(msg).toMatch(/row-level security/);
  });

  it("un trabajador puede existir sin cuenta de acceso", async () => {
    const w = await createWorkerSuper(facilityA);
    const r = await asSuper((c) => c.query("select count(*)::int as n from public.profiles where worker_id = $1", [w]));
    expect(r.rows[0].n).toBe(0);
  });
});

describe("3. Crear una guardia y asignar trabajadores", () => {
  it("coordinación crea guardia y asigna; respeta el cupo máximo", async () => {
    const shift = await asUser(coordA, (c) =>
      c.query(
        `insert into public.shifts (facility_id, meeting_point, starts_at, ends_at, min_staff, max_staff, responsible_worker_id)
         values ($1, $2, now() + interval '1 day', now() + interval '1 day 6 hours', 1, 2, $3) returning id`,
        [facilityA, `Acceso ${suffix()}`, workerA1],
      ),
    );
    const shiftId = shift.rows[0].id;
    await asUser(coordA, (c) =>
      c.query("insert into public.shift_assignments (shift_id, worker_id) values ($1, $2), ($1, $3)", [shiftId, workerA1, workerA2]),
    );
    const extra = await createWorkerSuper(facilityA);
    const msg = await expectPgError(
      asUser(coordA, (c) => c.query("insert into public.shift_assignments (shift_id, worker_id) values ($1, $2)", [shiftId, extra])),
    );
    expect(msg).toMatch(/cupo máximo/);

    const dup = await expectPgError(
      asUser(coordA, (c) => c.query("insert into public.shift_assignments (shift_id, worker_id) values ($1, $2)", [shiftId, workerA1])),
    );
    expect(dup).toMatch(/shift_assignments_unique|cupo/);
  });

  it("rechaza guardias con término anterior al inicio", async () => {
    const msg = await expectPgError(
      asUser(coordA, (c) =>
        c.query("insert into public.shifts (facility_id, meeting_point, starts_at, ends_at) values ($1, 'X1', now(), now() - interval '1 hour')", [facilityA]),
      ),
    );
    expect(msg).toMatch(/shifts_time_order/);
  });
});

describe("4–5. Registrar entrada y salida", () => {
  it("la entrada usa la hora del servidor, aparece como en servicio y la salida cierra la sesión", async () => {
    const shiftId = await createShiftSuper(facilityA, -30, 300);
    const assignmentId = await assignSuper(shiftId, workerA1);
    const req = uid();
    const res = await asUser(userA1, (c) => c.query("select public.check_in($1, $2) as r", [assignmentId, req]));
    const r = res.rows[0].r;
    expect(r.result).toBe("created");
    expect(r.session.check_in_method).toBe("propio");

    // "En servicio": sesión abierta visible para coordinación de la sede.
    const open = await asUser(coordA, (c) =>
      c.query("select worker_id from public.attendance_sessions where facility_id = $1 and check_out_at is null and record_status = 'vigente'", [facilityA]),
    );
    expect(open.rows.map((x) => x.worker_id)).toContain(workerA1);

    const out = await asUser(userA1, (c) => c.query("select public.check_out($1, $2) as r", [assignmentId, uid()]));
    expect(out.rows[0].r.result).toBe("created");
    const hist = await asUser(userA1, (c) =>
      c.query("select check_in_at, check_out_at from public.attendance_sessions where assignment_id = $1", [assignmentId]),
    );
    expect(hist.rowCount).toBe(1);
    expect(new Date(hist.rows[0].check_out_at).getTime()).toBeGreaterThan(new Date(hist.rows[0].check_in_at).getTime());
  });

  it("no se escriben asistencias directamente (solo por funciones)", async () => {
    const shiftId = await createShiftSuper(facilityA, -10, 60);
    const assignmentId = await assignSuper(shiftId, workerA2);
    const msg = await expectPgError(
      asUser(userA2, (c) =>
        c.query(
          `insert into public.attendance_sessions (assignment_id, shift_id, worker_id, facility_id, check_in_at, check_in_method, check_in_by, check_in_request_id)
           values ($1, $2, $3, $4, now() - interval '3 hours', 'propio', $5, gen_random_uuid())`,
          [assignmentId, shiftId, workerA2, facilityA, userA2],
        ),
      ),
    );
    expect(msg).toMatch(/permission denied/);
  });

  it("coordinación registra por otra persona solo con motivo, y queda quién lo hizo", async () => {
    const shiftId = await createShiftSuper(facilityA, -15, 120);
    const worker = await createWorkerSuper(facilityA);
    const assignmentId = await assignSuper(shiftId, worker);
    const noReason = await expectPgError(asUser(coordA, (c) => c.query("select public.check_in($1, $2)", [assignmentId, uid()])));
    expect(noReason).toMatch(/motivo/);
    const res = await asUser(coordA, (c) =>
      c.query("select public.check_in($1, $2, null, 'Sin batería en su teléfono') as r", [assignmentId, uid()]),
    );
    expect(res.rows[0].r.session.check_in_method).toBe("coordinador");
    expect(res.rows[0].r.session.check_in_by).toBe(coordA);
    expect(res.rows[0].r.session.check_in_reason).toBe("Sin batería en su teléfono");
  });
});

describe("6. Guardia que cruza medianoche", () => {
  it("permite entrada/salida en una guardia de 24 h que siempre cruza una medianoche local", async () => {
    const shiftId = await createShiftSuper(facilityA, -23 * 60, 60);
    const crosses = await asSuper((c) =>
      c.query(
        `select (starts_at at time zone 'America/Mazatlan')::date <> (ends_at at time zone 'America/Mazatlan')::date as crosses
         from public.shifts where id = $1`,
        [shiftId],
      ),
    );
    expect(crosses.rows[0].crosses).toBe(true);
    const worker = await createWorkerSuper(facilityA);
    const assignmentId = await assignSuper(shiftId, worker);
    const r = await asUser(coordA, (c) => c.query("select public.check_in($1, $2, null, 'Prueba nocturna') as r", [assignmentId, uid()]));
    expect(r.rows[0].r.result).toBe("created");
    const o = await asUser(coordA, (c) => c.query("select public.check_out($1, $2, null, 'Prueba nocturna') as r", [assignmentId, uid()]));
    expect(o.rows[0].r.result).toBe("created");
  });

  it("guarda una sesión 22:00–06:00 (hora de la sede) sin perder el cruce de día", async () => {
    const shift = await asSuper((c) =>
      c.query(
        `insert into public.shifts (facility_id, meeting_point, starts_at, ends_at)
         values ($1, $2,
           ((now() at time zone 'America/Mazatlan')::date - 2 + time '22:00') at time zone 'America/Mazatlan',
           ((now() at time zone 'America/Mazatlan')::date - 1 + time '06:00') at time zone 'America/Mazatlan')
         returning id, starts_at, ends_at`,
        [facilityA, `Nocturna ${suffix()}`],
      ),
    );
    const { id, starts_at, ends_at } = shift.rows[0];
    expect((new Date(ends_at).getTime() - new Date(starts_at).getTime()) / 3_600_000).toBe(8);
    const worker = await createWorkerSuper(facilityA);
    const assignmentId = await assignSuper(id, worker);
    const r = await asUser(coordA, (c) =>
      c.query("select public.add_manual_attendance($1, $2, $3, 'Registro posterior de guardia nocturna', $4) as r", [
        assignmentId,
        starts_at,
        ends_at,
        uid(),
      ]),
    );
    expect(r.rows[0].r.result).toBe("created");
  });
});

describe("7. Salida y regreso", () => {
  it("permite varias sesiones en la misma guardia sin traslapes", async () => {
    const shiftId = await createShiftSuper(facilityA, -60, 240);
    const worker = await createWorkerSuper(facilityA);
    const assignmentId = await assignSuper(shiftId, worker);
    const reason = "Prueba de salida y regreso";
    await asUser(coordA, (c) => c.query("select public.check_in($1, $2, null, $3)", [assignmentId, uid(), reason]));
    await asUser(coordA, (c) => c.query("select public.check_out($1, $2, null, $3)", [assignmentId, uid(), reason]));
    const back = await asUser(coordA, (c) => c.query("select public.check_in($1, $2, null, $3) as r", [assignmentId, uid(), reason]));
    expect(back.rows[0].r.result).toBe("created");
    const rows = await asSuper((c) =>
      c.query("select count(*)::int as n from public.attendance_sessions where assignment_id = $1 and record_status = 'vigente'", [assignmentId]),
    );
    expect(rows.rows[0].n).toBe(2);
  });

  it("rechaza registros manuales que se traslapan", async () => {
    const shiftId = await createShiftSuper(facilityA, -600, -60);
    const worker = await createWorkerSuper(facilityA);
    const assignmentId = await assignSuper(shiftId, worker);
    await asUser(coordA, (c) =>
      c.query("select public.add_manual_attendance($1, now() - interval '9 hours', now() - interval '5 hours', 'Registro posterior uno', $2)", [assignmentId, uid()]),
    );
    const msg = await expectPgError(
      asUser(coordA, (c) =>
        c.query("select public.add_manual_attendance($1, now() - interval '6 hours', now() - interval '2 hours', 'Registro posterior dos', $2)", [assignmentId, uid()]),
      ),
    );
    expect(msg).toMatch(/traslapa/);
  });
});

describe("8. Entrada sin salida", () => {
  it("una entrada abierta de una guardia terminada no se cierra con la hora actual por el trabajador", async () => {
    const shiftId = await createShiftSuper(facilityA, -60, 30);
    const assignmentId = await assignSuper(shiftId, workerA2);
    await asUser(userA2, (c) => c.query("select public.check_in($1, $2)", [assignmentId, uid()]));
    // Simula que la guardia terminó hace más del margen (240 min por omisión).
    await asSuper((c) =>
      c.query("update public.shifts set starts_at = now() - interval '10 hours', ends_at = now() - interval '5 hours' where id = $1", [shiftId]),
    );
    const msg = await expectPgError(asUser(userA2, (c) => c.query("select public.check_out($1, $2)", [assignmentId, uid()])));
    expect(msg).toMatch(/requiere revisión/);
    const open = await asSuper((c) =>
      c.query("select check_out_at from public.attendance_sessions where assignment_id = $1", [assignmentId]),
    );
    expect(open.rows[0].check_out_at).toBeNull(); // no se inventa salida
    // Limpieza: coordinación corrige con hora explícita (deja libre al trabajador para otras pruebas).
    const sess = await asSuper((c) => c.query("select id, check_in_at from public.attendance_sessions where assignment_id = $1", [assignmentId]));
    await asUser(coordA, (c) =>
      c.query("select public.correct_attendance($1, now() - interval '9 hours', now() - interval '5 hours', 'Cierre tras revisión de coordinación')", [
        sess.rows[0].id,
      ]),
    );
  });
});

describe("9. Duplicados por doble clic o reintento", () => {
  it("la misma solicitud devuelve el mismo registro; otra solicitud no duplica la entrada", async () => {
    const shiftId = await createShiftSuper(facilityA, -5, 120);
    const worker = await createWorkerSuper(facilityA);
    const user = await createAuthUser({ role: "trabajador", workerId: worker });
    const assignmentId = await assignSuper(shiftId, worker);
    const req = uid();
    const first = await asUser(user, (c) => c.query("select public.check_in($1, $2) as r", [assignmentId, req]));
    const retry = await asUser(user, (c) => c.query("select public.check_in($1, $2) as r", [assignmentId, req]));
    const second = await asUser(user, (c) => c.query("select public.check_in($1, $2) as r", [assignmentId, uid()]));
    expect(first.rows[0].r.result).toBe("created");
    expect(retry.rows[0].r.result).toBe("duplicate");
    expect(retry.rows[0].r.session.id).toBe(first.rows[0].r.session.id);
    expect(second.rows[0].r.result).toBe("already_open");
    const n = await asSuper((c) => c.query("select count(*)::int as n from public.attendance_sessions where assignment_id = $1", [assignmentId]));
    expect(n.rows[0].n).toBe(1);
  });

  it("solicitudes simultáneas producen una sola entrada", async () => {
    const shiftId = await createShiftSuper(facilityA, -5, 120);
    const worker = await createWorkerSuper(facilityA);
    const user = await createAuthUser({ role: "trabajador", workerId: worker });
    const assignmentId = await assignSuper(shiftId, worker);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => asUser(user, (c) => c.query("select public.check_in($1, $2) as r", [assignmentId, uid()]))),
    );
    const kinds = results.map((r) => r.rows[0].r.result).sort();
    expect(kinds.filter((k) => k === "created")).toHaveLength(1);
    const n = await asSuper((c) => c.query("select count(*)::int as n from public.attendance_sessions where assignment_id = $1", [assignmentId]));
    expect(n.rows[0].n).toBe(1);
  });

  it("la salida repetida tampoco duplica", async () => {
    const shiftId = await createShiftSuper(facilityA, -5, 120);
    const worker = await createWorkerSuper(facilityA);
    const user = await createAuthUser({ role: "trabajador", workerId: worker });
    const assignmentId = await assignSuper(shiftId, worker);
    await asUser(user, (c) => c.query("select public.check_in($1, $2)", [assignmentId, uid()]));
    const req = uid();
    const a = await asUser(user, (c) => c.query("select public.check_out($1, $2) as r", [assignmentId, req]));
    const b = await asUser(user, (c) => c.query("select public.check_out($1, $2) as r", [assignmentId, req]));
    const c2 = await asUser(user, (c) => c.query("select public.check_out($1, $2) as r", [assignmentId, uid()]));
    expect(a.rows[0].r.result).toBe("created");
    expect(b.rows[0].r.result).toBe("duplicate");
    expect(c2.rows[0].r.result).toBe("no_open_session");
  });

  it("la base de datos impide una salida anterior a la entrada", async () => {
    const shiftId = await createShiftSuper(facilityA, -600, -60);
    const worker = await createWorkerSuper(facilityA);
    const assignmentId = await assignSuper(shiftId, worker);
    const msg = await expectPgError(
      asUser(coordA, (c) =>
        c.query("select public.add_manual_attendance($1, now() - interval '2 hours', now() - interval '3 hours', 'Prueba de orden', $2)", [assignmentId, uid()]),
      ),
    );
    expect(msg).toMatch(/anterior/);
    const direct = await expectPgError(
      asSuper((c) =>
        c.query(
          `insert into public.attendance_sessions (assignment_id, shift_id, worker_id, facility_id, check_in_at, check_out_at, check_in_method, check_out_method, check_in_by, check_out_by, check_in_request_id)
           values ($1, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now(), now() - interval '1 hour', 'propio', 'propio', gen_random_uuid(), gen_random_uuid(), gen_random_uuid())`,
          [assignmentId],
        ),
      ),
    );
    expect(direct).toMatch(/attendance_out_after_in/);
  });
});

describe("10. Corregir conservando la auditoría", () => {
  it("la corrección crea una versión nueva, conserva la original y registra autor y motivo", async () => {
    const shiftId = await createShiftSuper(facilityA, -600, -60);
    const worker = await createWorkerSuper(facilityA);
    const assignmentId = await assignSuper(shiftId, worker);
    const created = await asUser(coordA, (c) =>
      c.query("select public.add_manual_attendance($1, now() - interval '9 hours', now() - interval '4 hours', 'Registro posterior', $2) as r", [assignmentId, uid()]),
    );
    const originalId = created.rows[0].r.session.id;
    const reason = "Hora de entrada mal capturada";
    const corrected = await asUser(coordA, (c) =>
      c.query("select public.correct_attendance($1, now() - interval '10 hours', now() - interval '4 hours', $2) as r", [originalId, reason]),
    );
    const newId = corrected.rows[0].r.session.id;
    expect(corrected.rows[0].r.session.supersedes_id).toBe(originalId);

    const rows = await asSuper((c) =>
      c.query("select id, record_status, status_reason, status_changed_by from public.attendance_sessions where id in ($1, $2)", [originalId, newId]),
    );
    const orig = rows.rows.find((r) => r.id === originalId);
    expect(orig.record_status).toBe("corregido");
    expect(orig.status_reason).toBe(reason);
    expect(orig.status_changed_by).toBe(coordA);
    expect(rows.rows.find((r) => r.id === newId).record_status).toBe("vigente");

    const audit = await asUser(coordA, (c) =>
      c.query("select action, actor_id, reason, old_data, new_data from public.audit_log where table_name = 'attendance_sessions' and record_id = $1 order by id", [originalId]),
    );
    const update = audit.rows.find((a) => a.action === "UPDATE");
    expect(update.actor_id).toBe(coordA);
    expect(update.reason).toBe(reason);
    expect(update.old_data.record_status).toBe("vigente");
    expect(update.new_data.record_status).toBe("corregido");
  });

  it("nadie puede editar ni borrar el registro original, ni la bitácora", async () => {
    const shiftId = await createShiftSuper(facilityA, -600, -60);
    const worker = await createWorkerSuper(facilityA);
    const assignmentId = await assignSuper(shiftId, worker);
    const created = await asUser(coordA, (c) =>
      c.query("select public.add_manual_attendance($1, now() - interval '9 hours', now() - interval '4 hours', 'Registro posterior', $2) as r", [assignmentId, uid()]),
    );
    const id = created.rows[0].r.session.id;
    expect(await expectPgError(asUser(adminId, (c) => c.query("update public.attendance_sessions set check_in_at = now() - interval '11 hours' where id = $1", [id])))).toMatch(/permission denied/);
    expect(await expectPgError(asUser(adminId, (c) => c.query("delete from public.attendance_sessions where id = $1", [id])))).toMatch(/permission denied/);
    // Incluso como superusuario los triggers lo impiden.
    expect(await expectPgError(asSuper((c) => c.query("update public.attendance_sessions set check_in_at = now() - interval '11 hours' where id = $1", [id])))).toMatch(/no se modifica/);
    expect(await expectPgError(asSuper((c) => c.query("delete from public.attendance_sessions where id = $1", [id])))).toMatch(/no se eliminan/);
    expect(await expectPgError(asSuper((c) => c.query("update public.audit_log set reason = 'x' where id = (select max(id) from public.audit_log)")))).toMatch(/no se modifica/);
    expect(await expectPgError(asUser(adminId, (c) => c.query("delete from public.audit_log")))).toMatch(/permission denied/);
  });

  it("el trabajador solicita una corrección y coordinación la aprueba", async () => {
    const shiftId = await createShiftSuper(facilityA, -600, -60);
    const worker = await createWorkerSuper(facilityA);
    const user = await createAuthUser({ role: "trabajador", workerId: worker });
    const assignmentId = await assignSuper(shiftId, worker);
    const req = await asUser(user, (c) =>
      c.query("select * from public.request_correction($1, null, now() - interval '9 hours', now() - interval '2 hours', 'Olvidé registrar mi entrada')", [assignmentId]),
    );
    expect(req.rows[0].status).toBe("pendiente");
    const reviewed = await asUser(coordA, (c) => c.query("select * from public.review_correction($1, true, 'Confirmado con responsable')", [req.rows[0].id]));
    expect(reviewed.rows[0].status).toBe("aprobada");
    expect(reviewed.rows[0].resulting_session_id).toBeTruthy();
    const otherWorker = await createAuthUser({ role: "trabajador", workerId: await createWorkerSuper(facilityA) });
    const denied = await expectPgError(
      asUser(otherWorker, (c) => c.query("select * from public.request_correction($1, null, now() - interval '3 hours', null, 'Intento ajeno')", [assignmentId])),
    );
    expect(denied).toMatch(/propios registros/);
  });
});

describe("11. Un trabajador no ve datos privados de otros", () => {
  it("solo ve su registro, sus datos privados, sus asignaciones y sus asistencias", async () => {
    const workers = await asUser(userA1, (c) => c.query("select id from public.workers"));
    expect(workers.rows.map((r) => r.id)).toEqual([workerA1]);
    const priv = await asUser(userA1, (c) => c.query("select worker_id from public.worker_private"));
    expect(priv.rows.map((r) => r.worker_id)).toEqual([workerA1]);
    const assignments = await asUser(userA1, (c) => c.query("select distinct worker_id from public.shift_assignments"));
    expect(assignments.rows.every((r) => r.worker_id === workerA1)).toBe(true);
    const sessions = await asUser(userA1, (c) => c.query("select distinct worker_id from public.attendance_sessions"));
    expect(sessions.rows.every((r) => r.worker_id === workerA1)).toBe(true);
    const profiles = await asUser(userA1, (c) => c.query("select id from public.profiles"));
    expect(profiles.rows.map((r) => r.id)).toEqual([userA1]);
    const audit = await asUser(userA1, (c) => c.query("select count(*)::int as n from public.audit_log"));
    expect(audit.rows[0].n).toBe(0);
  });

  it("no puede registrar asistencia de otra persona ni cambiar su propio rol", async () => {
    const shiftId = await createShiftSuper(facilityA, -5, 120);
    const assignmentOther = await assignSuper(shiftId, await createWorkerSuper(facilityA));
    const msg = await expectPgError(asUser(userA1, (c) => c.query("select public.check_in($1, $2, null, 'Intento')", [assignmentOther, uid()])));
    expect(msg).toMatch(/permiso/);
    const upd = await asUser(userA1, (c) => c.query("update public.profiles set role = 'admin' where id = $1", [userA1]));
    expect(upd.rowCount).toBe(0);
    const role = await asSuper((c) => c.query("select role from public.profiles where id = $1", [userA1]));
    expect(role.rows[0].role).toBe("trabajador");
  });

  it("el público anónimo no ve trabajadores, guardias ni asistencias", async () => {
    for (const table of ["workers", "worker_private", "shifts", "shift_assignments", "attendance_sessions", "audit_log", "profiles"]) {
      const msg = await expectPgError(asUser(null, (c) => c.query(`select * from public.${table} limit 1`)));
      expect(msg).toMatch(/permission denied/);
    }
  });

  it("auditoría no ve teléfonos ni números de trabajador", async () => {
    const r = await asUser(auditorA, (c) => c.query("select * from public.worker_private"));
    expect(r.rowCount).toBe(0);
    const w = await asUser(auditorA, (c) => c.query("select id from public.workers where facility_id = $1", [facilityA]));
    expect(w.rowCount).toBeGreaterThan(0);
  });
});

describe("12. Un coordinador no accede a sedes ajenas", () => {
  it("no ve trabajadores, guardias ni asistencias de otra sede", async () => {
    const shiftB = await createShiftSuper(facilityB, -30, 120);
    const assignmentB = await assignSuper(shiftB, workerB1);
    await asUser(adminId, (c) => c.query("select public.check_in($1, $2, null, 'Registro de prueba') ", [assignmentB, uid()]));

    const w = await asUser(coordA, (c) => c.query("select id from public.workers where id = $1", [workerB1]));
    expect(w.rowCount).toBe(0);
    const s = await asUser(coordA, (c) => c.query("select id from public.shifts where facility_id = $1", [facilityB]));
    expect(s.rowCount).toBe(0);
    const a = await asUser(coordA, (c) => c.query("select id from public.attendance_sessions where facility_id = $1", [facilityB]));
    expect(a.rowCount).toBe(0);
    const audit = await asUser(coordA, (c) => c.query("select id from public.audit_log where facility_id = $1", [facilityB]));
    expect(audit.rowCount).toBe(0);
  });

  it("no puede crear guardias, registrar asistencia ni corregir en otra sede", async () => {
    const msg1 = await expectPgError(
      asUser(coordA, (c) =>
        c.query("insert into public.shifts (facility_id, meeting_point, starts_at, ends_at) values ($1, 'Ajeno', now(), now() + interval '1 hour')", [facilityB]),
      ),
    );
    expect(msg1).toMatch(/row-level security/);

    const shiftB = await createShiftSuper(facilityB, -10, 120);
    const assignmentB = await assignSuper(shiftB, await createWorkerSuper(facilityB));
    const msg2 = await expectPgError(asUser(coordA, (c) => c.query("select public.check_in($1, $2, null, 'Intento ajeno')", [assignmentB, uid()])));
    expect(msg2).toMatch(/permiso/);

    const created = await asUser(adminId, (c) =>
      c.query("select public.add_manual_attendance($1, now() - interval '3 hours', now() - interval '2 hours', 'Registro admin', $2) as r", [assignmentB, uid()]),
    );
    const msg3 = await expectPgError(
      asUser(coordA, (c) =>
        c.query("select public.correct_attendance($1, now() - interval '4 hours', now() - interval '2 hours', 'Intento ajeno')", [created.rows[0].r.session.id]),
      ),
    );
    expect(msg3).toMatch(/permiso/);

    const upd = await asUser(coordA, (c) => c.query("update public.shifts set meeting_point = 'Hackeado' where id = $1", [shiftB]));
    expect(upd.rowCount).toBe(0);
  });

  it("no puede asignarse sedes ni cambiar roles", async () => {
    const msg = await expectPgError(
      asUser(coordA, (c) => c.query("insert into public.user_facility_scopes (user_id, facility_id) values ($1, $2)", [coordA, facilityB])),
    );
    expect(msg).toMatch(/row-level security/);
  });
});

describe("Integridad adicional", () => {
  it("debe existir al menos un administrador activo", async () => {
    // Si este administrador es el único, el trigger impide desactivarlo.
    const admins = await asSuper((c) => c.query("select count(*)::int as n from public.profiles where role = 'admin' and active"));
    if (admins.rows[0].n === 1) {
      const msg = await expectPgError(asUser(adminId, (c) => c.query("update public.profiles set active = false where id = $1", [adminId])));
      expect(msg).toMatch(/al menos un administrador/);
    } else {
      expect(admins.rows[0].n).toBeGreaterThan(1);
    }
  });

  it("la inasistencia solo se confirma tras terminar la guardia y con motivo", async () => {
    const shiftId = await createShiftSuper(facilityA, -30, 60);
    const assignmentId = await assignSuper(shiftId, await createWorkerSuper(facilityA));
    const early = await expectPgError(
      asUser(coordA, (c) => c.query("select public.set_assignment_status($1, 'inasistencia_confirmada', 'No se presentó')", [assignmentId])),
    );
    expect(early).toMatch(/después de que termina/);
    const just = await asUser(coordA, (c) =>
      c.query("select * from public.set_assignment_status($1, 'ausencia_justificada', 'Incapacidad notificada')", [assignmentId]),
    );
    expect(just.rows[0].status).toBe("ausencia_justificada");
  });

  it("get_my_assignments solo devuelve las asignaciones propias", async () => {
    const shiftId = await createShiftSuper(facilityA, 60, 300);
    await assignSuper(shiftId, workerA1);
    await assignSuper(shiftId, workerA2);
    const r = await asUser(userA1, (c) =>
      c.query("select * from public.get_my_assignments(now() - interval '1 day', now() + interval '2 days') where shift_id = $1", [shiftId]),
    );
    expect(r.rowCount).toBe(1);
  });
});
