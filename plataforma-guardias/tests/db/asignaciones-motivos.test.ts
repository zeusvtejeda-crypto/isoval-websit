/**
 * Una asignación con historia no se borra (se cancela con motivo) y la
 * bitácora conserva el motivo de solicitudes, revisiones y justificaciones.
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
} from "./helpers";

let facility: string;
let coord: string;

beforeAll(async () => {
  facility = await createFacilitySuper();
  coord = await createAuthUser({ role: "coordinador" });
  await grantScope(coord, facility);
});

afterAll(async () => {
  await pool.end();
});

async function exists(assignmentId: string): Promise<boolean> {
  const r = await asSuper((c) => c.query("select 1 from public.shift_assignments where id = $1", [assignmentId]));
  return (r.rowCount ?? 0) > 0;
}

async function lastAuditReason(table: string, recordId: string, action: string): Promise<string | null> {
  const r = await asSuper((c) =>
    c.query("select reason from public.audit_log where table_name = $1 and record_id = $2 and action = $3 order by id desc limit 1", [
      table,
      recordId,
      action,
    ]),
  );
  return r.rows[0]?.reason ?? null;
}

describe("borrado de asignaciones", () => {
  it("coordinación quita una asignación sin historia", async () => {
    const assignmentId = await assignSuper(await createShiftSuper(facility, 600, 900), await createWorkerSuper(facility));
    const r = await asUser(coord, (c) => c.query("delete from public.shift_assignments where id = $1", [assignmentId]));
    expect(r.rowCount).toBe(1);
    expect(await exists(assignmentId)).toBe(false);
  });

  it("no se borra una asignación con inasistencia confirmada (ni en cascada al borrar la guardia)", async () => {
    const shiftId = await createShiftSuper(facility, -600, -60);
    const assignmentId = await assignSuper(shiftId, await createWorkerSuper(facility));
    await asUser(coord, (c) => c.query("select public.set_assignment_status($1, 'inasistencia_confirmada', 'No se presentó')", [assignmentId]));

    const msg = await expectPgError(asUser(coord, (c) => c.query("delete from public.shift_assignments where id = $1", [assignmentId])));
    expect(msg).toMatch(/no puede quitarse/);
    expect(await expectPgError(asSuper((c) => c.query("delete from public.shifts where id = $1", [shiftId])))).toMatch(/no puede quitarse/);
    expect(await exists(assignmentId)).toBe(true);
  });

  it("no se borra una asignación con justificaciones; las depuraciones autorizadas sí pueden", async () => {
    const assignmentId = await assignSuper(await createShiftSuper(facility, -600, -60), await createWorkerSuper(facility));
    await asUser(coord, (c) =>
      c.query("insert into public.incident_notes (assignment_id, incident_type, note) values ($1, 'llegada_tardia', 'Avisó por transporte')", [
        assignmentId,
      ]),
    );
    expect(await expectPgError(asUser(coord, (c) => c.query("delete from public.shift_assignments where id = $1", [assignmentId])))).toMatch(
      /no puede quitarse/,
    );

    // Con app.allow_purge (retención o datos de demostración) se permite; se revierte.
    await asSuper(async (c) => {
      await c.query("begin");
      try {
        await c.query("select set_config('app.allow_purge', 'on', true)");
        const r = await c.query("delete from public.shift_assignments where id = $1", [assignmentId]);
        expect(r.rowCount).toBe(1);
      } finally {
        await c.query("rollback");
      }
    });
    expect(await exists(assignmentId)).toBe(true);
  });
});

describe("motivo en la bitácora", () => {
  it("registra el motivo de la solicitud, el de su rechazo y el de una justificación", async () => {
    const worker = await createWorkerSuper(facility);
    const user = await createAuthUser({ role: "trabajador", workerId: worker });
    const assignmentId = await assignSuper(await createShiftSuper(facility, -600, -60), worker);

    const request = await asUser(user, (c) =>
      c.query("select id from public.request_correction($1, null, now() - interval '9 hours', now() - interval '2 hours', $2)", [
        assignmentId,
        "Olvidé registrar mi entrada",
      ]),
    );
    const requestId = request.rows[0].id as string;
    expect(await lastAuditReason("correction_requests", requestId, "INSERT")).toBe("Olvidé registrar mi entrada");

    await asUser(coord, (c) => c.query("select public.review_correction($1, false, $2)", [requestId, "Sin constancia en el acceso"]));
    expect(await lastAuditReason("correction_requests", requestId, "UPDATE")).toBe("Sin constancia en el acceso");

    const note = await asUser(coord, (c) =>
      c.query("insert into public.incident_notes (assignment_id, incident_type, note) values ($1, 'salida_anticipada', 'Consulta programada') returning id", [
        assignmentId,
      ]),
    );
    expect(await lastAuditReason("incident_notes", note.rows[0].id, "INSERT")).toBe("Consulta programada");
  });
});
