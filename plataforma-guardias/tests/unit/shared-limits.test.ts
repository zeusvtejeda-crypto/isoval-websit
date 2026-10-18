import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { emailLimiter, ipLimiter, loginKeys, pairLimiter, passwordChangeLimiter } from "@/lib/security/rate-limit";
import {
  isAuthServiceError,
  recordLoginFailure,
  recordLoginSuccess,
  refundLoginAttempt,
  reserveLoginAttempt,
  reservePasswordChange,
} from "@/lib/security/shared-limits";

type Sent = { scope: string; key: string; max?: number; window_ms?: number; block_ms?: number; reserve?: boolean };
const sent = (call: number) => (rpc.mock.calls[call][1] as { p_items: Sent[] }).p_items;
const unique = (name: string) => `${name}-${Math.random().toString(36).slice(2)}@ejemplo.test`;

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

  it("reserva el intento antes de verificar: solo huellas HMAC, combinación y correo con reserva, la IP solo se consulta", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    expect(await reserveLoginAttempt(loginKeys("203.0.113.7", unique("persona")))).toBe(0);
    expect(rpc).toHaveBeenCalledWith("rate_limit_attempt", expect.anything());
    const byScope = Object.fromEntries(sent(0).map((i) => [i.scope, i]));
    expect(Object.keys(byScope).sort()).toEqual(["email", "ip", "pair"]);
    for (const i of sent(0)) {
      expect(i.key).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(i)).not.toMatch(/ejemplo\.test|203\.0\.113/);
    }
    expect(byScope.pair).toMatchObject({ reserve: true, max: pairLimiter.maxFailures, window_ms: pairLimiter.windowMs, block_ms: pairLimiter.blockMs });
    expect(byScope.email).toMatchObject({ reserve: true, max: emailLimiter.maxFailures });
    expect(byScope.ip).toMatchObject({ reserve: false, max: ipLimiter.maxFailures });
  });

  it("un fallo de contraseña solo cuenta la IP; un error del servicio reembolsa combinación y correo; acertar los limpia", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const keys = loginKeys("203.0.113.8", unique("bien"));
    await recordLoginFailure(keys);
    await refundLoginAttempt(keys);
    await recordLoginSuccess(keys);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["rate_limit_fail", "rate_limit_refund", "rate_limit_clear"]);
    expect(sent(0).map((i) => i.scope)).toEqual(["ip"]);
    expect(sent(1).map((i) => i.scope).sort()).toEqual(["email", "pair"]);
    expect(sent(2).map((i) => i.scope).sort()).toEqual(["email", "pair"]); // nunca la IP
  });

  it("la espera la decide la base cuando responde, aunque la memoria de la instancia diga otra cosa", async () => {
    rpc.mockResolvedValue({ data: 120_000, error: null });
    expect(await reserveLoginAttempt(loginKeys("198.51.100.1", unique("otra")))).toBe(120_000);

    // Memoria bloqueada (fallos vistos solo por esta instancia) y base sin bloqueo: manda la base.
    const keys = loginKeys("198.51.100.2", unique("memoria-vieja"));
    for (let i = 0; i < pairLimiter.maxFailures; i++) pairLimiter.attempt(keys.pair as string);
    rpc.mockResolvedValue({ data: 0, error: null });
    expect(await reserveLoginAttempt(keys)).toBe(0);
  });

  it("si la base no responde, limita con los contadores en memoria (también con solicitudes simultáneas)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "sin conexión" } });
    const keys = loginKeys("192.0.2.9", unique("memoria"));
    const waits = await Promise.all(Array.from({ length: pairLimiter.maxFailures + 4 }, () => reserveLoginAttempt(keys)));
    expect(waits.filter((w) => w === 0)).toHaveLength(pairLimiter.maxFailures);

    rpc.mockRejectedValue(new Error("fetch failed"));
    const userId = `u-${Math.random()}`;
    const pwd = await Promise.all(Array.from({ length: passwordChangeLimiter.maxFailures + 2 }, () => reservePasswordChange(userId)));
    expect(pwd.filter((w) => w === 0)).toHaveLength(passwordChangeLimiter.maxFailures);
  });

  it("sin llave de servicio no llama a la base", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await reserveLoginAttempt(loginKeys(null, unique("sin-llave")))).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("distingue errores del servicio de acceso de credenciales incorrectas", () => {
    expect(isAuthServiceError({ status: 400 })).toBe(false);
    expect(isAuthServiceError(null)).toBe(false);
    for (const status of [0, 429, 500, 503]) expect(isAuthServiceError({ status })).toBe(true);
    expect(isAuthServiceError({})).toBe(true);
  });
});
