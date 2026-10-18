/**
 * Límite de intentos compartido entre instancias (app.rate_limits): solo la
 * llave de servicio lo usa; cada intento se reserva de forma atómica antes de
 * verificar la contraseña y la ventana es deslizante, como en memoria.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asSuper, asUser, createAuthUser, expectPgError, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
const item = (scope: string, key: string, max = 3, reserve = true) => ({ scope, key, max, window_ms: 900_000, block_ms: 900_000, reserve });

/** Ejecuta como la llave de servicio (rol service_role), en su propia conexión y transacción. */
async function asService<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>): Promise<T> {
  return asSuper(async (c) => {
    await c.query("begin");
    try {
      await c.query("set local role service_role");
      const result = await fn((sql, params) => c.query(sql, params));
      await c.query("commit");
      return result;
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
  });
}

const attempt = (items: unknown[]) =>
  asService((q) => q("select public.rate_limit_attempt($1::jsonb) as ms", [JSON.stringify(items)])).then((r) => Number(r.rows[0].ms));
const call = (fn: string, items: unknown[]) => asService((q) => q(`select public.${fn}($1::jsonb)`, [JSON.stringify(items)]));
const row = async (key: string) => (await asSuper((c) => c.query("select scope, cardinality(attempts) as n, blocked_until from app.rate_limits where key_hash = $1", [key]))).rows[0];

describe("límite de intentos compartido", () => {
  it("reserva: el intento N bloquea, uno bloqueado no cuenta, un reembolso libera y acertar limpia", async () => {
    const pair = hash();
    expect([await attempt([item("pair", pair)]), await attempt([item("pair", pair)]), await attempt([item("pair", pair)])]).toEqual([0, 0, 0]);
    expect(await attempt([item("pair", pair)])).toBeGreaterThan(890_000);
    expect((await row(pair)).n).toBe(3); // el intento bloqueado no se contó

    await call("rate_limit_refund", [item("pair", pair)]);
    expect(await row(pair)).toMatchObject({ n: 2, blocked_until: null });
    expect(await attempt([item("pair", pair)])).toBe(0);

    await call("rate_limit_clear", [{ scope: "pair", key: pair }]);
    expect(await row(pair)).toBeUndefined();
  });

  it("solicitudes simultáneas no pasan todas: con máximo 8, de 12 solo 8 reservan", async () => {
    const pair = hash();
    const waits = await Promise.all(Array.from({ length: 12 }, () => attempt([item("pair", pair, 8)])));
    expect(waits.filter((w) => w === 0)).toHaveLength(8);
    expect(waits.filter((w) => w > 0)).toHaveLength(4);
  });

  it("ventana deslizante: los intentos viejos salen de la cuenta", async () => {
    const key = hash();
    await attempt([item("email", key)]);
    await attempt([item("email", key)]);
    // Uno de los dos intentos queda fuera de la ventana de 15 min.
    await asSuper((c) => c.query("update app.rate_limits set attempts = array[now() - interval '16 minutes', attempts[2]] where key_hash = $1", [key]));
    expect(await attempt([item("email", key)])).toBe(0); // 2 dentro de la ventana: no bloquea
    expect(await row(key)).toMatchObject({ n: 2, blocked_until: null });
    expect(await attempt([item("email", key)])).toBe(0); // 3.º dentro de la ventana: bloquea a partir de aquí
    expect(await attempt([item("email", key)])).toBeGreaterThan(0);
  });

  it("la IP se cuenta después del fallo y su bloqueo también impide reservar", async () => {
    const ip = hash();
    const pair = hash();
    for (let i = 0; i < 3; i++) await call("rate_limit_fail", [item("ip", ip, 3, false)]);
    expect(await row(ip)).toMatchObject({ n: 0 }); // al bloquear se vacía la cuenta, igual que en memoria
    expect(await attempt([item("pair", pair), item("ip", ip, 3, false)])).toBeGreaterThan(0);
    expect(await row(pair)).toMatchObject({ n: 0 }); // bloqueado por la IP: la combinación no se contó
  });

  it("rechaza parámetros inválidos y claves que no son huellas", async () => {
    expect(await expectPgError(attempt([{ ...item("pair", hash()), max: 0 }]))).toMatch(/inválidos/);
    expect(await expectPgError(attempt(Array.from({ length: 11 }, () => item("pair", hash()))))).toMatch(/inválida/);
    expect(await expectPgError(attempt([item("pair", "correo@ejemplo.test")]))).toMatch(/rate_limits_key_hash_check|violates check/);
  });

  it("nadie más que la llave de servicio puede usarlo", async () => {
    const user = await createAuthUser({ role: "admin" });
    const items = JSON.stringify([item("email", hash())]);
    for (const who of [null, user]) {
      for (const fn of ["rate_limit_attempt", "rate_limit_fail", "rate_limit_refund", "rate_limit_clear"]) {
        expect(await expectPgError(asUser(who, (c) => c.query(`select public.${fn}($1::jsonb)`, [items])))).toMatch(/permission denied/);
      }
      expect(await expectPgError(asUser(who, (c) => c.query("select count(*) from app.rate_limits")))).toMatch(/permission denied/);
    }
  });
});
