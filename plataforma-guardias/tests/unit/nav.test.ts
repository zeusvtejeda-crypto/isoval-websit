import { describe, expect, it } from "vitest";
import { navFor, type NavItem } from "@/lib/nav";

const labels = (items: NavItem[]) => items.map((i) => i.label);

/** Navegación de coordinación y administración según la especificación (§10). */
const STAFF = ["Inicio", "Mapa y directorio", "Trabajadores", "Guardias", "En servicio", "Historial y reportes", "Administración"];
/** Navegación del trabajador según la especificación (§10). */
const WORKER = ["Mi guardia", "Registrar entrada o salida", "Mi historial"];

describe("navFor", () => {
  it("administración y coordinación: exactamente los apartados de la especificación, en orden", () => {
    for (const role of ["admin", "coordinador"] as const) {
      expect(labels(navFor(role, false).primary)).toEqual(STAFF);
      expect(navFor(role, false).personal).toEqual([]);
    }
  });

  it("coordinación o administración que también cubre guardias ve además su apartado personal", () => {
    for (const role of ["admin", "coordinador"] as const) {
      const nav = navFor(role, true);
      expect(labels(nav.primary)).toEqual(STAFF);
      expect(labels(nav.personal)).toEqual(WORKER);
    }
  });

  it("auditoría: los mismos apartados de consulta y nunca los de registro personal", () => {
    expect(labels(navFor("auditor", false).primary)).toEqual(STAFF);
    expect(navFor("auditor", false).personal).toEqual([]);
    // Aunque existiera un vínculo con un trabajador (la base de datos lo impide), no hay registro propio.
    expect(navFor("auditor", true).personal).toEqual([]);
  });

  it("trabajador: solo su guardia, el registro y su historial", () => {
    for (const hasWorker of [true, false]) {
      const nav = navFor("trabajador", hasWorker);
      expect(labels(nav.primary)).toEqual(WORKER);
      expect(nav.personal).toEqual([]);
    }
    expect(navFor("trabajador", true).primary.map((i) => i.href)).toEqual(["/mi-guardia", "/registro", "/mi-historial"]);
  });
});
