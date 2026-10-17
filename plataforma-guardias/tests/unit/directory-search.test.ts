import { describe, expect, it } from "vitest";
import {
  buildLookupMaps,
  buildSearchIndex,
  compactSearch,
  filterFacilities,
  hasCoordinates,
  municipalitiesForState,
  normalizeSearch,
} from "@/lib/directory/search";
import {
  EMPTY_FILTERS,
  directoryHref,
  hasActiveFilters,
  parseDirectoryParams,
  pluralize,
  reconcileFilters,
} from "@/lib/directory/params";
import type { DirectoryFacility, DirectoryFilters, DirectoryLookups } from "@/lib/directory/types";

// Datos ficticios para las pruebas del directorio.
const LOOKUPS: DirectoryLookups = {
  categories: [
    { id: 1, slug: "hospitales", name: "Hospitales", color: "#14532d", active: true },
    { id: 2, slug: "umf", name: "Unidades de Medicina Familiar", color: "#166534", active: true },
    { id: 6, slug: "otras-instalaciones", name: "Otras instalaciones", color: "#4b5563", active: true },
    { id: 9, slug: "archivada", name: "Categoría archivada", color: "#000000", active: false },
  ],
  states: [
    { id: 14, name: "Jalisco", abbreviation: "JAL" },
    { id: 18, name: "Nayarit", abbreviation: "NAY" },
  ],
  municipalities: [
    { id: 117, stateId: 18, name: "Tepic" },
    { id: 120, stateId: 18, name: "Bahía de Banderas" },
    { id: 112, stateId: 18, name: "San Blas" },
    { id: 139, stateId: 14, name: "Guadalajara" },
  ],
};

function facility(partial: Partial<DirectoryFacility> & Pick<DirectoryFacility, "id" | "name">): DirectoryFacility {
  return {
    internalCode: `INS-${partial.id.slice(-6).padStart(6, "0")}`,
    unitKey: null,
    categoryId: 2,
    stateId: 18,
    municipalityId: 117,
    address: null,
    latitude: 21.5,
    longitude: -104.9,
    verified: false,
    isDemo: false,
    ...partial,
  };
}

const FACILITIES: DirectoryFacility[] = [
  facility({
    id: "a0000000-0000-4000-8000-000000000005",
    name: "Anexo administrativo de la UMF-24",
    unitKey: "ANX-01",
    categoryId: 6,
    municipalityId: 120,
  }),
  facility({
    id: "a0000000-0000-4000-8000-000000000001",
    name: "Hospital General de Zona 1",
    unitKey: "HGZ-01",
    categoryId: 1,
    municipalityId: 117,
    address: "Av. Insurgentes 100, Centro",
    latitude: 21.509,
    longitude: -104.889,
    verified: true,
  }),
  facility({
    id: "a0000000-0000-4000-8000-000000000002",
    name: "Unidad de Medicina Familiar 24",
    unitKey: "UMF-24",
    categoryId: 2,
    municipalityId: 120,
    address: "Calle Mérida 15",
    latitude: 20.801,
    longitude: -105.25,
  }),
  facility({
    id: "a0000000-0000-4000-8000-000000000003",
    name: "Clínica Peñasco",
    categoryId: 6,
    municipalityId: 112,
    address: "Domicilio conocido",
    latitude: null,
    longitude: null,
    isDemo: true,
  }),
  facility({
    id: "a0000000-0000-4000-8000-000000000004",
    name: "Oficina de representación Guadalajara",
    unitKey: "OFI-14",
    categoryId: 6,
    stateId: 14,
    municipalityId: 139,
    latitude: 20.67,
    longitude: -103.35,
  }),
];


const index = buildSearchIndex(FACILITIES, buildLookupMaps(LOOKUPS));
const names = (filters: Partial<DirectoryFilters>) => filterFacilities(index, { ...EMPTY_FILTERS, ...filters }).map((f) => f.name);

describe("normalizeSearch", () => {
  it("quita acentos, diéresis y mayúsculas, y simplifica espacios", () => {
    expect(normalizeSearch("  Bahía   de BANDERAS ")).toBe("bahia de banderas");
    expect(normalizeSearch("Peñasco, Güémez.")).toBe("penasco guemez");
    expect(normalizeSearch("Tépic")).toBe("tepic");
  });

  it("conserva el guion de las claves y elimina otros signos", () => {
    expect(normalizeSearch("Clave: DEMO-H01!")).toBe("clave demo-h01");
    expect(compactSearch("DEMO-H01")).toBe("demoh01");
    expect(normalizeSearch(null)).toBe("");
  });
});

describe("filterFacilities", () => {
  it("sin filtros devuelve todo en el orden original", () => {
    expect(names({})).toHaveLength(FACILITIES.length);
    expect(names({})[0]).toBe(FACILITIES[0].name);
  });

  it("busca por nombre sin importar acentos ni mayúsculas", () => {
    expect(names({ q: "penasco" })).toEqual(["Clínica Peñasco"]);
    expect(names({ q: "CLÍNICA PEÑASCO" })).toEqual(["Clínica Peñasco"]);
    expect(names({ q: "hospital" })).toEqual(["Hospital General de Zona 1"]);
  });

  it("busca por clave de unidad con o sin guion", () => {
    expect(names({ q: "HGZ-01" })).toEqual(["Hospital General de Zona 1"]);
    expect(names({ q: "hgz01" })).toEqual(["Hospital General de Zona 1"]);
    expect(names({ q: "hgz 01" })).toEqual(["Hospital General de Zona 1"]);
    expect(names({ q: "ofi-14" })).toEqual(["Oficina de representación Guadalajara"]);
  });

  it("ordena primero la clave de unidad exacta", () => {
    // El anexo menciona «UMF-24» en su nombre y aparece antes en la lista original.
    expect(names({ q: "umf-24" })).toEqual(["Unidad de Medicina Familiar 24", "Anexo administrativo de la UMF-24"]);
  });

  it("busca por municipio (con acentos) y por estado (nombre o abreviatura)", () => {
    expect(names({ q: "bahia de banderas" })).toEqual(["Anexo administrativo de la UMF-24", "Unidad de Medicina Familiar 24"]);
    expect(names({ q: "San Blas" })).toEqual(["Clínica Peñasco"]);
    expect(names({ q: "jalisco" })).toEqual(["Oficina de representación Guadalajara"]);
    expect(names({ q: "nay" })).toHaveLength(4);
  });

  it("busca por dirección", () => {
    expect(names({ q: "merida" })).toEqual(["Unidad de Medicina Familiar 24"]);
    expect(names({ q: "insurgentes" })).toEqual(["Hospital General de Zona 1"]);
  });

  it("exige todas las palabras (en cualquier campo)", () => {
    expect(names({ q: "medicina bahía" })).toEqual(["Unidad de Medicina Familiar 24"]);
    expect(names({ q: "medicina tepic" })).toEqual([]);
  });

  it("filtra por categoría, estado y municipio, combinables con el texto", () => {
    expect(names({ categoria: "hospitales" })).toEqual(["Hospital General de Zona 1"]);
    expect(names({ estado: 14 })).toEqual(["Oficina de representación Guadalajara"]);
    expect(names({ estado: 18, municipio: 120 })).toEqual(["Anexo administrativo de la UMF-24", "Unidad de Medicina Familiar 24"]);
    expect(names({ estado: 18, municipio: 120, categoria: "umf" })).toEqual(["Unidad de Medicina Familiar 24"]);
    expect(names({ categoria: "otras-instalaciones", q: "guadalajara" })).toEqual(["Oficina de representación Guadalajara"]);
    expect(names({ categoria: "hospitales", q: "penasco" })).toEqual([]);
  });

  it("detecta instalaciones sin coordenadas", () => {
    expect(FACILITIES.filter((f) => !hasCoordinates(f)).map((f) => f.name)).toEqual(["Clínica Peñasco"]);
  });
});

describe("parámetros de la URL", () => {
  it("lee filtros válidos", () => {
    expect(
      parseDirectoryParams({ q: "  Bahía  de banderas ", categoria: "umf", estado: "18", municipio: "120", vista: "mapa", limite: "100" }),
    ).toEqual({ q: "Bahía de banderas", categoria: "umf", estado: 18, municipio: 120, vista: "mapa", limite: 100 });
  });

  it("ignora valores inválidos sin lanzar errores", () => {
    expect(
      parseDirectoryParams({ categoria: "<script>", estado: "abc", municipio: "-3", vista: "satelite", limite: "0" }),
    ).toEqual({ q: "", categoria: "", estado: null, municipio: null, vista: "lista", limite: null });
    expect(parseDirectoryParams({ estado: "100" }).estado).toBeNull();
  });

  it("acepta URLSearchParams y toma el primer valor repetido", () => {
    expect(parseDirectoryParams(new URLSearchParams("q=tepic&estado=18&vista=mapa")).estado).toBe(18);
    expect(parseDirectoryParams({ q: ["uno", "dos"] }).q).toBe("uno");
    expect(parseDirectoryParams({ q: "x".repeat(500) }).q).toHaveLength(120);
  });

  it("los municipios dependen del estado", () => {
    // Municipio sin estado: se fija su estado.
    expect(reconcileFilters({ ...EMPTY_FILTERS, municipio: 139 }, LOOKUPS)).toMatchObject({ estado: 14, municipio: 139 });
    // Municipio de otro estado: se descarta.
    expect(reconcileFilters({ ...EMPTY_FILTERS, estado: 18, municipio: 139 }, LOOKUPS)).toMatchObject({ estado: 18, municipio: null });
    // Valores desconocidos: se descartan.
    expect(reconcileFilters({ q: "x", categoria: "no-existe", estado: 5, municipio: 99999 }, LOOKUPS)).toEqual({
      q: "x",
      categoria: "",
      estado: null,
      municipio: null,
    });
  });

  it("construye la URL omitiendo valores por omisión y es reversible", () => {
    expect(directoryHref(EMPTY_FILTERS)).toBe("/directorio");
    expect(directoryHref(EMPTY_FILTERS, { vista: "lista", limite: 50 })).toBe("/directorio");
    const filters: DirectoryFilters = { q: "Bahía & co", categoria: "umf", estado: 18, municipio: 120 };
    const href = directoryHref(filters, { vista: "mapa", limite: 150 });
    expect(href).toBe("/directorio?q=Bah%C3%ADa+%26+co&categoria=umf&estado=18&municipio=120&vista=mapa&limite=150");
    const back = parseDirectoryParams(new URLSearchParams(href.split("?")[1]));
    expect(back).toEqual({ ...filters, vista: "mapa", limite: 150 });
  });

  it("indica si hay filtros activos", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: "   " })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, estado: 18 })).toBe(true);
  });
});

describe("utilidades", () => {
  it("ordena los municipios del estado alfabéticamente", () => {
    expect(municipalitiesForState(LOOKUPS.municipalities, 18).map((m) => m.name)).toEqual(["Bahía de Banderas", "San Blas", "Tepic"]);
    expect(municipalitiesForState(LOOKUPS.municipalities, null)).toHaveLength(4);
  });

  it("pluraliza en español", () => {
    expect(pluralize(1, "instalación", "instalaciones")).toBe("1 instalación");
    expect(pluralize(0, "instalación", "instalaciones")).toBe("0 instalaciones");
    expect(pluralize(1500, "instalación", "instalaciones")).toBe("1,500 instalaciones");
  });
});
