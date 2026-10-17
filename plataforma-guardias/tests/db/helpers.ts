import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";

/**
 * Utilidades para probar la base de datos real (Supabase local) con RLS.
 * Simula usuarios autenticados igual que PostgREST: rol `authenticated` y
 * `request.jwt.claims` con el `sub` del usuario.
 */
export const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  max: 6,
});

export type Db = PoolClient;

/** Ejecuta como superusuario (preparación de datos de prueba). */
export async function asSuper<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/** Ejecuta dentro de una transacción como usuario autenticado (o anónimo si userId es null). */
export async function asUser<T>(userId: string | null, fn: (c: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (userId) {
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated" }),
      ]);
      await c.query("set local role authenticated");
    } else {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
      await c.query("set local role anon");
    }
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

export const uid = () => randomUUID();
export const suffix = () => randomUUID().slice(0, 8);

export async function createAuthUser(opts: {
  role: "admin" | "coordinador" | "trabajador" | "auditor";
  workerId?: string | null;
  email?: string;
}): Promise<string> {
  const id = uid();
  const email = opts.email ?? `prueba-${id.slice(0, 8)}@ejemplo.test`;
  await asSuper((c) =>
    c.query(
      // GoTrue no admite NULL en las columnas de tokens: se inicializan vacías.
      `insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
         phone_change, phone_change_token, reauthentication_token)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3, '{}'::jsonb, now(), now(),
         '', '', '', '', '', '', '', '')`,
      [id, email, JSON.stringify({ provider: "email", role: opts.role, worker_id: opts.workerId ?? null })],
    ),
  );
  return id;
}

export async function grantScope(userId: string, facilityId: string) {
  await asSuper((c) =>
    c.query("insert into public.user_facility_scopes (user_id, facility_id) values ($1, $2)", [userId, facilityId]),
  );
}

export async function categoryId(slug = "umf"): Promise<number> {
  const r = await asSuper((c) => c.query("select id from public.facility_categories where slug = $1", [slug]));
  return r.rows[0].id;
}

export async function municipalityId(code = "017"): Promise<number> {
  const r = await asSuper((c) =>
    c.query("select id from public.municipalities where state_id = 18 and inegi_code = $1", [code]),
  );
  return r.rows[0].id;
}

/**
 * Instalación de prueba: marcada como dato de demostración para que el
 * directorio público la etiquete y public.purge_demo_data() la elimine.
 * Sigue visible (is_public) porque algunas pruebas revisan la vista pública.
 */
export async function createFacilitySuper(name?: string): Promise<string> {
  const cat = await categoryId();
  const mun = await municipalityId();
  const r = await asSuper((c) =>
    c.query(
      `insert into public.facilities (official_name, category_id, state_id, municipality_id, latitude, longitude, source, is_demo)
       values ($1, $2, 18, $3, 21.5, -104.9, 'Prueba automatizada', true) returning id`,
      [name ?? `Instalación de prueba ${suffix()}`, cat, mun],
    ),
  );
  return r.rows[0].id;
}

export async function createWorkerSuper(facilityId: string, name?: string): Promise<string> {
  const r = await asSuper((c) =>
    c.query(
      // Marcado como demostración, igual que las instalaciones de prueba: no se
      // confunde con personal real y purge_demo_data() lo elimina.
      `insert into public.workers (full_name, state_id, facility_id, is_demo) values ($1, 18, $2, true) returning id`,
      [name ?? `Persona de prueba ${suffix()}`, facilityId],
    ),
  );
  return r.rows[0].id;
}

/** Guardia relativa a la hora del servidor: startOffset/endOffset en minutos. */
export async function createShiftSuper(
  facilityId: string,
  startOffsetMin: number,
  endOffsetMin: number,
  extra: { minStaff?: number; maxStaff?: number | null } = {},
): Promise<string> {
  const r = await asSuper((c) =>
    c.query(
      `insert into public.shifts (facility_id, meeting_point, starts_at, ends_at, min_staff, max_staff)
       values ($1, $2, now() + make_interval(mins => $3), now() + make_interval(mins => $4), $5, $6) returning id`,
      [facilityId, `Punto ${suffix()}`, startOffsetMin, endOffsetMin, extra.minStaff ?? 1, extra.maxStaff ?? null],
    ),
  );
  return r.rows[0].id;
}

export async function assignSuper(shiftId: string, workerId: string): Promise<string> {
  const r = await asSuper((c) =>
    c.query("insert into public.shift_assignments (shift_id, worker_id) values ($1, $2) returning id", [shiftId, workerId]),
  );
  return r.rows[0].id;
}

/** Espera un error de Postgres y devuelve su mensaje. */
export async function expectPgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Se esperaba un error de la base de datos y no ocurrió");
}
