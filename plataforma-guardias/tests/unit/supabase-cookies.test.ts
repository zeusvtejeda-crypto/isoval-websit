import { describe, expect, it } from "vitest";
import { AUTH_COOKIE_OPTIONS, asBrowserSessionCookie } from "@/lib/supabase/cookies";

describe("cookies de sesión de Supabase", () => {
  it("son HttpOnly y SameSite=Lax; Secure solo en producción", () => {
    expect(AUTH_COOKIE_OPTIONS).toEqual({ httpOnly: true, sameSite: "lax", secure: false });
  });

  it("una cookie con valor pierde maxAge y expires (cookie de sesión del navegador) y conserva lo demás", () => {
    const cookie = asBrowserSessionCookie({
      name: "sb-127-auth-token",
      value: "base64-abc",
      options: { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 400 * 24 * 60 * 60, expires: new Date(2030, 0, 1) },
    });
    expect(cookie).toEqual({
      name: "sb-127-auth-token",
      value: "base64-abc",
      options: { path: "/", httpOnly: true, sameSite: "lax", secure: true },
    });
  });

  it("una eliminación (valor vacío) conserva maxAge 0 para que el navegador la borre", () => {
    const deletion = { name: "sb-127-auth-token.0", value: "", options: { path: "/", httpOnly: true, maxAge: 0 } };
    expect(asBrowserSessionCookie(deletion)).toEqual(deletion);
  });
});
