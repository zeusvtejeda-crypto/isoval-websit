import { describe, expect, it } from "vitest";
import { FailureLimiter, clientIp, ipSubject, loginKeys } from "@/lib/security/rate-limit";

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

describe("FailureLimiter: reserva y reembolso", () => {
  it("reserva antes de verificar: el intento N bloquea los siguientes; un reembolso lo libera", () => {
    const l = new FailureLimiter(3, 60_000, 120_000);
    expect([l.attempt("k", 0), l.attempt("k", 1), l.attempt("k", 2)]).toEqual([0, 0, 0]);
    expect(l.attempt("k", 3)).toBeGreaterThan(0); // bloqueado: no cuenta más
    l.refund("k", 4); // el tercer intento no llegó a verificarse
    expect(l.retryAfter("k", 5)).toBe(0);
    expect(l.attempt("k", 6)).toBe(0);
    expect(l.attempt("k", 7)).toBeGreaterThan(0);
  });

  it("al vencer el bloqueo vuelve a contar desde cero y el éxito limpia", () => {
    const l = new FailureLimiter(2, 60_000, 1_000);
    l.attempt("k", 0);
    l.attempt("k", 1);
    expect(l.attempt("k", 500)).toBeGreaterThan(0);
    expect(l.attempt("k", 1_002)).toBe(0);
    expect(l.attempt("k", 1_003)).toBe(0);
    expect(l.retryAfter("k", 1_004)).toBeGreaterThan(0);
    l.succeed("k");
    expect(l.attempt("k", 1_005)).toBe(0);
  });
});

describe("ipSubject", () => {
  it("IPv4 tal cual, IPv4 dentro de IPv6 como IPv4 e IPv6 agrupada por /64", () => {
    expect(ipSubject("203.0.113.5")).toBe("203.0.113.5");
    expect(ipSubject("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(ipSubject("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ipSubject("2001:0DB8:0001:0002:ffff:eeee:dddd:cccc")).toBe("2001:db8:1:2::/64");
    expect(ipSubject("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(ipSubject("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("direcciones distintas de la misma red /64 comparten las claves de límite", () => {
    const a = loginKeys("2001:db8:aa:bb::1", "a@b.mx");
    const b = loginKeys("2001:db8:aa:bb:1234:5678:9abc:def0", "a@b.mx");
    expect(a).toEqual(b);
    expect(loginKeys("2001:db8:aa:bc::1", "a@b.mx").ip).not.toBe(a.ip);
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
