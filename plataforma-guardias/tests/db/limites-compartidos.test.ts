/**
 * Límite de intentos compartido entre instancias (app.rate_limits): solo la
 * llave de servicio lo usa y aplica la misma regla que los contadores en memoria.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asSuper, asUser, createAuthUser, expectPgError, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
const rule = (scope: string, key: string, max = 3) => ({ scope, key, max, window_ms: 900_000, block_ms: 900_000 });

/** Ejecuta como la llave de servicio (rol service_role), dentro de una transacción. */
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

describe("límite de intentos compartido", () => {
  it("N fallos bloquean; acertar limpia solo las claves indicadas", async () => {
    const pair = hash();
    const ip = hash();
    const items = JSON.stringify([rule("pair", pair), rule("ip", ip, 10)]);
    const results = await asService(async (q) => {
      const out: number[] = [];
      for (let i = 0; i < 3; i++) out.push(Number((await q("select public.rate_limit_fail($1::jsonb) as ms", [items])).rows[0].ms));
      return out;
    });
    expect(results.slice(0, 2)).toEqual([0, 0]);
    expect(results[2]).toBeGreaterThan(890_000); // el tercer fallo de la combinación bloquea 15 min

    const wait = await asService((q) => q("select public.rate_limit_retry_after($1::jsonb) as ms", [JSON.stringify([{ scope: "pair", key: pair }])]));
    expect(Number(wait.rows[0].ms)).toBeGreaterThan(0);

    await asService((q) => q("select public.rate_limit_clear($1::jsonb)", [JSON.stringify([{ scope: "pair", key: pair }])]));
    const after = await asSuper((c) => c.query("select scope, failures from app.rate_limits where key_hash = any($1)", [[pair, ip]]));
    expect(after.rows).toEqual([{ scope: "ip", failures: 3 }]); // la IP no se limpia
  });

  it("una ventana vencida vuelve a contar desde cero", async () => {
    const key = hash();
    const items = JSON.stringify([rule("email", key)]);
    await asService(async (q) => {
      await q("select public.rate_limit_fail($1::jsonb)", [items]);
      await q("select public.rate_limit_fail($1::jsonb)", [items]);
    });
    await asSuper((c) => c.query("update app.rate_limits set window_started_at = now() - interval '16 minutes' where key_hash = $1", [key]));
    const ms = await asService((q) => q("select public.rate_limit_fail($1::jsonb) as ms", [items]));
    expect(Number(ms.rows[0].ms)).toBe(0);
    const row = await asSuper((c) => c.query("select failures from app.rate_limits where key_hash = $1", [key]));
    expect(row.rows[0].failures).toBe(1);
  });

  it("rechaza parámetros inválidos y claves que no son huellas", async () => {
    const fail = (items: unknown[]) => asService((q) => q("select public.rate_limit_fail($1::jsonb)", [JSON.stringify(items)]));
    expect(await expectPgError(fail([{ ...rule("pair", hash()), max: 0 }]))).toMatch(/inválidos/);
    expect(await expectPgError(fail([rule("pair", "correo@ejemplo.test")]))).toMatch(/rate_limits_key_hash_check|violates check/);
  });

  it("nadie más que la llave de servicio puede consultarlo, registrarlo o limpiarlo", async () => {
    const user = await createAuthUser({ role: "admin" });
    const items = JSON.stringify([rule("email", hash())]);
    for (const who of [null, user]) {
      for (const sql of ["select public.rate_limit_fail($1::jsonb)", "select public.rate_limit_retry_after($1::jsonb)", "select public.rate_limit_clear($1::jsonb)"]) {
        expect(await expectPgError(asUser(who, (c) => c.query(sql, [items])))).toMatch(/permission denied/);
      }
      expect(await expectPgError(asUser(who, (c) => c.query("select count(*) from app.rate_limits")))).toMatch(/permission denied/);
    }
  });
});
