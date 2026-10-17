import { describe, expect, it } from "vitest";
import {
  CATALOGS_PATH,
  DEFAULT_CATALOG_FILTERS,
  catalogsHref,
  cleanMunicipalityName,
  countByState,
  duplicateNameFailure,
  effectiveTimezone,
  filterMunicipalities,
  friendlyCatalogError,
  inegiCodeIssue,
  isRepeatedName,
  isValidInegiCode,
  municipalityFullCode,
  municipalityLabel,
  municipalityTimezoneSchema,
  newMunicipalitySchema,
  normalizeInegiCode,
  parseCatalogFilters,
  readMunicipalityTimezoneForm,
  readNewMunicipalityForm,
  readStateCoverageForm,
  readStateTimezoneForm,
  repeatedNames,
  sameNameMunicipalities,
  stateCode,
  stateCoverageSchema,
  stateTimezoneSchema,
  timezoneIssue,
  type MunicipalityRow,
} from "@/lib/admin/catalogs";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe("clave INEGI de municipio", () => {
  it("acepta 001 a 999 y rechaza 000 o formatos distintos", () => {
    expect(isValidInegiCode("001")).toBe(true);
    expect(isValidInegiCode("570")).toBe(true);
    for (const bad of ["000", "01", "1", "0001", "abc", "1a2", "", null, undefined]) {
      expect(isValidInegiCode(bad)).toBe(false);
    }
  });

  it("completa con ceros a la izquierda y quita espacios", () => {
    expect(normalizeInegiCode("7")).toBe("007");
    expect(normalizeInegiCode(" 12 ")).toBe("012");
    expect(normalizeInegiCode("208")).toBe("208");
    expect(normalizeInegiCode("1234")).toBeNull();
    expect(normalizeInegiCode("-1")).toBeNull();
    expect(normalizeInegiCode("")).toBeNull();
  });

  it("explica el problema de la clave", () => {
    expect(inegiCodeIssue("020")).toBeNull();
    expect(inegiCodeIssue("5")).toBeNull();
    expect(inegiCodeIssue("")).toMatch(/Escribe la clave INEGI/);
    expect(inegiCodeIssue("12a")).toMatch(/3 dígitos/);
    expect(inegiCodeIssue("0")).toMatch(/000 no es válida/);
  });
});

describe("zona horaria", () => {
  it("acepta zonas de México de la lista", () => {
    expect(timezoneIssue("America/Mexico_City")).toBeNull();
    expect(timezoneIssue("America/Bahia_Banderas")).toBeNull();
    expect(timezoneIssue("America/Tijuana")).toBeNull();
  });

  it("rechaza zonas inexistentes, vacías o fuera de México", () => {
    expect(timezoneIssue("")).toMatch(/Elige la zona/);
    expect(timezoneIssue("Marte/Olympus")).toMatch(/no es una zona horaria válida/);
    // Existe (isValidTimezone), pero no es de México.
    expect(timezoneIssue("Europe/Madrid")).toMatch(/zona horaria de México/);
  });

  it("pide escribir la zona como en la lista si solo difiere en mayúsculas", () => {
    expect(timezoneIssue("america/mexico_city")).toMatch(/America\/Mexico_City/);
  });

  it("calcula la zona efectiva del municipio", () => {
    expect(effectiveTimezone(null, "America/Mazatlan")).toEqual({ value: "America/Mazatlan", inherited: true });
    expect(effectiveTimezone("America/Bahia_Banderas", "America/Mazatlan")).toEqual({ value: "America/Bahia_Banderas", inherited: false });
  });
});

describe("formularios de entidades", () => {
  const reason = "Cobertura por convenio nuevo";

  it("cobertura activa: lee el valor enviado por el interruptor", () => {
    const on = stateCoverageSchema.safeParse(readStateCoverageForm(form({ state_id: "20", enabled: "1", reason })));
    expect(on.success && on.data).toEqual({ state_id: 20, enabled: true, reason });
    const off = stateCoverageSchema.safeParse(readStateCoverageForm(form({ state_id: "18", enabled: "0", reason })));
    expect(off.success && off.data).toEqual({ state_id: 18, enabled: false, reason });
    expect(stateCoverageSchema.safeParse(readStateCoverageForm(form({ state_id: "18", enabled: "si", reason }))).success).toBe(false);
    expect(stateCoverageSchema.safeParse(readStateCoverageForm(form({ state_id: "0", enabled: "1", reason }))).success).toBe(false);
    expect(stateCoverageSchema.safeParse(readStateCoverageForm(form({ state_id: "x", enabled: "1", reason }))).success).toBe(false);
  });

  it("zona por omisión: obligatoria y de México", () => {
    const ok = stateTimezoneSchema.safeParse(readStateTimezoneForm(form({ state_id: "2", default_timezone: "America/Tijuana", reason })));
    expect(ok.success && ok.data).toEqual({ state_id: 2, default_timezone: "America/Tijuana", reason });
    const empty = stateTimezoneSchema.safeParse(readStateTimezoneForm(form({ state_id: "2", default_timezone: "  ", reason })));
    expect(empty.success).toBe(false);
    const bad = stateTimezoneSchema.safeParse(readStateTimezoneForm(form({ state_id: "2", default_timezone: "UTC", reason })));
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].path).toEqual(["default_timezone"]);
  });

  it("todo cambio de entidad exige motivo de al menos 5 caracteres (bitácora)", () => {
    for (const r of [
      stateCoverageSchema.safeParse(readStateCoverageForm(form({ state_id: "20", enabled: "1" }))),
      stateCoverageSchema.safeParse(readStateCoverageForm(form({ state_id: "20", enabled: "1", reason: " abc " }))),
      stateTimezoneSchema.safeParse(readStateTimezoneForm(form({ state_id: "2", default_timezone: "America/Tijuana" }))),
    ]) {
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toEqual(["reason"]);
    }
  });
});

describe("formularios de municipios", () => {
  const reason = "Publicación del INEGI";

  it("zona del municipio: vacía significa «igual que la entidad»", () => {
    const inherit = municipalityTimezoneSchema.safeParse(
      readMunicipalityTimezoneForm(form({ state_id: "18", municipality_id: "20", timezone: "", reason })),
    );
    expect(inherit.success && inherit.data).toEqual({ state_id: 18, municipality_id: 20, timezone: null, reason });
    const own = municipalityTimezoneSchema.safeParse(
      readMunicipalityTimezoneForm(form({ state_id: "18", municipality_id: "20", timezone: "America/Bahia_Banderas", reason })),
    );
    expect(own.success && own.data.timezone).toBe("America/Bahia_Banderas");
    expect(municipalityTimezoneSchema.safeParse(readMunicipalityTimezoneForm(form({ state_id: "18", municipality_id: "-1", reason }))).success).toBe(false);
    expect(
      municipalityTimezoneSchema.safeParse(readMunicipalityTimezoneForm(form({ state_id: "18", municipality_id: "3", timezone: "Asia/Tokyo", reason })))
        .success,
    ).toBe(false);
    const noReason = municipalityTimezoneSchema.safeParse(readMunicipalityTimezoneForm(form({ state_id: "18", municipality_id: "20", timezone: "" })));
    expect(noReason.success).toBe(false);
    if (!noReason.success) expect(noReason.error.issues.map((i) => i.path[0])).toEqual(["reason"]);
  });

  it("alta: normaliza clave y nombre, zona opcional", () => {
    const r = newMunicipalitySchema.safeParse(
      readNewMunicipalityForm(form({ state_id: "20", inegi_code: " 7", name: "  San   Juan  Mixtepec ", timezone: "", reason })),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ state_id: 20, inegi_code: "007", name: "San Juan Mixtepec", timezone: null, allow_duplicate_name: false, reason });
    }
    const dup = newMunicipalitySchema.safeParse(
      readNewMunicipalityForm(form({ state_id: "20", inegi_code: "209", name: "San Juan Mixtepec", allow_duplicate_name: "on", reason })),
    );
    expect(dup.success && dup.data.allow_duplicate_name).toBe(true);
  });

  it("alta: marca cada campo inválido", () => {
    const r = newMunicipalitySchema.safeParse(readNewMunicipalityForm(form({ state_id: "20", inegi_code: "1234", name: "A", timezone: "Europe/Paris" })));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["inegi_code", "name", "timezone"]));
    const zero = newMunicipalitySchema.safeParse(readNewMunicipalityForm(form({ state_id: "20", inegi_code: "000", name: "Nuevo" })));
    expect(zero.success).toBe(false);
    const missing = newMunicipalitySchema.safeParse(readNewMunicipalityForm(form({ state_id: "20" })));
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["inegi_code", "name", "reason"]));
  });

  it("limpia espacios del nombre sin tocar acentos", () => {
    expect(cleanMunicipalityName("  Ahuacatlán  ")).toBe("Ahuacatlán");
    expect(cleanMunicipalityName("   ")).toBeUndefined();
    expect(cleanMunicipalityName(null)).toBeUndefined();
  });

  it("pide confirmar un nombre repetido mostrando las claves existentes", () => {
    const r = duplicateNameFailure([{ name: "San Juan Mixtepec", inegi_code: "208" }], "Oaxaca");
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.name).toBe("Ya existe «San Juan Mixtepec» (clave 208) en Oaxaca.");
    expect(r.fieldErrors.allow_duplicate_name).toMatch(/marca la casilla/);
  });
});

describe("filtros por URL", () => {
  it("lee la entidad y la búsqueda", () => {
    expect(parseCatalogFilters({})).toEqual(DEFAULT_CATALOG_FILTERS);
    expect(parseCatalogFilters({ entidad: "20", q: "  san   juan " })).toEqual({ stateId: 20, q: "san juan" });
    expect(parseCatalogFilters({ entidad: ["7", "8"] })).toEqual({ stateId: 7, q: "" });
    // Sin entidad válida, la búsqueda no aplica.
    expect(parseCatalogFilters({ entidad: "abc", q: "x" })).toEqual(DEFAULT_CATALOG_FILTERS);
    expect(parseCatalogFilters({ entidad: "0" })).toEqual(DEFAULT_CATALOG_FILTERS);
    expect(parseCatalogFilters({ entidad: "100" })).toEqual(DEFAULT_CATALOG_FILTERS);
    expect(parseCatalogFilters({ entidad: "20", q: "x".repeat(300) }).q).toHaveLength(100);
  });

  it("construye enlaces", () => {
    expect(catalogsHref()).toBe(CATALOGS_PATH);
    expect(catalogsHref({ stateId: 20 })).toBe("/administracion/catalogos?entidad=20");
    expect(catalogsHref({ stateId: 20, q: "san juan" })).toBe("/administracion/catalogos?entidad=20&q=san+juan");
    expect(catalogsHref({ q: "sin entidad" })).toBe(CATALOGS_PATH);
  });
});

describe("presentación de municipios", () => {
  const oaxaca: MunicipalityRow[] = [
    { id: 1, state_id: 20, inegi_code: "001", name: "Abejones", timezone: null },
    { id: 2, state_id: 20, inegi_code: "208", name: "San Juan Mixtepec", timezone: null },
    { id: 3, state_id: 20, inegi_code: "209", name: "San Juan Mixtepec", timezone: null },
    { id: 4, state_id: 20, inegi_code: "397", name: "Santa María Ixcatlán", timezone: null },
  ];

  it("cuenta municipios por entidad", () => {
    expect(countByState([{ state_id: 18 }, { state_id: 20 }, { state_id: 20 }])).toEqual({ 18: 1, 20: 2 });
    expect(countByState([])).toEqual({});
  });

  it("identifica nombres repetidos y los muestra con su clave", () => {
    const repeated = repeatedNames(oaxaca);
    expect(isRepeatedName(repeated, oaxaca[1])).toBe(true);
    expect(isRepeatedName(repeated, oaxaca[0])).toBe(false);
    expect(municipalityLabel(oaxaca[1], repeated)).toBe("San Juan Mixtepec (clave 208)");
    expect(municipalityLabel(oaxaca[2], repeated)).toBe("San Juan Mixtepec (clave 209)");
    expect(municipalityLabel(oaxaca[0], repeated)).toBe("Abejones");
    // El mismo nombre en otra entidad no cuenta como repetido.
    const other = repeatedNames([oaxaca[0], { id: 9, state_id: 21, inegi_code: "001", name: "Abejones", timezone: null }]);
    expect(other.size).toBe(0);
  });

  it("filtra por nombre sin acentos o por clave", () => {
    expect(filterMunicipalities(oaxaca, "").map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(filterMunicipalities(oaxaca, "maria ixcatlan").map((m) => m.id)).toEqual([4]);
    expect(filterMunicipalities(oaxaca, "MIXTEPEC").map((m) => m.id)).toEqual([2, 3]);
    expect(filterMunicipalities(oaxaca, "209").map((m) => m.id)).toEqual([3]);
    expect(filterMunicipalities(oaxaca, "20").map((m) => m.id)).toEqual([2, 3]);
    expect(filterMunicipalities(oaxaca, "zzz")).toEqual([]);
  });

  it("encuentra municipios con el mismo nombre (normalizado)", () => {
    expect(sameNameMunicipalities(oaxaca, " san juan  MIXTEPEC").map((m) => m.inegi_code)).toEqual(["208", "209"]);
    expect(sameNameMunicipalities(oaxaca, "Nuevo")).toEqual([]);
  });

  it("forma las claves de entidad y geoestadística", () => {
    expect(stateCode(7)).toBe("07");
    expect(stateCode(20)).toBe("20");
    expect(municipalityFullCode(20, "208")).toBe("20208");
    expect(municipalityFullCode(1, "001")).toBe("01001");
  });
});

describe("errores de la base en catálogos", () => {
  it("traduce la clave INEGI duplicada", () => {
    expect(
      friendlyCatalogError({ code: "23505", message: 'duplicate key value violates unique constraint "municipalities_state_id_inegi_code_key"' }),
    ).toBe("Ya existe un municipio con esa clave INEGI en la entidad.");
  });

  it("muestra tal cual los mensajes propios de la base", () => {
    expect(friendlyCatalogError({ code: "22023", message: "Zona horaria no válida: Foo/Bar" })).toBe("Zona horaria no válida: Foo/Bar");
  });

  it("no muestra mensajes nativos en inglés", () => {
    expect(friendlyCatalogError({ code: "42501", message: 'new row violates row-level security policy for table "states"' })).toBe(
      "No tienes permiso para realizar esta acción.",
    );
    expect(friendlyCatalogError(null, "No se pudo guardar.")).toBe("No se pudo guardar.");
  });
});
