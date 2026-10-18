import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, createNonce, originOf, type CspEnv } from "@/lib/csp";
import nextConfig from "../../next.config";

const prod: CspEnv = {
  isDev: false,
  supabaseUrl: "https://abcdefgh.supabase.co",
  tileUrl: "https://{s}.tile.example.com/{z}/{x}/{y}.png?key=1",
  siteUrl: "https://guardias.example.mx",
};

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

describe("Content-Security-Policy", () => {
  it("con nonce: script-src usa el nonce y 'strict-dynamic', sin 'unsafe-inline' ni 'unsafe-eval'", () => {
    const d = directives(buildContentSecurityPolicy("bm9uY2UtZGUtcHJ1ZWJh", prod));
    expect(d["script-src"]).toEqual(["'self'", "'nonce-bm9uY2UtZGUtcHJ1ZWJh'", "'strict-dynamic'"]);
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
    // Leaflet usa atributos style.
    expect(d["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d["img-src"]).toContain("https://*.tile.example.com");
    expect(d["connect-src"]).toEqual(["'self'", "https://abcdefgh.supabase.co"]);
    expect(d["upgrade-insecure-requests"]).toEqual([]);
    expect(d["frame-src"]).toBeUndefined();
  });

  it("sin nonce (páginas prerenderizadas): conserva 'unsafe-inline' y no usa 'strict-dynamic'", () => {
    const d = directives(buildContentSecurityPolicy(null, prod));
    expect(d["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("en desarrollo agrega 'unsafe-eval' y sin HTTPS no fuerza upgrade-insecure-requests", () => {
    const d = directives(buildContentSecurityPolicy("abc=", { isDev: true, siteUrl: "http://localhost:3000" }));
    expect(d["script-src"]).toContain("'unsafe-eval'");
    expect(d["upgrade-insecure-requests"]).toBeUndefined();
    // Sin plantilla configurada se permiten las teselas de OpenStreetMap.
    expect(d["img-src"]).toContain("https://tile.openstreetmap.org");
    expect(d["connect-src"]).toEqual(["'self'"]);
  });

  it("con NEXT_PUBLIC_TURNSTILE_SITE_KEY permite Cloudflare Turnstile en script-src, frame-src y connect-src", () => {
    const d = directives(buildContentSecurityPolicy("abc=", { ...prod, turnstileSiteKey: "0x4AAAA" }));
    expect(d["script-src"]).toContain("https://challenges.cloudflare.com");
    expect(d["frame-src"]).toEqual(["'self'", "https://challenges.cloudflare.com"]);
    expect(d["connect-src"]).toContain("https://challenges.cloudflare.com");
  });

  it("el nonce es base64 de 128 bits, distinto en cada llamada y aceptado por Next", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    // Mismo patrón que next/dist/server/app-render/get-script-nonce-from-header.js.
    expect(`'nonce-${a}'`).toMatch(/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/);
  });

  it("originOf convierte plantillas de teselas y URLs en orígenes", () => {
    expect(originOf("https://{s}.tile.openstreetmap.fr/{z}/{x}/{y}.png")).toBe("https://*.tile.openstreetmap.fr");
    expect(originOf("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
    expect(originOf("no es url")).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});

describe("encabezados de seguridad de next.config.ts", () => {
  it("agrega COOP y CORP same-origin a todas las rutas y deja la CSP de las páginas al proxy", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!;
    const byKey = Object.fromEntries(all.headers.map((h) => [h.key, h.value]));
    expect(byKey["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(byKey["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    // Una segunda CSP global se combinaría con la del proxy (el navegador aplica ambas).
    expect(byKey["Content-Security-Policy"]).toBeUndefined();

    const sw = rules.find((r) => r.source === "/sw.js")!;
    const swCsp = sw.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    expect(swCsp).toContain("default-src 'self'");
  });
});
