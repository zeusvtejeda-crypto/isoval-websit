import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { emailLimiter, ipLimiter, loginKeys, pairLimiter, passwordChangeLimiter } from "@/lib/security/rate-limit";
import {
  loginWait,
  passwordChangeWait,
  recordLoginFailure,
  recordLoginSuccess,
  recordPasswordChangeFailure,
} from "@/lib/security/shared-limits";

type Sent = { scope: string; key: string; max?: number; window_ms?: number; block_ms?: number };
const sent = (call: number) => (rpc.mock.calls[call][1] as { p_items: Sent[] }).p_items;

describe("límite de intentos compartido (Postgres)", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "llave-de-prueba");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("envía solo huellas HMAC (nunca el correo ni la IP) con las mismas reglas que en memoria", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    const keys = loginKeys("203.0.113.7", `persona-${Math.random()}@ejemplo.test`);
    await recordLoginFailure(keys);
    expect(rpc).toHaveBeenCalledWith("rate_limit_fail", expect.anything());
    const items = sent(0);
    expect(items.map((i) => i.scope).sort()).toEqual(["email", "ip", "pair"]);
    for (const i of items) {
      expect(i.key).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(i)).not.toMatch(/ejemplo\.test|203\.0\.113/);
    }
    const byScope = Object.fromEntries(items.map((i) => [i.scope, i]));
    expect(byScope.pair).toMatchObject({ max: pairLimiter.maxFailures, window_ms: pairLimiter.windowMs, block_ms: pairLimiter.blockMs });
    expect(byScope.ip).toMatchObject({ max: ipLimiter.maxFailures });
    expect(byScope.email).toMatchObject({ max: emailLimiter.maxFailures });
  });

  it("usa el bloqueo que informe la base aunque esta instancia no haya visto fallos", async () => {
    rpc.mockResolvedValue({ data: 120_000, error: null });
    expect(await loginWait(loginKeys("198.51.100.1", `otra-${Math.random()}@ejemplo.test`))).toBe(120_000);
    expect(rpc).toHaveBeenCalledWith("rate_limit_retry_after", expect.anything());
  });

  it("si la base no responde, limita con los contadores en memoria de la instancia", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "sin conexión" } });
    const keys = loginKeys("192.0.2.9", `memoria-${Math.random()}@ejemplo.test`);
    for (let i = 0; i < pairLimiter.maxFailures; i++) await recordLoginFailure(keys);
    expect(await loginWait(keys)).toBeGreaterThan(0);

    rpc.mockRejectedValue(new Error("fetch failed"));
    const userId = `u-${Math.random()}`;
    for (let i = 0; i < passwordChangeLimiter.maxFailures; i++) await recordPasswordChangeFailure(userId);
    expect(await passwordChangeWait(userId)).toBeGreaterThan(0);
  });

  it("acertar limpia la combinación y el correo, nunca la IP", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await recordLoginSuccess(loginKeys("203.0.113.8", `bien-${Math.random()}@ejemplo.test`));
    expect(rpc).toHaveBeenCalledWith("rate_limit_clear", expect.anything());
    expect(sent(0).map((i) => i.scope).sort()).toEqual(["email", "pair"]);
  });

  it("sin llave de servicio no llama a la base", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await loginWait(loginKeys(null, `sin-llave-${Math.random()}@ejemplo.test`))).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});
