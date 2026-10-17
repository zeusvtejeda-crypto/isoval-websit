import { describe, expect, it } from "vitest";
import { FailureLimiter, clientIp } from "@/lib/security/rate-limit";

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
});

describe("clientIp", () => {
  it("toma la primera IP de x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers())).toBe("desconocida");
  });
});
