// @vitest-environment node
/**
 * src/proxy.ts: CSP con nonce, cookies de sesión sin caducidad propia,
 * encabezados anticaché de @supabase/ssr, redirección a /login con las cookies
 * renovadas o borradas y rutas prerenderizadas sin tocar la sesión.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: Record<string, unknown> };
type CookieMethods = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: CookieToSet[], headers: Record<string, string>) => void;
};

const ssr = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ssr);
vi.mock("@/lib/env", () => ({
  publicEnv: { supabaseUrl: "http://127.0.0.1:54321", supabaseAnonKey: "llave-publica" },
}));

import { proxy } from "@/proxy";

const NO_STORE = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};
const LONG_LIVED = { path: "/", sameSite: "lax", httpOnly: true, secure: false, maxAge: 400 * 24 * 60 * 60 };

/** Simula el cliente de Supabase: `run` decide qué cookies escribe y si hay sesión. */
function mockSupabase(run: (cookies: CookieMethods) => string | null) {
  ssr.createServerClient.mockImplementation((_url: string, _key: string, options: { cookies: CookieMethods }) => ({
    auth: {
      getClaims: async () => {
        const sub = run(options.cookies);
        return { data: sub ? { claims: { sub } } : null, error: null };
      },
    },
  }));
}

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers: cookie ? { cookie } : {} });
}

function nonceOf(csp: string | null): string | undefined {
  return csp?.match(/'nonce-([^']+)'/)?.[1];
}

beforeEach(() => {
  ssr.createServerClient.mockReset();
});

describe("proxy: rutas prerenderizadas", () => {
  it.each(["/offline", "/sin-acceso"])("%s no crea el cliente de Supabase ni fija cookies y usa la CSP sin nonce", async (path) => {
    const res = await proxy(request(path, "sb-127-auth-token=base64-viejo"));
    expect(ssr.createServerClient).not.toHaveBeenCalled();
    expect(res.headers.getSetCookie()).toEqual([]);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("nonce-");
    expect(res.headers.get("x-middleware-request-x-nonce")).toBeNull();
  });
});

describe("proxy: CSP con nonce", () => {
  it("pasa el mismo nonce a la página (encabezados de la solicitud) y a la respuesta; cambia en cada solicitud", async () => {
    mockSupabase(() => null);
    const res = await proxy(request("/directorio"));
    const csp = res.headers.get("content-security-policy");
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(nonceOf(res.headers.get("x-middleware-request-content-security-policy"))).toBe(nonce);

    const other = await proxy(request("/directorio"));
    expect(nonceOf(other.headers.get("content-security-policy"))).not.toBe(nonce);
  });
});

describe("proxy: cookies de sesión", () => {
  it("crea el cliente con cookies HttpOnly, SameSite=Lax (Secure solo en producción)", async () => {
    mockSupabase(() => "usuario-1");
    await proxy(request("/inicio"));
    expect(ssr.createServerClient).toHaveBeenCalledTimes(1);
    const options = ssr.createServerClient.mock.calls[0][2];
    expect(options.cookieOptions).toEqual({ httpOnly: true, secure: false, sameSite: "lax" });
  });

  it("al renovar: cookie sin Max-Age/Expires, encabezados anticaché, cookie nueva para la página y CSP conservada", async () => {
    mockSupabase(({ setAll }) => {
      setAll([{ name: "sb-127-auth-token", value: "base64-nuevo", options: LONG_LIVED }], NO_STORE);
      return "usuario-1";
    });
    const res = await proxy(request("/inicio", "sb-127-auth-token=base64-viejo"));

    expect(res.status).toBe(200);
    const [setCookie, ...rest] = res.headers.getSetCookie();
    expect(rest).toEqual([]);
    expect(setCookie).toMatch(/^sb-127-auth-token=base64-nuevo;/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).not.toMatch(/Max-Age|Expires/i);

    expect(res.headers.get("cache-control")).toBe(NO_STORE["Cache-Control"]);
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("x-middleware-request-cookie")).toContain("sb-127-auth-token=base64-nuevo");
    const nonce = nonceOf(res.headers.get("content-security-policy"));
    expect(nonce).toBeTruthy();
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("sin sesión en una ruta privada: redirige a /login con las cookies borradas y los encabezados anticaché", async () => {
    mockSupabase(({ setAll }) => {
      // Refresh token rechazado: @supabase/ssr borra la sesión.
      setAll(
        [
          { name: "sb-127-auth-token.0", value: "", options: { ...LONG_LIVED, maxAge: 0 } },
          { name: "sb-127-auth-token.1", value: "", options: { ...LONG_LIVED, maxAge: 0 } },
        ],
        NO_STORE,
      );
      return null;
    });
    const res = await proxy(request("/registro/qr?c=abc", "sb-127-auth-token.0=a; sb-127-auth-token.1=b"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/registro/qr?c=abc");

    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const [i, cookie] of cookies.entries()) {
      expect(cookie).toMatch(new RegExp(`^sb-127-auth-token\\.${i}=;`));
      expect(cookie).toMatch(/Max-Age=0/);
      expect(cookie).toMatch(/HttpOnly/i);
    }
    expect(res.headers.get("cache-control")).toBe(NO_STORE["Cache-Control"]);
  });

  it("sin sesión ni cookies: redirige sin Set-Cookie", async () => {
    mockSupabase(() => null);
    const res = await proxy(request("/inicio"));
    expect(res.status).toBe(307);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("sin sesión en rutas públicas o de API: no redirige", async () => {
    mockSupabase(() => null);
    for (const path of ["/", "/login", "/directorio/123", "/aviso-de-privacidad", "/api/asistencia"]) {
      const res = await proxy(request(path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });
});
