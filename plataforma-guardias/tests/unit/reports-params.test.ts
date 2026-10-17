import { describe, expect, it } from "vitest";
import {
  MAX_RANGE_DAYS,
  daysInclusive,
  exportHref,
  filtersToSearchParams,
  parseExportParams,
  parseReportFilters,
  type ExportRequester,
} from "@/lib/reports/params";

const TODAY = "2026-10-17";
const OWN = "b0000000-0000-4000-8000-0000000000aa";
const OTHER = "b0000000-0000-4000-8000-0000000000bb";
const SEDE = "d0000000-0000-4000-8000-000000000001";

const worker: ExportRequester = { role: "trabajador", workerId: OWN };
const coordinator: ExportRequester = { role: "coordinador", workerId: null };
const coordinatorWithWorker: ExportRequester = { role: "coordinador", workerId: OWN };
const admin: ExportRequester = { role: "admin", workerId: null };

function sp(params: Record<string, string>) {
  return new URLSearchParams(params);
}

describe("parseExportParams", () => {
  it("exige un formato válido", () => {
    const missing = parseExportParams(sp({ desde: "2026-10-01", hasta: "2026-10-07" }), admin, TODAY);
    expect(missing).toMatchObject({ ok: false, status: 400 });
    expect(parseExportParams(sp({ formato: "csv" }), admin, TODAY)).toMatchObject({ ok: false, status: 400 });
    expect(parseExportParams(sp({ formato: "XLSX" }), admin, TODAY)).toMatchObject({ ok: true, format: "xlsx" });
    expect(parseExportParams(sp({ formato: "pdf" }), admin, TODAY)).toMatchObject({ ok: true, format: "pdf" });
  });

  it("usa los últimos 7 días si no hay fechas", () => {
    const r = parseExportParams(sp({ formato: "xlsx" }), admin, TODAY);
    expect(r.ok && r.filters).toMatchObject({ desde: "2026-10-11", hasta: "2026-10-17" });
  });

  it("rechaza fechas inválidas o invertidas", () => {
    expect(parseExportParams(sp({ formato: "xlsx", desde: "2026-02-31" }), admin, TODAY)).toMatchObject({ ok: false, status: 400 });
    expect(parseExportParams(sp({ formato: "xlsx", hasta: "17/10/2026" }), admin, TODAY)).toMatchObject({ ok: false, status: 400 });
    const inverted = parseExportParams(sp({ formato: "xlsx", desde: "2026-10-10", hasta: "2026-10-01" }), admin, TODAY);
    expect(inverted).toMatchObject({ ok: false, status: 400 });
  });

  it("limita el rango a 93 días con un mensaje claro", () => {
    // 2026-07-17 → 2026-10-17 = 93 días incluidos.
    expect(daysInclusive("2026-07-17", "2026-10-17")).toBe(93);
    expect(parseExportParams(sp({ formato: "pdf", desde: "2026-07-17", hasta: "2026-10-17" }), admin, TODAY).ok).toBe(true);
    const tooLong = parseExportParams(sp({ formato: "pdf", desde: "2026-07-16", hasta: "2026-10-17" }), admin, TODAY);
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.status).toBe(400);
      expect(tooLong.message).toContain(`${MAX_RANGE_DAYS} días`);
      expect(tooLong.message).toContain("94");
    }
  });

  it("valida sede, estado y estado de asistencia", () => {
    expect(parseExportParams(sp({ formato: "xlsx", sede: "no-es-uuid" }), admin, TODAY)).toMatchObject({ ok: false, status: 400 });
    expect(parseExportParams(sp({ formato: "xlsx", estado: "100" }), admin, TODAY)).toMatchObject({ ok: false, status: 400 });
    expect(parseExportParams(sp({ formato: "xlsx", asistencia: "mejor" }), admin, TODAY)).toMatchObject({ ok: false, status: 400 });
    const ok = parseExportParams(sp({ formato: "xlsx", sede: SEDE.toUpperCase(), estado: "18", asistencia: "registro_incompleto" }), admin, TODAY);
    expect(ok.ok && ok.filters).toMatchObject({ facilityId: SEDE, stateId: 18, attendance: "registro_incompleto" });
  });

  it("fuerza SIEMPRE el registro propio para el rol trabajador", () => {
    for (const trabajador of [undefined, "yo", OTHER, "basura"]) {
      const params: Record<string, string> = { formato: "xlsx" };
      if (trabajador) params.trabajador = trabajador;
      const r = parseExportParams(sp(params), worker, TODAY);
      expect(r).toMatchObject({ ok: true, forcedOwn: true });
      expect(r.ok && r.filters.workerId).toBe(OWN);
    }
  });

  it("rechaza (403) a un trabajador sin registro vinculado", () => {
    const r = parseExportParams(sp({ formato: "xlsx", trabajador: OTHER }), { role: "trabajador", workerId: null }, TODAY);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("«yo» para personal de coordinación usa su propio registro, si existe", () => {
    const own = parseExportParams(sp({ formato: "pdf", trabajador: "yo" }), coordinatorWithWorker, TODAY);
    expect(own).toMatchObject({ ok: true, forcedOwn: false });
    expect(own.ok && own.filters.workerId).toBe(OWN);
    expect(parseExportParams(sp({ formato: "pdf", trabajador: "yo" }), coordinator, TODAY)).toMatchObject({ ok: false, status: 400 });
  });

  it("personal de gestión puede filtrar por cualquier trabajador (RLS limita los datos)", () => {
    const r = parseExportParams(sp({ formato: "xlsx", trabajador: OTHER }), coordinator, TODAY);
    expect(r.ok && r.filters.workerId).toBe(OTHER);
    expect(parseExportParams(sp({ formato: "xlsx", trabajador: "todos" }), coordinator, TODAY)).toMatchObject({ ok: false, status: 400 });
    const none = parseExportParams(sp({ formato: "xlsx" }), coordinator, TODAY);
    expect(none.ok && none.filters.workerId).toBeNull();
  });

  it("acepta objetos de searchParams de Next (primer valor de arreglos)", () => {
    const r = parseExportParams({ formato: ["pdf", "xlsx"], desde: "2026-10-01", hasta: "2026-10-05" }, admin, TODAY);
    expect(r).toMatchObject({ ok: true, format: "pdf", filters: { desde: "2026-10-01", hasta: "2026-10-05" } });
  });
});

describe("parseReportFilters (páginas)", () => {
  it("por omisión muestra los últimos 7 días sin avisos", () => {
    const r = parseReportFilters({}, TODAY);
    expect(r.filters).toEqual({ desde: "2026-10-11", hasta: "2026-10-17", facilityId: null, stateId: null, workerId: null, attendance: "" });
    expect(r.notices).toEqual([]);
    expect(r.page).toBe(1);
  });

  it("acepta otro valor por omisión (historial individual: 30 días)", () => {
    expect(parseReportFilters({}, TODAY, { defaultDays: 30 }).filters.desde).toBe("2026-09-18");
  });

  it("corrige valores inválidos y avisa", () => {
    const r = parseReportFilters({ desde: "2026-10-15", hasta: "2026-10-01", sede: "x", estado: "abc", trabajador: "zzz", asistencia: "peor", pagina: "-3" }, TODAY);
    expect(r.filters).toMatchObject({ desde: "2026-10-01", hasta: "2026-10-15", facilityId: null, stateId: null, workerId: null, attendance: "" });
    expect(r.notices.length).toBe(5);
    expect(r.page).toBe(1);
  });

  it("ajusta periodos mayores a 93 días", () => {
    const r = parseReportFilters({ desde: "2026-01-01", hasta: "2026-10-17" }, TODAY);
    expect(daysInclusive(r.filters.desde, r.filters.hasta)).toBe(MAX_RANGE_DAYS);
    expect(r.filters.hasta).toBe("2026-10-17");
    expect(r.notices.some((n) => n.includes("93"))).toBe(true);
  });
});

describe("enlaces con filtros", () => {
  it("conserva los filtros en los enlaces de exportación", () => {
    const filters = { desde: "2026-10-11", hasta: "2026-10-17", facilityId: SEDE, stateId: 18, workerId: OTHER, attendance: "finalizada" as const };
    const href = exportHref(filters, "pdf");
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/api/exportar");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      formato: "pdf",
      desde: "2026-10-11",
      hasta: "2026-10-17",
      sede: SEDE,
      estado: "18",
      trabajador: OTHER,
      asistencia: "finalizada",
    });
    // Ida y vuelta: lo que genera el enlace lo acepta la exportación.
    const back = parseExportParams(url.searchParams, admin, TODAY);
    expect(back.ok && back.filters).toEqual(filters);
  });

  it("omite filtros vacíos", () => {
    expect(filtersToSearchParams({ desde: "2026-10-11", hasta: "2026-10-17", facilityId: null, attendance: "" }, { pagina: 2 }).toString()).toBe(
      "pagina=2&desde=2026-10-11&hasta=2026-10-17",
    );
  });
});
