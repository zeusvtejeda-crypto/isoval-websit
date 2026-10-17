import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/security/safe-next";

describe("safeNextPath", () => {
  it("acepta rutas internas", () => {
    expect(safeNextPath("/guardias")).toBe("/guardias");
    expect(safeNextPath("/historial?desde=2026-10-01#tabla")).toBe("/historial?desde=2026-10-01#tabla");
  });

  it("rechaza redirecciones abiertas", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r\\evil.example", "https://evil.example", "evil", "", null, 42]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });
});
