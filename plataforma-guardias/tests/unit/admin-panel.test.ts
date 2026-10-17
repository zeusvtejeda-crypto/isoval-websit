import { describe, expect, it } from "vitest";
import { adminPanelCards, panelDescription } from "@/lib/admin/panel";

const titles = (role: Parameters<typeof adminPanelCards>[0]) => adminPanelCards(role).map((c) => c.title);

describe("adminPanelCards", () => {
  it("administración ve todas las herramientas en el orden indicado", () => {
    expect(titles("admin")).toEqual([
      "Instalaciones",
      "Categorías",
      "Catálogos geográficos",
      "Importar instalaciones",
      "Importar trabajadores",
      "Usuarios y permisos",
      "Configuración",
      "Bitácora",
      "Correcciones",
    ]);
    const hrefs = adminPanelCards("admin").map((c) => c.href);
    expect(hrefs).toContain("/administracion/instalaciones/importar");
    expect(hrefs).toContain("/trabajadores/importar");
    expect(hrefs).toContain("/correcciones");
    expect(hrefs).toContain("/administracion/catalogos");
  });

  it("coordinación ve correcciones, importación de trabajadores y bitácora de sus sedes", () => {
    expect(titles("coordinador")).toEqual(["Correcciones", "Importar trabajadores", "Bitácora"]);
    const bitacora = adminPanelCards("coordinador").find((c) => c.key === "bitacora");
    expect(bitacora?.description).toMatch(/tus sedes/);
    expect(adminPanelCards("coordinador").some((c) => c.href.startsWith("/administracion/usuarios"))).toBe(false);
    expect(adminPanelCards("coordinador").some((c) => c.href.startsWith("/administracion/catalogos"))).toBe(false);
  });

  it("auditoría solo ve la bitácora", () => {
    expect(titles("auditor")).toEqual(["Bitácora"]);
  });

  it("trabajadores no tienen tarjetas", () => {
    expect(adminPanelCards("trabajador")).toEqual([]);
    expect(panelDescription("trabajador")).toBe("");
  });

  it("las claves son únicas", () => {
    const keys = adminPanelCards("admin").map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
