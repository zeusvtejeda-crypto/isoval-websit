import { describe, expect, it } from "vitest";
import { FailureLimiter, clientIp, loginKeys } from "@/lib/security/rate-limit";

describe("FailureLimiter", () => {
  it("bloquea tras N fallos dentro de la ventana y se libera al vencer", () => {
    const l = new FailureLimiter(3, 60_000, 120_000);
    const t = 1_000_000;
    l.fail("a", t);
    l.fail("a", t + 1);
    expect(l.retryAfter("a", t + 2)).toBe(0);
    l.fail("a", t + 2);
    expect(l.retryAfter("a", t + 3)).toBeGreaterThan(0);
    expect(l.retryAfter("a", t + 2 + 120_001)).toBe(0);
  });

  it("los fallos viejos salen de la ventana y el éxito limpia", () => {
    const l = new FailureLimiter(2, 1_000, 5_000);
    l.fail("b", 0);
    l.fail("b", 2_000);
    expect(l.retryAfter("b", 2_001)).toBe(0);
    l.succeed("b");
    l.fail("b", 3_000);
    expect(l.retryAfter("b", 3_001)).toBe(0);
  });

  it("al llenarse nunca desaloja un bloqueo vigente", () => {
    const l = new FailureLimiter(1, 60_000, 600_000, 3);
    l.fail("victima", 0); // bloqueada
    expect(l.retryAfter("victima", 1)).toBeGreaterThan(0);
    for (let i = 0; i < 50; i++) l.fail(`basura-${i}`, 10 + i);
    expect(l.retryAfter("victima", 100)).toBeGreaterThan(0);
    expect(l.size).toBeLessThanOrEqual(3);
  });
});

describe("clientIp", () => {
  it("no confía en x-forwarded-for sin proxies declarados", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), 0)).toBeNull();
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.5" }), 0)).toBe("203.0.113.5");
  });

  it("con un proxy de confianza toma la entrada que agregó ese proxy (la última)", () => {
    // El cliente puede falsificar el inicio de la cadena; el proxy agrega la IP real al final.
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.5" }), 1)).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.5, 10.0.0.2" }), 2)).toBe("203.0.113.5");
  });
});

describe("claves de inicio de sesión", () => {
  it("sin IP confiable no crea claves por IP ni por combinación", () => {
    expect(loginKeys(null, "a@b.mx")).toEqual({ pair: null, ip: null, email: "email:a@b.mx" });
    expect(loginKeys("203.0.113.5", "a@b.mx").pair).toBe("pair:203.0.113.5|a@b.mx");
  });
});
