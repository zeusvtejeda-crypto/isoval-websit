/**
 * Límites de texto y números de trabajador (20261017001330):
 * - máximos de longitud en todos los textos libres y rechazo temprano en las RPC;
 * - employee_number solo se escribe con set_employee_number / create_worker /
 *   create_workers, que cobran la cuota diaria y la conservan aunque el número
 *   ya exista;
 * - profiles.change_reason no es legible para las cuentas autenticadas;
 * - una sola solicitud pendiente de registro nuevo por asignación;
 * - responsable de la guardia: trabajador activo de la misma sede.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { friendlyDbError } from "@/lib/actions";
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
} from "./helpers";

const TAKEN = "Ese número de trabajador ya está registrado (posiblemente en otra sede).";

let facilityA: string;
let facilityB: string;
let adminId: string;
let coordA: string; // coordinación de la sede A
let auditorA: string;
let trabajadorUser: string;
let trabajadorWorker: string;
let workerB: string; // sede B, con número registrado
let numberB: string;

/** Error de Postgres con su código. */
async function pgError(promise: Promise<unknown>): Promise<{ message: string; code: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { message: string; code?: string };
    return { message: e.message, code: e.code ?? "" };
  }
  throw new Error("Se esperaba un error de la base de datos y no ocurrió");
}

/** Coordinación nueva de la sede A: su cuota empieza vacía. */
async function freshCoordinator(): Promise<string> {
  const id = await createAuthUser({ role: "coordinador" });
  await grantScope(id, facilityA);
  return id;
}

async function quotaRows(userId: string, number?: string): Promise<number> {
  const r = await asSuper((c) =>
    number === undefined
      ? c.query("select count(*)::int as n from app.employee_number_checks where user_id = $1", [userId])
      : c.query(
          "select count(*)::int as n from app.employee_number_checks where user_id = $1 and number_hash = encode(sha256(convert_to(upper(btrim($2)), 'UTF8')), 'hex')",
          [userId, number],
        ),
  );
  return r.rows[0].n;
}

async function storedNumber(workerId: string): Promise<string | null> {
  const r = await asSuper((c) => c.query("select employee_number from public.worker_private where worker_id = $1", [workerId]));
  return r.rows[0]?.employee_number ?? null;
}

async function countWorkersNamed(name: string): Promise<number> {
  const r = await asSuper((c) => c.query("select count(*)::int as n from public.workers where full_name = $1", [name]));
  return r.rows[0].n;
}

beforeAll(async () => {
  facilityA = await createFacilitySuper();
  facilityB = await createFacilitySuper();
  adminId = await createAuthUser({ role: "admin" });
  coordA = await createAuthUser({ role: "coordinador" });
  await grantScope(coordA, facilityA);
  auditorA = await createAuthUser({ role: "auditor" });
  await grantScope(auditorA, facilityA);
  trabajadorWorker = await createWorkerSuper(facilityA);
  trabajadorUser = await createAuthUser({ role: "trabajador", workerId: trabajadorWorker });

  workerB = await createWorkerSuper(facilityB);
  numberB = `LNB-${suffix()}`;
  await asSuper((c) => c.query("insert into public.worker_private (worker_id, employee_number) values ($1, $2)", [workerB, numberB]));
});

afterAll(async () => {
  await asSuper((c) => c.query("update public.workers set is_demo = true where facility_id = any($1::uuid[])", [[facilityA, facilityB]]));
  await pool.end();
});

// ---------------------------------------------------------------------------
describe("worker_private: employee_number no se escribe directamente", () => {
  it("privilegios por columna: sin INSERT/UPDATE de employee_number; el resto sigue disponible", async () => {
    const r = await asSuper((c) =>
      c.query(
        `select col, has_column_privilege('authenticated', 'public.worker_private', col, 'INSERT') as ins,
                has_column_privilege('authenticated', 'public.worker_private', col, 'UPDATE') as upd,
                has_column_privilege('authenticated', 'public.worker_private', col, 'SELECT') as sel
         from unnest(array['employee_number', 'phone', 'change_reason', 'worker_id', 'updated_at']) as col`,
      ),
    );
    const byCol = Object.fromEntries(r.rows.map((x) => [x.col, x]));
    expect(byCol.employee_number).toMatchObject({ ins: false, upd: false, sel: true });
    for (const col of ["phone", "change_reason", "worker_id", "updated_at"]) expect(byCol[col]).toMatchObject({ ins: true, upd: true, sel: true });
  });

  it("coordinación y administración no escriben el número con INSERT/UPDATE (el índice único ya no responde gratis)", async () => {
    const w = await createWorkerSuper(facilityA);
    for (const user of [coordA, adminId]) {
      expect(
        await expectPgError(asUser(user, (c) => c.query("insert into public.worker_private (worker_id, employee_number) values ($1, $2)", [w, numberB]))),
      ).toMatch(/permission denied/);
    }
    await asSuper((c) => c.query("insert into public.worker_private (worker_id, phone) values ($1, '311 000 0000')", [w]));
    expect(
      await expectPgError(asUser(coordA, (c) => c.query("update public.worker_private set employee_number = $2 where worker_id = $1", [w, numberB]))),
    ).toMatch(/permission denied/);
    expect(
      await expectPgError(
        asUser(coordA, (c) =>
          c.query(
            "insert into public.worker_private (worker_id, employee_number) values ($1, $2) on conflict (worker_id) do update set employee_number = excluded.employee_number",
            [w, numberB],
          ),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it("el teléfono sigue escribiéndose directamente, también como upsert (PostgREST)", async () => {
    const w = await createWorkerSuper(facilityA);
    const upsert =
      "insert into public.worker_private (worker_id, phone, change_reason) values ($1, $2, $3) on conflict (worker_id) do update set worker_id = excluded.worker_id, phone = excluded.phone, change_reason = excluded.change_reason";
    await asUser(coordA, (c) => c.query(upsert, [w, "311 000 1111", "Alta de teléfono"]));
    await asUser(coordA, (c) => c.query(upsert, [w, "311 000 2222", "Cambio de teléfono"]));
    const r = await asSuper((c) => c.query("select phone, employee_number from public.worker_private where worker_id = $1", [w]));
    expect(r.rows[0]).toEqual({ phone: "311 000 2222", employee_number: null });
  });
});

// ---------------------------------------------------------------------------
describe("set_employee_number", () => {
  const call = (user: string, worker: string, number: string | null, reason = "Corrección del número de trabajador") =>
    asUser(user, (c) => c.query("select public.set_employee_number($1, $2, $3) as r", [worker, number, reason])).then((r) => r.rows[0].r as string);

  it("fija el número ('ok'), con bitácora y motivo, aunque no exista la fila privada", async () => {
    const w = await createWorkerSuper(facilityA);
    const number = `LNA-${suffix()}`;
    expect(await call(coordA, w, ` ${number} `)).toBe("ok");
    expect(await storedNumber(w)).toBe(number);
    const audit = await asSuper((c) =>
      c.query("select action, reason, actor_id from public.audit_log where table_name = 'worker_private' and record_id = $1 order by id", [w]),
    );
    expect(audit.rows).toEqual([{ action: "INSERT", reason: "Corrección del número de trabajador", actor_id: coordA }]);

    // Cambio con el mismo motivo: la bitácora lo conserva (touch_row lo vaciaría en la fila).
    const other = `LNA-${suffix()}`;
    expect(await call(coordA, w, other)).toBe("ok");
    const update = await asSuper((c) =>
      c.query("select reason, changed_fields from public.audit_log where table_name = 'worker_private' and record_id = $1 and action = 'UPDATE'", [w]),
    );
    expect(update.rows).toEqual([{ reason: "Corrección del número de trabajador", changed_fields: ["employee_number"] }]);
  });

  it("número de otra sede: 'taken' sin error, no cambia nada y la cuota queda consumida", async () => {
    const coord = await freshCoordinator();
    const w = await createWorkerSuper(facilityA);
    const own = `LNO-${suffix()}`;
    await asSuper((c) => c.query("insert into public.worker_private (worker_id, employee_number) values ($1, $2)", [w, own]));

    expect(await quotaRows(coord)).toBe(0);
    expect(await call(coord, w, numberB.toLowerCase())).toBe("taken");
    expect(await storedNumber(w)).toBe(own);
    expect(await quotaRows(coord, numberB)).toBe(1);
    expect(await quotaRows(coord)).toBe(1);
  });

  it("cobra la cuota antes de escribir: con la cuota agotada se rechaza un número nuevo; uno ya comprobado no consume más", async () => {
    const coord = await freshCoordinator();
    const w = await createWorkerSuper(facilityA);
    const prefix = `LNQ${suffix()}`;
    const checked = Array.from({ length: 2000 }, (_, i) => `${prefix}-${i}`);
    await asUser(coord, (c) => c.query("select public.employee_numbers_taken($1)", [checked]));
    expect(await quotaRows(coord)).toBe(2000);

    expect(await expectPgError(call(coord, w, `${prefix}-nuevo`))).toMatch(/límite de 2000 números/);
    expect(await storedNumber(w)).toBeNull();
    expect(await call(coord, w, checked[7])).toBe("ok");
    expect(await storedNumber(w)).toBe(checked[7]);
    expect(await quotaRows(coord)).toBe(2000);
  });

  it("quitar el número o cambiar solo mayúsculas no consume cuota", async () => {
    const coord = await freshCoordinator();
    const w = await createWorkerSuper(facilityA);
    const own = `lnm-${suffix()}`;
    await asSuper((c) => c.query("insert into public.worker_private (worker_id, employee_number, phone) values ($1, $2, '311 000 0000')", [w, own]));
    expect(await call(coord, w, own.toUpperCase())).toBe("ok");
    expect(await storedNumber(w)).toBe(own.toUpperCase());
    expect(await call(coord, w, "")).toBe("ok");
    expect(await storedNumber(w)).toBeNull();
    expect(await call(coord, w, null)).toBe("ok");
    expect(await quotaRows(coord)).toBe(0);
  });

  it("administración no tiene cuota", async () => {
    const w = await createWorkerSuper(facilityB);
    expect(await call(adminId, w, numberB)).toBe("taken");
    expect(await call(adminId, w, `LNX-${suffix()}`)).toBe("ok");
    expect(await quotaRows(adminId)).toBe(0);
  });

  it("permisos: solo quien gestiona la sede del trabajador; motivo obligatorio; sin acceso anónimo", async () => {
    const w = await createWorkerSuper(facilityA);
    const denied = /no existe o no puedes modificar sus datos privados/;
    expect(await expectPgError(call(coordA, workerB, `LNP-${suffix()}`))).toMatch(denied);
    expect(await expectPgError(call(coordA, uid(), `LNP-${suffix()}`))).toMatch(denied);
    for (const user of [auditorA, trabajadorUser]) {
      expect(await expectPgError(call(user, w, `LNP-${suffix()}`))).toMatch(denied);
      expect(await expectPgError(call(user, trabajadorWorker, `LNP-${suffix()}`))).toMatch(denied);
    }
    expect(await expectPgError(call(coordA, w, `LNP-${suffix()}`, "abc"))).toMatch(/motivo del cambio/);
    expect(await expectPgError(call(coordA, w, "N".repeat(41)))).toBe("El número de trabajador admite como máximo 40 caracteres.");
    expect(await expectPgError(asUser(null, (c) => c.query("select public.set_employee_number($1, 'X', 'Motivo de prueba')", [w])))).toMatch(
      /permission denied/,
    );
    const grants = await asSuper((c) =>
      c.query(
        `select has_function_privilege('anon', 'public.set_employee_number(uuid, text, text)', 'EXECUTE') as anon,
                has_function_privilege('service_role', 'public.set_employee_number(uuid, text, text)', 'EXECUTE') as service,
                has_function_privilege('authenticated', 'public.set_employee_number(uuid, text, text)', 'EXECUTE') as auth`,
      ),
    );
    expect(grants.rows[0]).toEqual({ anon: false, service: false, auth: true });
    expect(await storedNumber(w)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("create_worker / create_workers conservan la cuota", () => {
  it("create_worker con un número de otra sede: 'taken', nada creado y la cuota consumida", async () => {
    const coord = await freshCoordinator();
    const name = `Alta con número ajeno ${suffix()}`;
    const r = await asUser(coord, (c) =>
      c.query("select public.create_worker(p_full_name => $1, p_state_id => 18, p_facility_id => $2, p_employee_number => $3, p_phone => '311 000 0000') as r", [
        name,
        facilityA,
        numberB,
      ]),
    );
    expect(r.rows[0].r).toEqual({ ok: false, taken: true, code: "23505", message: TAKEN });
    expect(await countWorkersNamed(name)).toBe(0);
    expect(await quotaRows(coord, numberB)).toBe(1);
  });

  it("create_worker con número libre: alta atómica y cuota consumida; sin número no consume", async () => {
    const coord = await freshCoordinator();
    const number = `LNC-${suffix()}`;
    const r = await asUser(coord, (c) =>
      c.query("select public.create_worker(p_full_name => $1, p_state_id => 18, p_facility_id => $2, p_employee_number => $3) as r", [
        `Alta con número ${suffix()}`,
        facilityA,
        number,
      ]),
    );
    expect(r.rows[0].r.ok).toBe(true);
    expect(await storedNumber(r.rows[0].r.id)).toBe(number);
    expect(await quotaRows(coord)).toBe(1);
    await asUser(coord, (c) => c.query("select public.create_worker($1, 18, $2)", [`Alta sin número ${suffix()}`, facilityA]));
    expect(await quotaRows(coord)).toBe(1);
  });

  it("create_workers: la fila con número repetido no crea nada y la cuota se conserva", async () => {
    const coord = await freshCoordinator();
    const names = [`Lote cuota uno ${suffix()}`, `Lote cuota dos ${suffix()}`];
    const free = `LNL-${suffix()}`;
    const rows = [
      { full_name: names[0], state_id: 18, facility_id: facilityA, employee_number: numberB },
      { full_name: names[1], state_id: 18, facility_id: facilityA, employee_number: free },
    ];
    const r = await asUser(coord, (c) => c.query("select public.create_workers($1::jsonb, $2) as r", [JSON.stringify(rows), "Importación de prueba"]));
    const results = r.rows[0].r as { ok: boolean; taken?: boolean }[];
    expect(results.map((x) => [x.ok, x.taken ?? false])).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(await countWorkersNamed(names[0])).toBe(0);
    expect(await countWorkersNamed(names[1])).toBe(1);
    expect(await quotaRows(coord, numberB)).toBe(1);
    expect(await quotaRows(coord, free)).toBe(1);
  });

  it("create_worker con la cuota agotada no crea nada", async () => {
    const coord = await freshCoordinator();
    const prefix = `LNK${suffix()}`;
    await asUser(coord, (c) => c.query("select public.employee_numbers_taken($1)", [Array.from({ length: 2000 }, (_, i) => `${prefix}-${i}`)]));
    const name = `Alta sin cuota ${suffix()}`;
    expect(
      await expectPgError(
        asUser(coord, (c) => c.query("select public.create_worker(p_full_name => $1, p_state_id => 18, p_facility_id => $2, p_employee_number => $3)", [name, facilityA, `${prefix}-x`])),
      ),
    ).toMatch(/límite de 2000 números/);
    expect(await countWorkersNamed(name)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("profiles.change_reason no es legible para las cuentas autenticadas", () => {
  it("SELECT por columna para todo menos change_reason; se sigue pudiendo escribir", async () => {
    const r = await asSuper((c) =>
      c.query(
        `select a.attname as col, has_column_privilege('authenticated', 'public.profiles', a.attname, 'SELECT') as sel
         from pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped`,
      ),
    );
    for (const row of r.rows) expect([row.col, row.sel]).toEqual([row.col, row.col !== "change_reason"]);
    const upd = await asSuper((c) => c.query("select has_column_privilege('authenticated', 'public.profiles', 'change_reason', 'UPDATE') as upd"));
    expect(upd.rows[0].upd).toBe(true);
  });

  it("coordinación, auditoría y administración no leen change_reason (ni con *); las demás columnas sí", async () => {
    for (const user of [coordA, auditorA, adminId]) {
      expect(await expectPgError(asUser(user, (c) => c.query("select change_reason from public.profiles where id = $1", [user])))).toMatch(
        /permission denied/,
      );
      expect(await expectPgError(asUser(user, (c) => c.query("select * from public.profiles where id = $1", [user])))).toMatch(/permission denied/);
      const ok = await asUser(user, (c) =>
        c.query("select id, role, display_name, worker_id, active, created_at, updated_at from public.profiles where id = $1", [user]),
      );
      expect(ok.rowCount).toBe(1);
    }
  });

  it("administración actualiza una cuenta con motivo (como la página de usuarios) y el motivo queda en la bitácora", async () => {
    const target = await createAuthUser({ role: "coordinador" });
    const reason = `Cambio de nombre ${suffix()}`;
    const r = await asUser(adminId, (c) =>
      c.query("update public.profiles set display_name = 'Nombre de prueba', change_reason = $2 where id = $1 returning id", [target, reason]),
    );
    expect(r.rows).toEqual([{ id: target }]);
    const audit = await asSuper((c) =>
      c.query("select reason from public.audit_log where table_name = 'profiles' and record_id = $1 and action = 'UPDATE' order by id desc limit 1", [target]),
    );
    expect(audit.rows[0].reason).toBe(reason);
  });
});

// ---------------------------------------------------------------------------
describe("límites de longitud", () => {
  // Columnas de texto sin límite propio por ser del sistema o tener otra validación.
  const EXEMPT = new Set([
    "attendance_qr_tokens.token_hash", // huella SHA-256
    "audit_log.action",
    "audit_log.actor_role",
    "audit_log.reason",
    "audit_log.record_id",
    "audit_log.table_name", // bitácora: solo la escriben funciones y triggers
    "facilities.normalized_name",
    "workers.normalized_name", // columnas generadas
    "facilities.timezone",
    "municipalities.timezone",
    "states.default_timezone", // zona validada contra pg_timezone_names
    "municipalities.inegi_code",
    "facility_categories.color",
    "worker_private.phone", // expresiones regulares acotadas
  ]);

  it("toda columna de texto que escribe una cuenta tiene una longitud máxima", async () => {
    const cols = await asSuper((c) =>
      c.query(
        `select c.table_name, c.column_name
         from information_schema.columns c
         join information_schema.tables t using (table_schema, table_name)
         where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type = 'text'`,
      ),
    );
    const checks = await asSuper((c) =>
      c.query("select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace"),
    );
    const missing: string[] = [];
    for (const { table_name: table, column_name: column } of cols.rows) {
      const key = `${table}.${column}`;
      if (EXEMPT.has(key)) continue;
      // pg_get_constraintdef pone entre comillas las palabras reservadas («"position"»).
      const bounded = new RegExp(`char_length\\((btrim\\()?\\(?"?${column}"?\\)?\\)?\\) <= \\d+`);
      if (!checks.rows.some((x) => x.tbl === table && bounded.test(x.def))) missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it("límites esperados en las columnas principales", async () => {
    const r = await asSuper((c) =>
      c.query(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
         where conname = any($1::text[])`,
        [
          [
            "attendance_sessions_notes_max_len",
            "attendance_sessions_status_reason_max_len",
            "correction_requests_reason_max_len",
            "incident_notes_note_max_len",
            "shifts_instructions_max_len",
            "shift_assignments_notes_max_len",
            "profiles_change_reason_max_len",
            "app_settings_value_max_len",
            "facilities_services_max_len",
          ],
        ],
      ),
    );
    const defs = Object.fromEntries(r.rows.map((x) => [x.conname, x.def]));
    expect(defs.attendance_sessions_notes_max_len).toContain("<= 2500");
    expect(defs.attendance_sessions_status_reason_max_len).toContain("<= 2500");
    expect(defs.correction_requests_reason_max_len).toContain("<= 1000");
    expect(defs.incident_notes_note_max_len).toContain("<= 1000");
    expect(defs.shifts_instructions_max_len).toContain("<= 2000");
    expect(defs.shift_assignments_notes_max_len).toContain("<= 1000");
    expect(defs.profiles_change_reason_max_len).toContain("<= 1000");
    expect(defs.app_settings_value_max_len).toContain("<= 50000");
    expect(defs.facilities_services_max_len).toContain("text_array_fits(services, 60, 200)");
  });

  it("las RPC rechazan textos demasiado largos antes de cualquier otra validación, con mensaje en español", async () => {
    const long = (n: number) => "x".repeat(n);
    const nota = "La nota admite como máximo 1000 caracteres.";
    const motivo = "El motivo admite como máximo 1000 caracteres.";
    const cases: [string, unknown[], string][] = [
      ["select public.check_in($1, $2, $3, null)", [uid(), uid(), long(1001)], nota],
      ["select public.check_in($1, $2, null, $3)", [uid(), uid(), long(1001)], motivo],
      ["select public.check_out($1, $2, $3, null)", [uid(), uid(), long(1001)], nota],
      ["select public.check_out($1, $2, null, $3)", [uid(), uid(), long(1001)], motivo],
      ["select public.check_in_qr('token', $1, $2)", [uid(), long(1001)], nota],
      ["select public.check_out_qr('token', $1, $2)", [uid(), long(1001)], nota],
      ["select public.add_manual_attendance($1, now() - interval '2 hours', now() - interval '1 hour', $2, $3, null)", [uid(), long(2501), uid()], "El motivo admite como máximo 2500 caracteres."],
      ["select public.add_manual_attendance($1, now() - interval '2 hours', now() - interval '1 hour', 'Motivo válido', $2, $3)", [uid(), uid(), long(1001)], nota],
      ["select public.correct_attendance($1, now() - interval '2 hours', null, $2, null)", [uid(), long(2501)], "El motivo admite como máximo 2500 caracteres."],
      ["select public.correct_attendance($1, now() - interval '2 hours', null, 'Motivo válido', $2)", [uid(), long(1001)], nota],
      ["select public.void_attendance($1, $2)", [uid(), long(1001)], motivo],
      ["select public.request_correction($1, null, now() - interval '2 hours', now() - interval '1 hour', $2)", [uid(), long(1001)], motivo],
      ["select public.review_correction($1, false, $2)", [uid(), long(1001)], "La nota de revisión admite como máximo 1000 caracteres."],
      ["select public.set_assignment_status($1, 'cancelado', $2)", [uid(), long(1001)], motivo],
      ["select public.set_user_scopes($1, '{}', $2)", [uid(), long(1001)], motivo],
      ["select public.log_password_reset($1, $2)", [uid(), long(1001)], motivo],
      ["select public.create_worker($1, 18, $2, p_change_reason => $3)", [`Persona ${suffix()}`, uid(), long(1001)], motivo],
      ["select public.create_worker($1, 18, $2, p_area => $3)", [`Persona ${suffix()}`, uid(), long(121)], "El área admite como máximo 120 caracteres."],
      ["select public.create_workers('[]'::jsonb, $1)", [long(1001)], motivo],
      ["select public.set_employee_number($1, 'X-1', $2)", [uid(), long(1001)], motivo],
    ];
    for (const [sql, params, expected] of cases) {
      const e = await pgError(asUser(coordA, (c) => c.query(sql, params)));
      expect([sql, e.message, e.code]).toEqual([sql, expected, "22001"]);
      // friendlyDbError (src/lib/actions.ts) muestra el mensaje tal cual.
      expect(friendlyDbError(e)).toBe(expected);
    }
  });

  it("escrituras directas también acotadas (restricciones CHECK)", async () => {
    expect(
      await expectPgError(
        asUser(coordA, (c) =>
          c.query("insert into public.shifts (facility_id, meeting_point, starts_at, ends_at, title) values ($1, 'Acceso', now() + interval '1 day', now() + interval '1 day 2 hours', $2)", [
            facilityA,
            "T".repeat(201),
          ]),
        ),
      ),
    ).toMatch(/shifts_title_max_len/);
    const w = await createWorkerSuper(facilityA);
    expect(await expectPgError(asUser(coordA, (c) => c.query("update public.workers set area = $2 where id = $1", [w, "A".repeat(121)])))).toMatch(
      /workers_area_max_len/,
    );
    expect(
      await expectPgError(asUser(adminId, (c) => c.query("update public.facilities set services = array[$2::text] where id = $1", [facilityB, "S".repeat(201)]))),
    ).toMatch(/facilities_services_max_len/);
  });

  it("la salida agrega su nota a la de la entrada: 1000 + 1000 caracteres caben", async () => {
    const worker = await createWorkerSuper(facilityA);
    const user = await createAuthUser({ role: "trabajador", workerId: worker });
    const assignment = await assignSuper(await createShiftSuper(facilityA, -30, 300), worker);
    const inNote = "E".repeat(1000);
    const outNote = "S".repeat(1000);
    await asUser(user, (c) => c.query("select public.check_in($1, $2, $3, null)", [assignment, uid(), inNote]));
    const out = await asUser(user, (c) => c.query("select public.check_out($1, $2, $3, null) as r", [assignment, uid(), outNote]));
    expect(out.rows[0].r.result).toBe("created");
    const s = await asSuper((c) => c.query("select notes from public.attendance_sessions where assignment_id = $1", [assignment]));
    expect(s.rows[0].notes).toBe(`${inNote}\n${outNote}`);
  });

  it("aprobar una corrección compone motivo y nota de revisión de 1000 caracteres cada uno (y revierte la inasistencia)", async () => {
    const worker = await createWorkerSuper(facilityA);
    const user = await createAuthUser({ role: "trabajador", workerId: worker });
    const assignment = await assignSuper(await createShiftSuper(facilityA, -600, -60), worker);
    await asUser(coordA, (c) => c.query("select public.set_assignment_status($1, 'inasistencia_confirmada', 'No se presentó al acceso')", [assignment]));
    const reason = "M".repeat(1000);
    const notes = "R".repeat(1000);
    const req = await asUser(user, (c) =>
      c.query("select id from public.request_correction($1, null, now() - interval '9 hours', now() - interval '2 hours', $2)", [assignment, reason]),
    );
    const review = await asUser(coordA, (c) => c.query("select status from public.review_correction($1, true, $2)", [req.rows[0].id, notes]));
    expect(review.rows[0].status).toBe("aprobada");
    const s = await asSuper((c) => c.query("select check_in_reason from public.attendance_sessions where assignment_id = $1", [assignment]));
    expect(s.rows[0].check_in_reason).toBe(`Solicitud de corrección aprobada: ${reason} / Revisión: ${notes}`);
    expect(s.rows[0].check_in_reason.length).toBe(2047);
    const a = await asSuper((c) => c.query("select status, char_length(status_reason) as n from public.shift_assignments where id = $1", [assignment]));
    expect(a.rows[0].status).toBe("asignado");
    expect(a.rows[0].n).toBeGreaterThan(2100);
  });
});

// ---------------------------------------------------------------------------
describe("solicitudes de corrección de registro nuevo", () => {
  it("una sola pendiente por asignación; tras revisarla se puede enviar otra", async () => {
    const worker = await createWorkerSuper(facilityA);
    const user = await createAuthUser({ role: "trabajador", workerId: worker });
    const assignment = await assignSuper(await createShiftSuper(facilityA, -600, -60), worker);
    const sql = "select id from public.request_correction($1, null, now() - interval '9 hours', now() - interval '2 hours', $2)";

    const first = await asUser(user, (c) => c.query(sql, [assignment, "Olvidé registrar mi entrada"]));
    const dup = await pgError(asUser(user, (c) => c.query(sql, [assignment, "Otra vez la misma solicitud"])));
    expect(dup.code).toBe("23505");
    expect(dup.message).toBe("Ya existe una solicitud pendiente para agregar un registro en esta guardia. Espera a que se revise antes de enviar otra.");
    // Tampoco coordinación puede duplicarla en nombre de la persona.
    expect((await pgError(asUser(coordA, (c) => c.query(sql, [assignment, "En nombre de la persona"])))).code).toBe("23505");

    await asUser(coordA, (c) => c.query("select * from public.review_correction($1, false, 'No coincide con la bitácora')", [first.rows[0].id]));
    const again = await asUser(user, (c) => c.query(sql, [assignment, "Adjunto el registro del acceso"]));
    expect(again.rowCount).toBe(1);
    const idx = await asSuper((c) => c.query("select indexdef from pg_indexes where indexname = 'correction_requests_one_pending_new_per_assignment'"));
    expect(idx.rows[0].indexdef).toMatch(/UNIQUE INDEX .*\(assignment_id\) WHERE \(\(status = 'pendiente'::correction_status\) AND \(session_id IS NULL\)\)/);
  });
});

// ---------------------------------------------------------------------------
describe("responsable de la guardia", () => {
  const insertShift = (facility: string, responsible: string) =>
    `insert into public.shifts (facility_id, meeting_point, starts_at, ends_at, responsible_worker_id)
     values ('${facility}', 'Acceso ${suffix()}', now() + interval '3 days', now() + interval '3 days 4 hours', '${responsible}') returning id`;
  const RULE = "El responsable debe ser un trabajador activo de la sede.";

  it("coordinación no fija como responsable a alguien de otra sede ni a alguien inactivo (ni con escrituras directas)", async () => {
    expect(await expectPgError(asUser(coordA, (c) => c.query(insertShift(facilityA, workerB))))).toBe(RULE);
    const inactive = await createWorkerSuper(facilityA);
    await asSuper((c) => c.query("update public.workers set active = false where id = $1", [inactive]));
    expect(await expectPgError(asUser(coordA, (c) => c.query(insertShift(facilityA, inactive))))).toBe(RULE);
    expect(await expectPgError(asUser(coordA, (c) => c.query(insertShift(facilityA, uid()))))).toMatch(new RegExp(`${RULE}|foreign key`));

    const ok = await asUser(coordA, (c) => c.query(insertShift(facilityA, trabajadorWorker)));
    const shiftId = ok.rows[0].id as string;
    expect(
      await expectPgError(
        asUser(coordA, (c) => c.query("update public.shifts set responsible_worker_id = $2, change_reason = 'Cambio de responsable' where id = $1", [shiftId, workerB])),
      ),
    ).toBe(RULE);
    // workerB sigue sin ser visible para la coordinación de A.
    const visible = await asUser(coordA, (c) => c.query("select 1 from public.workers where id = $1", [workerB]));
    expect(visible.rowCount).toBe(0);
  });

  it("se revisa al cambiar la sede; un responsable que después se desactiva no bloquea otras ediciones", async () => {
    const responsible = await createWorkerSuper(facilityA);
    const ok = await asUser(adminId, (c) => c.query(insertShift(facilityA, responsible)));
    const shiftId = ok.rows[0].id as string;
    expect(await expectPgError(asUser(adminId, (c) => c.query("update public.shifts set facility_id = $2 where id = $1", [shiftId, facilityB])))).toBe(RULE);

    await asSuper((c) => c.query("update public.workers set active = false where id = $1", [responsible]));
    await asUser(adminId, (c) => c.query("update public.shifts set title = 'Título nuevo', change_reason = 'Ajuste de título' where id = $1", [shiftId]));
    const r = await asSuper((c) => c.query("select title, responsible_worker_id from public.shifts where id = $1", [shiftId]));
    expect(r.rows[0]).toEqual({ title: "Título nuevo", responsible_worker_id: responsible });
  });

  it("también aplica a la llave de servicio y a los datos de demostración (el seed ya cumple la regla)", async () => {
    expect(await expectPgError(asSuper((c) => c.query(insertShift(facilityA, workerB))))).toBe(RULE);
    const seed = await asSuper((c) =>
      c.query(
        `select count(*)::int as n from public.shifts s join public.workers w on w.id = s.responsible_worker_id
         where s.is_demo and (not w.active or w.facility_id <> s.facility_id)`,
      ),
    );
    expect(seed.rows[0].n).toBe(0);
  });
});
