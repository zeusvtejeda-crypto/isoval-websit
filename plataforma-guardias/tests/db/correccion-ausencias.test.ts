/**
 * Solicitudes de corrección sobre una ausencia justificada o una inasistencia
 * confirmada: la persona solicita un registro nuevo con sus horas reales y, al
 * aprobarse, la asignación vuelve a «Asignado» en la misma transacción.
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

let facility: string;
let coordA: string;
let coordB: string; // otra persona de coordinación en la misma sede
let coordWorker: string; // coordB también es trabajadora

beforeAll(async () => {
  facility = await createFacilitySuper();
  coordA = await createAuthUser({ role: "coordinador" });
  await grantScope(coordA, facility);
  coordWorker = await createWorkerSuper(facility);
  coordB = await createAuthUser({ role: "coordinador", workerId: coordWorker });
  await grantScope(coordB, facility);
});

afterAll(async () => {
  await pool.end();
});

/** Guardia terminada (hace 10 h a hace 1 h) con la asignación ya marcada con el estado indicado. */
async function absentAssignment(
  status: "inasistencia_confirmada" | "ausencia_justificada",
  workerId?: string,
  extra: { maxStaff?: number | null } = {},
) {
  const worker = workerId ?? (await createWorkerSuper(facility));
  const shiftId = await createShiftSuper(facility, -600, -60, extra);
  const assignmentId = await assignSuper(shiftId, worker);
  await asUser(coordA, (c) =>
    c.query("select public.set_assignment_status($1, $2, $3)", [assignmentId, status, "No se presentó según el responsable"]),
  );
  return { worker, shiftId, assignmentId };
}

async function assignment(id: string) {
  const r = await asSuper((c) => c.query("select status, status_reason, status_changed_by from public.shift_assignments where id = $1", [id]));
  return r.rows[0];
}

const REQUEST_SQL = "select * from public.request_correction($1, null, now() - interval '9 hours', now() - interval '2 hours', $2)";

describe("Corrección de una inasistencia confirmada", () => {
  it("el trabajador la solicita y coordinación la aprueba: vuelve a «Asignado» con registro y bitácora", async () => {
    const { worker, assignmentId } = await absentAssignment("inasistencia_confirmada");
    const user = await createAuthUser({ role: "trabajador", workerId: worker });

    const req = await asUser(user, (c) => c.query(REQUEST_SQL, [assignmentId, "Sí asistí; el responsable no me vio en el acceso"]));
    const requestId = req.rows[0].id;
    expect(req.rows[0].status).toBe("pendiente");
    expect(req.rows[0].session_id).toBeNull();

    // El trabajador no puede aprobarla.
    expect(await expectPgError(asUser(user, (c) => c.query("select * from public.review_correction($1, true, 'Me la apruebo')", [requestId])))).toMatch(
      /permiso/,
    );

    const reviewed = await asUser(coordA, (c) =>
      c.query("select * from public.review_correction($1, true, 'Confirmado con la bitácora del acceso')", [requestId]),
    );
    expect(reviewed.rows[0].status).toBe("aprobada");
    const sessionId = reviewed.rows[0].resulting_session_id;
    expect(sessionId).toBeTruthy();

    const a = await assignment(assignmentId);
    expect(a.status).toBe("asignado");
    expect(a.status_changed_by).toBe(coordA);
    expect(a.status_reason).toContain("Se revierte «Inasistencia confirmada»");
    expect(a.status_reason).toContain("Sí asistí; el responsable no me vio en el acceso");
    expect(a.status_reason).toContain("Revisión: Confirmado con la bitácora del acceso");

    const session = await asSuper((c) =>
      c.query("select assignment_id, record_status, check_in_method, check_out_at, check_in_by from public.attendance_sessions where id = $1", [sessionId]),
    );
    expect(session.rows[0]).toMatchObject({ assignment_id: assignmentId, record_status: "vigente", check_in_method: "correccion", check_in_by: coordA });
    expect(session.rows[0].check_out_at).not.toBeNull();

    // Bitácora: cambio de estado (antes inasistencia, después asignado) con motivo, el registro y la revisión.
    const audit = await asSuper((c) =>
      c.query(
        `select table_name, action, actor_id, reason, changed_fields, old_data ->> 'status' as old_status, new_data ->> 'status' as new_status
           from public.audit_log
          where (table_name = 'shift_assignments' and record_id = $1)
             or (table_name = 'attendance_sessions' and record_id = $2)
             or (table_name = 'correction_requests' and record_id = $3)
          order by id`,
        [assignmentId, sessionId, requestId],
      ),
    );
    const revert = audit.rows.find((r) => r.table_name === "shift_assignments" && r.action === "UPDATE" && r.new_status === "asignado");
    expect(revert).toMatchObject({ actor_id: coordA, old_status: "inasistencia_confirmada" });
    // status_changed_by no cambia: la misma persona registró la inasistencia.
    expect(revert.changed_fields).toEqual(expect.arrayContaining(["status", "status_reason", "status_changed_at"]));
    expect(revert.reason).toContain("Sí asistí; el responsable no me vio en el acceso");
    expect(revert.reason).toContain("Confirmado con la bitácora del acceso");
    const inserted = audit.rows.find((r) => r.table_name === "attendance_sessions" && r.action === "INSERT");
    expect(inserted).toMatchObject({ actor_id: coordA });
    expect(inserted.reason).toMatch(/^Solicitud de corrección aprobada: Sí asistí/);
    const review = audit.rows.find((r) => r.table_name === "correction_requests" && r.action === "UPDATE");
    expect(review).toMatchObject({ actor_id: coordA, new_status: "aprobada" });
    expect(review.reason).toContain("Revisión: Confirmado con la bitácora del acceso");
  });

  it("también se impugna una ausencia justificada; al rechazarla el estado no cambia", async () => {
    const { worker, assignmentId } = await absentAssignment("ausencia_justificada");
    const user = await createAuthUser({ role: "trabajador", workerId: worker });

    const first = await asUser(user, (c) => c.query(REQUEST_SQL, [assignmentId, "Llegué y cubrí el turno completo"]));
    expect(await expectPgError(asUser(coordA, (c) => c.query("select * from public.review_correction($1, false, null)", [first.rows[0].id])))).toMatch(
      /motivo del rechazo/,
    );
    await asUser(coordA, (c) => c.query("select * from public.review_correction($1, false, 'No coincide con la bitácora')", [first.rows[0].id]));
    expect((await assignment(assignmentId)).status).toBe("ausencia_justificada");

    const second = await asUser(user, (c) => c.query(REQUEST_SQL, [assignmentId, "Adjunto el registro del acceso"]));
    await asUser(coordA, (c) => c.query("select * from public.review_correction($1, true, null)", [second.rows[0].id]));
    const a = await assignment(assignmentId);
    expect(a.status).toBe("asignado");
    expect(a.status_reason).toContain("Se revierte «Ausencia justificada»");
    expect(a.status_reason).not.toContain("Revisión:");
  });

  it("separación de funciones: nadie (salvo administración) aprueba lo propio", async () => {
    // Inasistencia de una coordinadora que también es trabajadora.
    const { assignmentId } = await absentAssignment("inasistencia_confirmada", coordWorker);
    const own = await asUser(coordB, (c) => c.query(REQUEST_SQL, [assignmentId, "Sí estuve en mi guardia"]));
    expect(await expectPgError(asUser(coordB, (c) => c.query("select * from public.review_correction($1, true, 'Autoaprobada')", [own.rows[0].id])))).toMatch(
      /solicitud que tú hiciste|propia asistencia/,
    );
    expect((await assignment(assignmentId)).status).toBe("inasistencia_confirmada");

    // Solicitud hecha por coordinación en nombre de otra persona: tampoco la revisa quien la hizo.
    const other = await absentAssignment("inasistencia_confirmada");
    const onBehalf = await asUser(coordA, (c) => c.query(REQUEST_SQL, [other.assignmentId, "Registro en nombre de la persona"]));
    expect(await expectPgError(asUser(coordA, (c) => c.query("select * from public.review_correction($1, true, 'Autoaprobada')", [onBehalf.rows[0].id])))).toMatch(
      /solicitud que tú hiciste/,
    );

    // Otra persona de coordinación sí puede aprobar la de coordB.
    const ok = await asUser(coordA, (c) => c.query("select * from public.review_correction($1, true, 'Revisado por otra persona')", [own.rows[0].id]));
    expect(ok.rows[0].status).toBe("aprobada");
    expect((await assignment(assignmentId)).status).toBe("asignado");
  });

  it("si la aprobación falla no cambia nada (traslape con otro registro vigente)", async () => {
    const { worker, assignmentId } = await absentAssignment("inasistencia_confirmada");
    const user = await createAuthUser({ role: "trabajador", workerId: worker });
    // La persona ya tiene un registro vigente a esa hora en otra guardia.
    const otherShift = await createShiftSuper(facility, -600, -60);
    const otherAssignment = await assignSuper(otherShift, worker);
    await asUser(coordA, (c) =>
      c.query("select public.add_manual_attendance($1, now() - interval '8 hours', now() - interval '3 hours', 'Registro en otra guardia', $2)", [
        otherAssignment,
        uid(),
      ]),
    );
    const req = await asUser(user, (c) => c.query(REQUEST_SQL, [assignmentId, "Estuve en esta guardia"]));
    expect(await expectPgError(asUser(coordB, (c) => c.query("select * from public.review_correction($1, true, null)", [req.rows[0].id])))).toMatch(/traslapa/);
    const a = await assignment(assignmentId);
    expect(a.status).toBe("inasistencia_confirmada");
    expect(a.status_reason).toBe("No se presentó según el responsable");
    const pending = await asSuper((c) => c.query("select status from public.correction_requests where id = $1", [req.rows[0].id]));
    expect(pending.rows[0].status).toBe("pendiente");
  });

  it("si la guardia ya alcanzó su cupo, la ausencia no se revierte", async () => {
    const { worker, shiftId, assignmentId } = await absentAssignment("inasistencia_confirmada", undefined, { maxStaff: 1 });
    const user = await createAuthUser({ role: "trabajador", workerId: worker });
    // Otra persona ocupó el único lugar activo.
    await assignSuper(shiftId, await createWorkerSuper(facility));
    const req = await asUser(user, (c) => c.query(REQUEST_SQL, [assignmentId, "Sí asistí a la guardia"]));
    expect(await expectPgError(asUser(coordA, (c) => c.query("select * from public.review_correction($1, true, null)", [req.rows[0].id])))).toMatch(
      /cupo máximo/,
    );
    expect((await assignment(assignmentId)).status).toBe("inasistencia_confirmada");
  });
});

describe("Solicitudes que nadie podría aprobar", () => {
  it("rechaza guardias o asignaciones canceladas y registros nuevos sin ambas horas", async () => {
    const worker = await createWorkerSuper(facility);
    const user = await createAuthUser({ role: "trabajador", workerId: worker });

    const { assignmentId } = await absentAssignment("inasistencia_confirmada", worker);
    expect(
      await expectPgError(
        asUser(user, (c) => c.query("select * from public.request_correction($1, null, now() - interval '9 hours', null, 'Solo sé la hora de entrada')", [assignmentId])),
      ),
    ).toMatch(/registro nuevo indica la hora de entrada y la de salida/);
    expect(
      await expectPgError(
        asUser(user, (c) =>
          c.query("select * from public.request_correction($1, null, now() - interval '30 hours', now() - interval '2 hours', 'Fuera de la ventana')", [assignmentId]),
        ),
      ),
    ).toMatch(/dentro del horario de la guardia/);

    const cancelledShift = await createShiftSuper(facility, -2000, -1500);
    const inCancelled = await assignSuper(cancelledShift, worker);
    await asSuper((c) => c.query("update public.shifts set status = 'cancelada', cancel_reason = 'Prueba de cancelación' where id = $1", [cancelledShift]));
    expect(
      await expectPgError(
        asUser(user, (c) =>
          c.query("select * from public.request_correction($1, null, now() - interval '33 hours', now() - interval '26 hours', 'Guardia cancelada')", [inCancelled]),
        ),
      ),
    ).toMatch(/guardia está cancelada/);

    const otherShift = await createShiftSuper(facility, -3000, -2500);
    const cancelledAssignment = await assignSuper(otherShift, worker);
    await asUser(coordA, (c) => c.query("select public.set_assignment_status($1, 'cancelado', 'Se reasignó a otra sede')", [cancelledAssignment]));
    expect(
      await expectPgError(
        asUser(user, (c) =>
          c.query("select * from public.request_correction($1, null, now() - interval '49 hours', now() - interval '43 hours', 'Asignación cancelada')", [
            cancelledAssignment,
          ]),
        ),
      ),
    ).toMatch(/asignación está cancelada/);
  });
});
