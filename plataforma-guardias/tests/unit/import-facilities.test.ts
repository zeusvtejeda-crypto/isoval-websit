import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/import/parse";
import {
  FACILITY_IMPORT_HEADERS,
  canonicalizeRow,
  checkFacilityHeaders,
  describeSummary,
  headerWarnings,
  importReason,
  parseVerificationStatus,
  parseYesNo,
  resolveCategory,
  resolveMunicipality,
  resolveState,
  toPreviewRows,
  validateFacilityRows,
  type ExistingFacilityRef,
  type FacilityImportCatalogs,
} from "@/lib/import/facilities";

const catalogs: FacilityImportCatalogs = {
  categories: [
    { id: 1, slug: "hospitales", name: "Hospitales", active: true },
    { id: 2, slug: "umf", name: "Unidades de Medicina Familiar", active: true },
    { id: 3, slug: "otras-unidades-medicas", name: "Otras unidades médicas", active: true },
    { id: 9, slug: "archivo-historico", name: "Archivo histórico", active: false },
  ],
  states: [
    { id: 14, name: "Jalisco", abbreviation: "JAL", default_timezone: "America/Mexico_City" },
    { id: 18, name: "Nayarit", abbreviation: "NAY", default_timezone: "America/Mazatlan" },
    { id: 19, name: "Nuevo León", abbreviation: "NL", default_timezone: "America/Monterrey" },
    { id: 30, name: "Veracruz de Ignacio de la Llave", abbreviation: "VER", default_timezone: "America/Mexico_City" },
  ],
  municipalities: [
    { id: 8, state_id: 18, name: "Xalisco", inegi_code: "008", timezone: null },
    { id: 15, state_id: 18, name: "Santiago Ixcuintla", inegi_code: "015", timezone: null },
    { id: 17, state_id: 18, name: "Tepic", inegi_code: "017", timezone: null },
    { id: 20, state_id: 18, name: "Bahía de Banderas", inegi_code: "020", timezone: "America/Bahia_Banderas" },
    { id: 100, state_id: 14, name: "Guadalajara", inegi_code: "039", timezone: null },
  ],
};

const ID_A = "f0000000-0000-4000-8000-00000000000a";
const ID_B = "f0000000-0000-4000-8000-00000000000b";
const ID_C = "f0000000-0000-4000-8000-00000000000c";

function facility(partial: Partial<ExistingFacilityRef> & Pick<ExistingFacilityRef, "id" | "internal_code" | "official_name">): ExistingFacilityRef {
  return {
    unit_key: null,
    category_id: 1,
    description: null,
    state_id: 18,
    municipality_id: 17,
    address: null,
    latitude: null,
    longitude: null,
    phone: null,
    schedule: null,
    services: [],
    services_verified: false,
    source: "Portal oficial",
    source_url: null,
    last_verified_at: null,
    verification_status: "pendiente",
    notes: null,
    timezone: "America/Mazatlan",
    arrival_tolerance_minutes: 10,
    is_demo: false,
    active: true,
    ...partial,
  };
}

const existing: ExistingFacilityRef[] = [
  facility({
    id: ID_A,
    internal_code: "INS-000001",
    official_name: "Hospital General de Tepic",
    unit_key: "NAY-HG-01",
    address: "Av. Principal 1",
    latitude: 21.5,
    longitude: -104.9,
    services: ["Urgencias", "Consulta externa"],
    services_verified: true,
    phone: "311 111 1111",
  }),
  facility({ id: ID_B, internal_code: "INS-000002", official_name: "Unidad de Medicina Familiar 1", unit_key: "NAY-UMF-01", category_id: 2 }),
  facility({ id: ID_C, internal_code: "INS-000003", official_name: "Clínica Cerrada", category_id: 9, active: false }),
];

const base = { categoria: "hospitales", estado: "Nayarit", municipio: "Tepic", fuente: "Portal oficial de la dependencia" };

function run(rows: Record<string, string>[], mode: "crear_actualizar" | "solo_crear" = "crear_actualizar", markDemo = false) {
  return validateFacilityRows(rows, catalogs, existing, mode, { markDemo, today: "2026-10-17" });
}

describe("encabezados", () => {
  it("la plantilla tiene todas las columnas y su fila de ejemplo se rechaza", () => {
    const text = readFileSync(resolve(__dirname, "../../public/plantillas/instalaciones.csv"), "utf8");
    const parsed = parseCsv(text);
    expect(parsed.headers).toEqual([...FACILITY_IMPORT_HEADERS]);
    const check = checkFacilityHeaders(parsed.headers);
    expect(check).toEqual({ missing: [], unknown: [], duplicated: [] });
    expect(parsed.rows).toHaveLength(1);
    const result = run(parsed.rows);
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].messages.join(" ")).toMatch(/fila de ejemplo/);
  });

  it("detecta obligatorias faltantes, alias, desconocidas y repetidas", () => {
    const check = checkFacilityHeaders(["nombre", "tipo", "entidad", "curp", "lat", "latitud"]);
    expect(check.missing).toEqual(["municipio", "fuente"]);
    expect(check.unknown).toEqual(["curp"]);
    expect(check.duplicated).toEqual(["latitud"]);
    expect(headerWarnings(check)).toHaveLength(2);
    expect(canonicalizeRow({ nombre: "A", lat: "", latitud: "21.1" })).toEqual({ nombre_oficial: "A", latitud: "21.1" });
  });
});

describe("resolución de catálogos (sin acentos)", () => {
  it("categoría por slug o por nombre sin acentos ni mayúsculas", () => {
    expect(resolveCategory("UMF", catalogs.categories)).toEqual({ value: catalogs.categories[1] });
    expect(resolveCategory("otras unidades medicas", catalogs.categories)).toEqual({ value: catalogs.categories[2] });
    expect(resolveCategory("Otras Unidades Médicas", catalogs.categories)).toEqual({ value: catalogs.categories[2] });
    expect(resolveCategory("unidades de medicina familiar", catalogs.categories)).toEqual({ value: catalogs.categories[1] });
    const unknown = resolveCategory("Farmacias", catalogs.categories);
    expect("error" in unknown && unknown.error).toMatch(/No se reconoce la categoría/);
  });

  it("estado por nombre, abreviatura o clave INEGI", () => {
    expect(resolveState("nuevo leon", catalogs.states)).toMatchObject({ value: { id: 19 } });
    expect(resolveState("NAY", catalogs.states)).toMatchObject({ value: { id: 18 } });
    expect(resolveState("18", catalogs.states)).toMatchObject({ value: { id: 18 } });
    expect(resolveState("Veracruz", catalogs.states)).toMatchObject({ value: { id: 30 } });
    expect("error" in resolveState("Atlantis", catalogs.states)).toBe(true);
  });

  it("municipio por nombre (sin acentos) o clave dentro del estado", () => {
    const nay = catalogs.states[1];
    expect(resolveMunicipality("bahia de banderas", nay, catalogs.municipalities)).toMatchObject({ value: { id: 20 } });
    expect(resolveMunicipality("17", nay, catalogs.municipalities)).toMatchObject({ value: { id: 17 } });
    const wrong = resolveMunicipality("Guadalajara", nay, catalogs.municipalities);
    expect("error" in wrong && wrong.error).toMatch(/no corresponde a Nayarit/);
  });

  it("sí/no y estado de verificación", () => {
    expect(parseYesNo("Sí")).toBe(true);
    expect(parseYesNo("no")).toBe(false);
    expect(parseYesNo("tal vez")).toBeNull();
    expect(parseVerificationStatus("Verificada")).toBe("verificado");
    expect(parseVerificationStatus("pendiente")).toBe("pendiente");
    expect(parseVerificationStatus("quizá")).toBeNull();
  });
});

describe("filas nuevas", () => {
  it("crea con valores por omisión (zona del municipio, tolerancia 10, producción)", () => {
    const result = run([
      {
        ...base,
        nombre_oficial: "  Unidad   Médica  Nueva ",
        municipio: "Bahia de Banderas",
        latitud: "20,75",
        longitud: "-105.3",
        servicios: "Consulta externa; Farmacia | consulta externa",
        servicios_verificados: "sí",
      },
    ]);
    const row = result.rows[0];
    expect(row.status).toBe("nueva");
    expect(row.create).toMatchObject({
      official_name: "Unidad Médica Nueva",
      category_id: 1,
      state_id: 18,
      municipality_id: 20,
      latitude: 20.75,
      longitude: -105.3,
      services: ["Consulta externa", "Farmacia"],
      services_verified: true,
      timezone: "America/Bahia_Banderas",
      arrival_tolerance_minutes: 10,
      verification_status: "pendiente",
      is_demo: false,
    });
    expect(row.place).toBe("Bahía de Banderas, Nayarit");
  });

  it("respeta la marca de demostración", () => {
    const result = run([{ ...base, nombre_oficial: "Oficina Estatal" }], "crear_actualizar", true);
    expect(result.rows[0].status).toBe("nueva");
    expect(result.rows[0].create).toMatchObject({ timezone: "America/Mazatlan", municipality_id: 17, is_demo: true });
    expect(result.rows[0].messages.join(" ")).toMatch(/demostración/);
  });

  it("el municipio es obligatorio (estado → municipio → sede)", () => {
    const result = run([{ ...base, nombre_oficial: "Oficina Estatal", municipio: "" }]);
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].messages).toContain("Falta el municipio.");
    expect(result.rows[0].create).toBeNull();
  });

  it("acepta zona horaria y tolerancia explícitas", () => {
    const result = run([{ ...base, nombre_oficial: "Unidad Centro", zona_horaria: "america/mexico_city", tolerancia_minutos: "0" }]);
    expect(result.rows[0].create).toMatchObject({ timezone: "America/Mexico_City", arrival_tolerance_minutes: 0 });
  });

  it("rechaza una categoría inactiva para altas", () => {
    const result = run([{ ...base, nombre_oficial: "Archivo Nuevo", categoria: "Archivo historico" }]);
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].messages[0]).toMatch(/inactiva/);
  });
});

describe("fuente obligatoria", () => {
  it("marca error si falta la fuente en una fila nueva", () => {
    const result = run([{ ...base, nombre_oficial: "Sin Fuente", fuente: "  " }]);
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].messages).toContain("Falta la fuente de información (obligatoria en cada fila).");
  });

  it("también la exige en una actualización", () => {
    const result = run([{ ...base, nombre_oficial: "Hospital General de Tepic", clave_unidad: "NAY-HG-01", fuente: "" }]);
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].messages.join(" ")).toMatch(/fuente/);
  });
});

describe("coordenadas inválidas", () => {
  const cases: [string, Record<string, string>, RegExp][] = [
    ["fuera de México", { latitud: "40.4", longitud: "-3.7" }, /latitud debe estar dentro de México/],
    ["longitud positiva", { latitud: "21.5", longitud: "104.9" }, /longitud debe estar dentro de México/],
    ["solo latitud", { latitud: "21.5", longitud: "" }, /juntas/],
    ["solo longitud", { latitud: "", longitud: "-104.9" }, /juntas/],
    ["invertidas", { latitud: "-104.9", longitud: "21.5" }, /invertidas/],
    ["no numérica", { latitud: "veintiuno", longitud: "-104.9" }, /Latitud inválida/],
  ];
  it.each(cases)("%s", (_label, coords, message) => {
    const result = run([{ ...base, nombre_oficial: "Unidad con Coordenadas", ...coords }]);
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].messages.join(" ")).toMatch(message);
  });
});

describe("otras validaciones", () => {
  it("verificado exige fecha; fechas futuras e inválidas se rechazan", () => {
    const result = run([
      { ...base, nombre_oficial: "Unidad A", estado_verificacion: "verificado" },
      { ...base, nombre_oficial: "Unidad B", estado_verificacion: "verificado", fecha_verificacion: "2027-01-01" },
      { ...base, nombre_oficial: "Unidad C", fecha_verificacion: "31/02/2026" },
      { ...base, nombre_oficial: "Unidad D", estado_verificacion: "verificada", fecha_verificacion: "05/10/2026" },
    ]);
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].messages[0]).toMatch(/fecha de verificación/);
    expect(result.rows[1].messages.join(" ")).toMatch(/futura/);
    expect(result.rows[2].messages.join(" ")).toMatch(/Fecha de verificación inválida/);
    expect(result.rows[3].status).toBe("nueva");
    expect(result.rows[3].create).toMatchObject({ verification_status: "verificado", last_verified_at: "2026-10-05" });
  });

  it("zona horaria fuera de México, tolerancia fuera de rango, URL inválida y servicios verificados vacíos", () => {
    const result = run([
      { ...base, nombre_oficial: "Unidad E", zona_horaria: "Europe/Madrid" },
      { ...base, nombre_oficial: "Unidad F", tolerancia_minutos: "300" },
      { ...base, nombre_oficial: "Unidad G", url_fuente: "ftp://example.org" },
      { ...base, nombre_oficial: "Unidad H", servicios_verificados: "sí" },
      { ...base, nombre_oficial: "Unidad I", categoria: "", estado: "" },
    ]);
    expect(result.rows[0].messages.join(" ")).toMatch(/Zona horaria no válida/);
    expect(result.rows[1].messages.join(" ")).toMatch(/Tolerancia inválida/);
    expect(result.rows[2].messages.join(" ")).toMatch(/URL de la fuente inválida/);
    expect(result.rows[3].messages.join(" ")).toMatch(/servicios/);
    expect(result.rows[4].messages).toEqual(expect.arrayContaining(["Falta la categoría.", "Falta el estado."]));
    expect(result.rows.every((r) => r.status === "error")).toBe(true);
  });
});

describe("duplicados dentro del archivo", () => {
  it("misma clave de unidad (sin distinguir mayúsculas)", () => {
    const result = run([
      { ...base, nombre_oficial: "Unidad Uno", clave_unidad: "nay-x-1" },
      { ...base, nombre_oficial: "Unidad Dos", clave_unidad: " NAY-X-1 " },
    ]);
    expect(result.rows[0].status).toBe("nueva");
    expect(result.rows[1].status).toBe("duplicada");
    expect(result.rows[1].messages[0]).toMatch(/fila 2/);
  });

  it("mismo nombre normalizado (acentos y mayúsculas) en el mismo municipio", () => {
    const result = run([
      { ...base, nombre_oficial: "Clínica Médica del Río" },
      { ...base, nombre_oficial: "CLINICA  MEDICA DEL RIO" },
      { ...base, nombre_oficial: "Clinica Medica del Rio", municipio: "Xalisco" },
    ]);
    expect(result.rows.map((r) => r.status)).toEqual(["nueva", "duplicada", "nueva"]);
  });

  it("mismo identificador interno o la misma instalación dos veces", () => {
    const result = run([
      { ...base, identificador_interno: "INS-000002", nombre_oficial: "Unidad de Medicina Familiar 1", categoria: "umf" },
      { ...base, identificador_interno: "ins-000002", nombre_oficial: "Unidad de Medicina Familiar Uno", categoria: "umf" },
      { ...base, nombre_oficial: "Otro Nombre", clave_unidad: "NAY-UMF-01", categoria: "umf" },
    ]);
    expect(result.rows[0].status).toBe("actualizacion");
    expect(result.rows[1].status).toBe("duplicada");
    expect(result.rows[2].status).toBe("duplicada");
    // La fila 2 actualiza INS-000002, cuya clave final es NAY-UMF-01.
    expect(result.rows[2].messages[0]).toMatch(/fila 2/);
  });
});

describe("duplicados contra la base", () => {
  it("nombre normalizado + estado + municipio: actualiza o se omite en «solo crear»", () => {
    const row = { ...base, nombre_oficial: "HOSPITAL GENERAL DE TÉPIC", fuente: "Portal oficial" };
    const update = run([row]);
    expect(update.rows[0].status).toBe("actualizacion");
    expect(update.rows[0].targetId).toBe(ID_A);
    expect(update.rows[0].patch).toEqual({ official_name: "HOSPITAL GENERAL DE TÉPIC" });

    const onlyCreate = run([row], "solo_crear");
    expect(onlyCreate.rows[0].status).toBe("duplicada");
    expect(onlyCreate.rows[0].messages[0]).toMatch(/solo crear/);
  });

  it("clave de unidad existente: actualiza y conserva lo no capturado", () => {
    const result = run([
      {
        ...base,
        nombre_oficial: "Hospital General de Tepic",
        clave_unidad: "nay-hg-01",
        fuente: "Portal oficial",
        horario: "24 horas",
        tolerancia_minutos: "15",
      },
    ]);
    const r = result.rows[0];
    expect(r.status).toBe("actualizacion");
    expect(r.targetCode).toBe("INS-000001");
    expect(r.patch).toEqual({ schedule: "24 horas", arrival_tolerance_minutes: 15 });
    expect(r.changes).toEqual(["horario", "tolerancia de llegada"]);
    expect(r.noop).toBe(false);
  });

  it("la fuente distinta cuenta como cambio", () => {
    const result = run([{ ...base, nombre_oficial: "Hospital General de Tepic", fuente: "Directorio oficial 2026" }]);
    expect(result.rows[0].patch).toEqual({ source: "Directorio oficial 2026" });
  });

  it("sin cambios: no se escribe", () => {
    const result = run([{ ...base, nombre_oficial: "Hospital General de Tepic", fuente: "Portal oficial" }]);
    expect(result.rows[0].status).toBe("actualizacion");
    expect(result.rows[0].noop).toBe(true);
    expect(result.rows[0].patch).toBeNull();
    expect(result.summary).toMatchObject({ actualizacion: 1, sinCambios: 1, aplicables: 0 });
  });

  it("identificador interno inexistente es error", () => {
    const result = run([{ ...base, identificador_interno: "INS-999999", nombre_oficial: "Unidad Fantasma" }]);
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].messages[0]).toMatch(/No existe una instalación con el identificador interno/);
  });

  it("identificador de una instalación y clave de unidad de otra", () => {
    const result = run([{ ...base, identificador_interno: "INS-000001", nombre_oficial: "Hospital General de Tepic", clave_unidad: "NAY-UMF-01" }]);
    expect(result.rows[0].status).toBe("duplicada");
    expect(result.rows[0].messages[0]).toMatch(/INS-000002/);
  });

  it("el mismo nombre en el mismo lugar se permite si ambas tienen claves de unidad distintas", () => {
    // Catálogos oficiales (CLUES) tienen unidades co-ubicadas con el mismo nombre.
    const result = run([{ ...base, clave_unidad: "NAY-HG-01", nombre_oficial: "Unidad de Medicina Familiar 1" }]);
    expect(result.rows[0].status).toBe("actualizacion");
  });

  it("dos filas con el mismo nombre y lugar pero claves distintas son instalaciones nuevas distintas", () => {
    const result = run([
      { ...base, clave_unidad: "NTIMS000721", nombre_oficial: "Linda Vista" },
      { ...base, clave_unidad: "NTIMS001235", nombre_oficial: "LINDA VISTA" },
    ]);
    expect(result.rows.map((r) => r.status)).toEqual(["nueva", "nueva"]);
  });

  it("el mismo nombre y lugar es duplicado si alguna fila no tiene clave de unidad", () => {
    const result = run([
      { ...base, clave_unidad: "NTIMS000721", nombre_oficial: "Linda Vista" },
      { ...base, clave_unidad: "", nombre_oficial: "Linda Vista" },
    ]);
    expect(result.rows[1].status).toBe("duplicada");
    expect(result.rows[1].messages[0]).toMatch(/fila 2/);
  });

  it("cambiar de estado exige el municipio del nuevo estado y ajusta la zona horaria", () => {
    const row = { ...base, identificador_interno: "INS-000002", nombre_oficial: "Unidad de Medicina Familiar 1", categoria: "umf", estado: "JAL" };
    // Sin municipio la instalación quedaría sin él: es error, no se quita.
    const missing = run([{ ...row, municipio: "" }]).rows[0];
    expect(missing.status).toBe("error");
    expect(missing.messages).toContain("Falta el municipio.");
    // El municipio anterior (Tepic) no corresponde al nuevo estado.
    expect(run([row]).rows[0].messages.join(" ")).toMatch(/no corresponde a Jalisco/);

    const r = run([{ ...row, municipio: "Guadalajara" }]).rows[0];
    expect(r.status).toBe("actualizacion");
    expect(r.patch).toMatchObject({ state_id: 14, municipality_id: 100, timezone: "America/Mexico_City" });
    expect(r.messages.join(" ")).toMatch(/zona horaria se ajusta/);
  });

  it("sin clave ni identificador no adivina entre varias unidades co-ubicadas con el mismo nombre", () => {
    const colocated = [
      ...existing,
      facility({ id: "f0000000-0000-4000-8000-00000000000d", internal_code: "INS-000004", official_name: "Linda Vista", unit_key: "NTIMS000721", category_id: 3 }),
      facility({ id: "f0000000-0000-4000-8000-00000000000e", internal_code: "INS-000005", official_name: "LINDA VISTA", unit_key: "NTIMS001235", category_id: 3 }),
    ];
    const validate = (row: Record<string, string>, mode: "crear_actualizar" | "solo_crear" = "crear_actualizar") =>
      validateFacilityRows([{ ...base, categoria: "otras-unidades-medicas", nombre_oficial: "Linda Vista", telefono: "311 000 0000", ...row }], catalogs, colocated, mode, {
        today: "2026-10-17",
      }).rows[0];

    for (const mode of ["crear_actualizar", "solo_crear"] as const) {
      const ambiguous = validate({}, mode);
      expect(ambiguous.status).toBe("duplicada");
      expect(ambiguous.patch).toBeNull();
      expect(ambiguous.targetId).toBeNull();
      expect(ambiguous.messages).toEqual([
        "Hay 2 instalaciones con ese nombre en ese municipio (INS-000004, INS-000005); indica clave_unidad o identificador_interno.",
      ]);
    }

    // Con la clave o el identificador se actualiza la unidad correcta.
    const byKey = validate({ clave_unidad: "ntims001235" });
    expect(byKey).toMatchObject({ status: "actualizacion", targetCode: "INS-000005", patch: { official_name: "Linda Vista", phone: "311 000 0000" } });
    const byCode = validate({ identificador_interno: "INS-000004" });
    expect(byCode).toMatchObject({ status: "actualizacion", targetCode: "INS-000004", patch: { phone: "311 000 0000" } });
  });

  it("una instalación inactiva con categoría inactiva se puede actualizar sin cambiar la categoría", () => {
    const result = run([
      { ...base, nombre_oficial: "Clinica Cerrada", categoria: "archivo-historico", fuente: "Portal oficial", observaciones: "Cerrada temporalmente" },
    ]);
    const r = result.rows[0];
    expect(r.status).toBe("actualizacion");
    expect(r.targetId).toBe(ID_C);
    expect(r.patch).toEqual({ official_name: "Clinica Cerrada", notes: "Cerrada temporalmente" });
    expect(r.messages.join(" ")).toMatch(/inactiva: se actualiza sin reactivarla/);
  });
});

describe("resumen y vista previa", () => {
  it("cuenta por estado y describe el resultado", () => {
    const result = run([
      { ...base, nombre_oficial: "Nueva Uno" },
      { ...base, nombre_oficial: "Hospital General de Tepic", fuente: "Portal oficial", horario: "24 horas" },
      { ...base, nombre_oficial: "Nueva Uno" },
      { ...base, nombre_oficial: "Sin Fuente", fuente: "" },
    ]);
    expect(result.summary).toEqual({ total: 4, nueva: 1, actualizacion: 1, duplicada: 1, error: 1, sinCambios: 0, aplicables: 2 });
    expect(describeSummary(result.summary)).toBe("4 filas: 1 nueva, 1 actualización, 1 duplicada, 1 con error.");
    const preview = toPreviewRows(result.rows);
    expect(preview[1]).toMatchObject({ row: 3, status: "actualizacion", targetCode: "INS-000001", category: "Hospitales" });
    expect(preview[0]).not.toHaveProperty("create");
  });

  it("motivo de la bitácora", () => {
    expect(importReason("instalaciones  nayarit.csv")).toBe("Importación: instalaciones nayarit.csv");
  });
});
