import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRUSTED_DEVICE_MAX_AGE, isTrustedDevice, trustedDeviceToken } from "@/lib/security/trusted-device";
import { emailLimiter, loginAttempt, loginKeys } from "@/lib/security/rate-limit";

describe("dispositivo de confianza", () => {
  beforeEach(() => vi.stubEnv("DEVICE_COOKIE_SECRET", "secreto-de-prueba-largo"));
  afterEach(() => vi.unstubAllEnvs());

  it("la cookie vale solo para su correo, sin alterarse y mientras está vigente", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    const token = trustedDeviceToken("Ana@Ejemplo.test", now) as string;
    expect(token).not.toMatch(/ana|ejemplo/i); // solo una huella del correo
    expect(isTrustedDevice(token, "ana@ejemplo.test", now + 1000)).toBe(true);
    expect(isTrustedDevice(token, "otra@ejemplo.test", now + 1000)).toBe(false);
    expect(isTrustedDevice(token.slice(0, -2) + "xx", "ana@ejemplo.test", now + 1000)).toBe(false);
    expect(isTrustedDevice(token, "ana@ejemplo.test", now + (TRUSTED_DEVICE_MAX_AGE + 60) * 1000)).toBe(false);
    vi.stubEnv("DEVICE_COOKIE_SECRET", "otro-secreto");
    expect(isTrustedDevice(token, "ana@ejemplo.test", now + 1000)).toBe(false);
  });

  it("sin secreto no se emite ni se acepta", () => {
    vi.stubEnv("DEVICE_COOKIE_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(trustedDeviceToken("ana@ejemplo.test")).toBeNull();
    expect(isTrustedDevice("v1.a.b.c", "ana@ejemplo.test")).toBe(false);
  });

  it("un correo bloqueado por intentos ajenos sigue entrando desde un dispositivo de confianza", () => {
    const email = `bloqueada-${Math.random()}@ejemplo.test`;
    const now = Date.now();
    for (let i = 0; i < emailLimiter.maxFailures; i++) loginAttempt(loginKeys(`198.51.100.${i % 250}`, email), now);
    const mine = loginKeys("203.0.113.77", email);
    expect(loginAttempt(mine, now)).toBeGreaterThan(0); // sin cookie: bloqueada
    expect(loginAttempt(mine, now, true)).toBe(0); // con cookie de dispositivo: puede intentar
  });
});
