import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/import/parse";
import {
  WORKER_IMPORT_HEADERS,
  canonicalizeRow,
  checkWorkerHeaders,
  describeSummary,
  headerWarnings,
  parseYesNo,
  resolveFacility,
  resolveMunicipality,
  resolveState,
  toPreviewRows,
  validateWorkerRows,
  type ExistingWorkerRef,
  type ImportFacilityRef,
  type WorkerImportContext,
} from "@/lib/import/workers";

const FAC_A = "a0000000-0000-4000-8000-000000000001";
const FAC_B = "a0000000-0000-4000-8000-000000000002";
const FAC_C = "a0000000-0000-4000-8000-000000000003";
const FAC_D = "a0000000-0000-4000-8000-000000000004";

const states = [
  { id: 14, name: "Jalisco", abbreviation: "JAL" },
  { id: 18, name: "Nayarit", abbreviation: "NAY" },
  { id: 30, name: "Veracruz de Ignacio de la Llave", abbreviation: "VER" },
];
const municipalities = [
  { id: 8, state_id: 18, name: "Xalisco", inegi_code: "008" },
  { id: 17, state_id: 18, name: "Tepic", inegi_code: "017" },
  { id: 20, state_id: 18, name: "Bahía de Banderas", inegi_code: "020" },
  { id: 100, state_id: 14, name: "Guadalajara", inegi_code: "039" },
];
const facilities: ImportFacilityRef[] = [
  { id: FAC_A, internal_code: "INS-000001", unit_key: "DEMO-H01", official_name: "Hospital General A", state_id: 18, active: true },
  { id: FAC_B, internal_code: "INS-000002", unit_key: "DEMO-U01", official_name: "Unidad Médica 1", state_id: 18, active: true },
  { id: FAC_C, internal_code: "INS-000003", unit_key: null, official_name: "Unidad Cerrada", state_id: 18, active: false },
  { id: FAC_D, internal_code: "INS-000004", unit_key: "OTRA-01", official_name: "Hospital de Otra Sede", state_id: 14, active: true },
];

function worker(partial: Partial<ExistingWorkerRef> & Pick<ExistingWorkerRef, "id" | "internal_code" | "full_name">): ExistingWorkerRef {
  return {
    state_id: 18,
    municipality_id: 17,
    facility_id: FAC_A,
    area: null,
    position: null,
    usual_shift: null,
    active: true,
    employee_number: null,
    phone: null,
    ...partial,
  };
}

const existing: ExistingWorkerRef[] = [
  worker({ id: "w1", internal_code: "TRA-000001", full_name: "Ana Martínez Ruiz", employee_number: "E-001", area: "Enfermería", position: "Enfermera" }),
  worker({ id: "w2", internal_code: "TRA-000002", full_name: "Luis Hernández Soto", facility_id: FAC_B }),
  worker({ id: "w3", internal_code: "TRA-000003", full_name: "Carlos Pérez", facility_id: FAC_D, state_id: 14, municipality_id: 100, employee_number: "E-900" }),
];

const admin = { isAdmin: true, facilityIds: [] };
const coordinator = { isAdmin: false, facilityIds: [FAC_A, FAC_B] };

function ctx(overrides: Partial<WorkerImportContext> = {}): WorkerImportContext {
  return { mode: "crear_actualizar", scope: admin, states, municipalities, facilities, existing, ...overrides };
}

const row = (r: Record<string, string>) => r;

describe("encabezados", () => {
  it("exige nombre_completo y reporta desconocidos y repetidos", () => {
    expect(checkWorkerHeaders([...WORKER_IMPORT_HEADERS]).missing).toEqual([]);
    const check = checkWorkerHeaders(["numero_trabajador", "curp", "telefono", "tel"]);
    expect(check.missing).toEqual(["nombre_completo"]);
    expect(check.unknown).toEqual(["curp"]);
    expect(check.duplicated).toEqual(["telefono"]);
    expect(headerWarnings(check)).toHaveLength(2);
  });

  it("acepta alias de encabezados", () => {
    expect(checkWorkerHeaders(["nombre", "sede", "turno"]).missing).toEqual([]);
    expect(canonicalizeRow({ nombre: "Ana", sede: "DEMO-H01", curp: "XXXX" })).toEqual({ nombre_completo: "Ana", instalacion: "DEMO-H01" });
  });
});

describe("resolución de catálogos", () => {
  it("resuelve el estado por nombre, abreviatura, clave o nombre corto", () => {
    expect(resolveState("nayarit", states)).toEqual({ value: states[1] });
    expect(resolveState("NAY", states)).toEqual({ value: states[1] });
    expect(resolveState("18", states)).toEqual({ value: states[1] });
    expect(resolveState("Veracruz", states)).toEqual({ value: states[2] });
    expect(resolveState("Narnia", states)).toHaveProperty("error");
  });

  it("resuelve el municipio dentro del estado por nombre o clave INEGI", () => {
    expect(resolveMunicipality("bahia de banderas", states[1], municipalities)).toEqual({ value: municipalities[2] });
    expect(resolveMunicipality("17", states[1], municipalities)).toEqual({ value: municipalities[1] });
    expect(resolveMunicipality("Guadalajara", states[1], municipalities)).toHaveProperty("error");
  });

  it("resuelve la instalación por clave de unidad, identificador interno o nombre oficial", () => {
    expect(resolveFacility("demo-h01", facilities)).toEqual({ value: facilities[0] });
    expect(resolveFacility("INS-000002", facilities)).toEqual({ value: facilities[1] });
    expect(resolveFacility("Unidad Médica 1", facilities)).toEqual({ value: facilities[1] });
    expect(resolveFacility("unidad medica 1", facilities)).toEqual({ value: facilities[1] });
    expect(resolveFacility("Unidad Médica", facilities)).toHaveProperty("error");
  });

  it("interpreta sí/no", () => {
    expect(parseYesNo("Sí")).toBe(true);
    expect(parseYesNo("NO")).toBe(false);
    expect(parseYesNo("")).toBeNull();
    expect(parseYesNo("tal vez")).toBeNull();
  });
});

describe("validateWorkerRows: filas nuevas y errores", () => {
  it("crea una fila completa y válida", () => {
    const { rows, summary } = validateWorkerRows(
      [
        row({
          nombre_completo: "  María   López Díaz ",
          numero_trabajador: "E-100",
          estado: "Nayarit",
          municipio: "tepic",
          instalacion: "DEMO-H01",
          area: "Archivo",
          puesto: "Archivista",
          turno_habitual: "matutino",
          telefono: "311 000 0000",
          activo: "sí",
        }),
      ],
      ctx(),
    );
    expect(rows[0].status).toBe("nueva");
    expect(rows[0].row).toBe(2);
    expect(rows[0].create).toEqual({
      full_name: "María López Díaz",
      state_id: 18,
      municipality_id: 17,
      facility_id: FAC_A,
      area: "Archivo",
      position: "Archivista",
      usual_shift: "Matutino",
      active: true,
    });
    expect(rows[0].privateData).toEqual({ employee_number: "E-100", phone: "311 000 0000" });
    expect(summary).toMatchObject({ total: 1, nueva: 1, aplicables: 1 });
  });

  it("toma el estado de la instalación o Nayarit si viene vacío", () => {
    const { rows } = validateWorkerRows(
      [row({ nombre_completo: "Persona Uno", instalacion: "OTRA-01" }), row({ nombre_completo: "Persona Dos" })],
      ctx(),
    );
    expect(rows[0].create?.state_id).toBe(14);
    expect(rows[1].status).toBe("nueva");
    expect(rows[1].create).toMatchObject({ state_id: 18, facility_id: null, active: true });
    expect(rows[1].privateData).toBeNull();
  });

  it("marca errores de campos", () => {
    const { rows, summary } = validateWorkerRows(
      [
        row({ nombre_completo: "" }),
        row({ nombre_completo: "Ab" }),
        row({ nombre_completo: "Persona Tres", telefono: "abc" }),
        row({ nombre_completo: "Persona Cuatro", turno_habitual: "madrugada" }),
        row({ nombre_completo: "Persona Cinco", activo: "quizá" }),
        row({ nombre_completo: "Persona Seis", estado: "Nayarit", municipio: "Guadalajara" }),
        row({ nombre_completo: "Persona Siete", instalacion: "NO-EXISTE" }),
        row({ nombre_completo: "Persona Ocho", instalacion: "INS-000003" }),
        row({ nombre_completo: "[EJEMPLO] Persona Ficticia", instalacion: "DEMO-H01" }),
      ],
      ctx(),
    );
    expect(rows.map((r) => r.status)).toEqual(Array(9).fill("error"));
    expect(rows[0].messages[0]).toMatch(/Falta el nombre/);
    expect(rows[2].messages[0]).toMatch(/Teléfono inválido/);
    expect(rows[3].messages[0]).toMatch(/Turno habitual no reconocido/);
    expect(rows[4].messages[0]).toMatch(/activo/);
    expect(rows[5].messages[0]).toMatch(/no corresponde a Nayarit/);
    expect(rows[6].messages[0]).toMatch(/No se encontró la instalación/);
    expect(rows[7].messages[0]).toMatch(/inactiva/);
    expect(rows[8].messages[0]).toMatch(/fila de ejemplo/);
    expect(summary.error).toBe(9);
    expect(summary.aplicables).toBe(0);
  });

  it("coordinación solo importa a sus sedes y debe indicar la instalación", () => {
    const { rows } = validateWorkerRows(
      [
        row({ nombre_completo: "Persona Nueve", instalacion: "OTRA-01" }),
        row({ nombre_completo: "Persona Diez" }),
        row({ nombre_completo: "Persona Once", instalacion: "DEMO-U01" }),
      ],
      ctx({ scope: coordinator }),
    );
    expect(rows[0].status).toBe("error");
    expect(rows[0].messages[0]).toMatch(/no está entre las sedes que gestionas/);
    expect(rows[1].status).toBe("error");
    expect(rows[1].messages[0]).toMatch(/Indica la instalación/);
    expect(rows[2].status).toBe("nueva");
  });
});

describe("validateWorkerRows: duplicados", () => {
  it("número de trabajador repetido en el archivo", () => {
    const { rows } = validateWorkerRows(
      [
        row({ nombre_completo: "Persona A", numero_trabajador: "x-77", instalacion: "DEMO-H01" }),
        row({ nombre_completo: "Persona B", numero_trabajador: " X-77 ", instalacion: "DEMO-H01" }),
      ],
      ctx(),
    );
    expect(rows[0].status).toBe("nueva");
    expect(rows[1].status).toBe("duplicada");
    expect(rows[1].messages[0]).toMatch(/fila 2/);
  });

  it("mismo nombre normalizado y misma sede dentro del archivo", () => {
    const { rows } = validateWorkerRows(
      [
        row({ nombre_completo: "José Núñez", instalacion: "DEMO-H01" }),
        row({ nombre_completo: "jose  nunez", instalacion: "INS-000001" }),
        row({ nombre_completo: "José Núñez", instalacion: "DEMO-U01" }),
      ],
      ctx(),
    );
    expect(rows.map((r) => r.status)).toEqual(["nueva", "duplicada", "nueva"]);
  });

  it("número existente en la base: actualización o duplicada según el modo", () => {
    const input = [row({ nombre_completo: "Ana Martínez Ruiz", numero_trabajador: "e-001", puesto: "Jefa de piso" })];
    const update = validateWorkerRows(input, ctx());
    expect(update.rows[0].status).toBe("actualizacion");
    expect(update.rows[0].targetId).toBe("w1");
    expect(update.rows[0].patch).toEqual({ position: "Jefa de piso" });
    expect(update.rows[0].changes).toEqual(["puesto"]);
    expect(update.rows[0].privateData).toBeNull();

    const onlyCreate = validateWorkerRows(input, ctx({ mode: "solo_crear" }));
    expect(onlyCreate.rows[0].status).toBe("duplicada");
    expect(onlyCreate.rows[0].messages[0]).toMatch(/TRA-000001/);
  });

  it("mismo nombre (sin acentos ni mayúsculas) y misma sede que un registro existente", () => {
    const input = [row({ nombre_completo: "LUIS HERNANDEZ SOTO", instalacion: "DEMO-U01", telefono: "311 555 0000" })];
    const update = validateWorkerRows(input, ctx());
    expect(update.rows[0].status).toBe("actualizacion");
    expect(update.rows[0].targetId).toBe("w2");
    expect(update.rows[0].patch).toEqual({ full_name: "LUIS HERNANDEZ SOTO" });
    expect(update.rows[0].privateData).toEqual({ employee_number: null, phone: "311 555 0000" });
    expect(validateWorkerRows(input, ctx({ mode: "solo_crear" })).rows[0].status).toBe("duplicada");
  });

  it("mismo nombre y sede pero otro número de trabajador: duplicada para revisión manual", () => {
    const { rows } = validateWorkerRows([row({ nombre_completo: "Ana Martínez Ruiz", numero_trabajador: "E-555", instalacion: "DEMO-H01" })], ctx());
    expect(rows[0].status).toBe("duplicada");
    expect(rows[0].messages[0]).toMatch(/otro número de trabajador/);
  });

  it("dos filas que actualizan a la misma persona", () => {
    const { rows } = validateWorkerRows(
      [row({ nombre_completo: "Ana Martínez Ruiz", numero_trabajador: "E-001" }), row({ nombre_completo: "Ana Martinez Ruiz", instalacion: "DEMO-H01" })],
      ctx(),
    );
    expect(rows[0].status).toBe("actualizacion");
    expect(rows[1].status).toBe("duplicada");
  });
});

describe("validateWorkerRows: actualizaciones", () => {
  it("sin cambios: no se aplica", () => {
    const { rows, summary } = validateWorkerRows([row({ nombre_completo: "Ana Martínez Ruiz", numero_trabajador: "E-001", area: "Enfermería" })], ctx());
    expect(rows[0].status).toBe("actualizacion");
    expect(rows[0].noop).toBe(true);
    expect(rows[0].messages[0]).toMatch(/Sin cambios/);
    expect(summary).toMatchObject({ actualizacion: 1, sinCambios: 1, aplicables: 0 });
  });

  it("las celdas vacías conservan lo registrado y un cambio de estado quita el municipio", () => {
    const { rows } = validateWorkerRows(
      [row({ nombre_completo: "Ana Martínez Ruiz", numero_trabajador: "E-001", estado: "Jalisco", area: "", activo: "no" })],
      ctx(),
    );
    expect(rows[0].patch).toEqual({ state_id: 14, municipality_id: null, active: false });
    expect(rows[0].messages.join(" ")).toMatch(/Se quitará el municipio/);
  });

  it("agrega el número de trabajador conservando el teléfono", () => {
    const withPhone = existing.map((w) => (w.id === "w2" ? { ...w, phone: "311 111 1111" } : w));
    const { rows } = validateWorkerRows([row({ nombre_completo: "Luis Hernández Soto", instalacion: "DEMO-U01", numero_trabajador: "E-200" })], ctx({ existing: withPhone }));
    expect(rows[0].status).toBe("actualizacion");
    expect(rows[0].privateData).toEqual({ employee_number: "E-200", phone: "311 111 1111" });
    expect(rows[0].changes).toEqual(["número de trabajador"]);
  });

  it("coordinación no puede actualizar a alguien de una sede que no gestiona", () => {
    const { rows } = validateWorkerRows([row({ nombre_completo: "Carlos Pérez", numero_trabajador: "E-900", instalacion: "DEMO-H01" })], ctx({ scope: coordinator }));
    expect(rows[0].status).toBe("error");
    expect(rows[0].messages[0]).toMatch(/sede que no gestionas/);
  });

  it("no permite mover a alguien a una sede donde ya hay otra persona con el mismo nombre", () => {
    const homonym = worker({ id: "w4", internal_code: "TRA-000004", full_name: "Carlos Pérez", facility_id: FAC_A });
    const { rows } = validateWorkerRows(
      [row({ nombre_completo: "Carlos Perez", numero_trabajador: "E-900", instalacion: "DEMO-H01" })],
      ctx({ existing: [...existing, homonym] }),
    );
    expect(rows[0].status).toBe("duplicada");
    expect(rows[0].targetId).toBe("w3");
    expect(rows[0].messages[0]).toMatch(/TRA-000004/);
  });

  it("un número registrado con otro nombre no renombra a esa persona", () => {
    const { rows, summary } = validateWorkerRows(
      [row({ nombre_completo: "Pedro Gómez", numero_trabajador: "E-001", instalacion: "DEMO-H01" })],
      ctx(),
    );
    expect(rows[0].status).toBe("duplicada");
    expect(rows[0].patch).toBeNull();
    expect(rows[0].messages[0]).toMatch(/E-001.*TRA-000001.*otro nombre/);
    expect(summary.aplicables).toBe(0);
  });

  it("corrige acentos y mayúsculas del nombre cuando coincide el número", () => {
    const { rows } = validateWorkerRows([row({ nombre_completo: "ana martinez ruiz", numero_trabajador: "E-001" })], ctx());
    expect(rows[0].status).toBe("actualizacion");
    expect(rows[0].patch).toEqual({ full_name: "ana martinez ruiz" });
  });

  it("una actualización no puede dejar el mismo nombre y sede que un alta del mismo archivo", () => {
    const { rows } = validateWorkerRows(
      [
        row({ nombre_completo: "Carlos Pérez", instalacion: "DEMO-H01" }),
        row({ nombre_completo: "Carlos Pérez", numero_trabajador: "E-900", instalacion: "DEMO-H01" }),
      ],
      ctx(),
    );
    expect(rows[0].status).toBe("nueva");
    expect(rows[1].status).toBe("duplicada");
    expect(rows[1].messages[0]).toMatch(/fila 2/);
  });

  it("dos actualizaciones que dejan el mismo nombre en la misma sede", () => {
    const moved = existing.map((w) => (w.id === "w2" ? { ...w, full_name: "Carlos Pérez", employee_number: "E-002" } : w));
    const { rows } = validateWorkerRows(
      [
        row({ nombre_completo: "Carlos Pérez", numero_trabajador: "E-900", instalacion: "DEMO-H01" }),
        row({ nombre_completo: "Carlos Pérez", numero_trabajador: "E-002", instalacion: "DEMO-H01" }),
      ],
      ctx({ existing: moved }),
    );
    expect(rows[0].status).toBe("actualizacion");
    expect(rows[1].status).toBe("duplicada");
    expect(rows[1].messages[0]).toMatch(/Mismo nombre y misma sede que la fila 2/);
  });

  it("una fila con error no vuelve duplicadas a las siguientes", () => {
    const { rows } = validateWorkerRows(
      [
        row({ nombre_completo: "Rosa Díaz", instalacion: "DEMO-H01", estado: "Nayarit", municipio: "Guadalajara" }),
        row({ nombre_completo: "Rosa Díaz", instalacion: "DEMO-H01" }),
        row({ nombre_completo: "Carlos Pérez", numero_trabajador: "E-900", instalacion: "DEMO-H01" }),
        row({ nombre_completo: "Carlos Pérez", numero_trabajador: "E-900", instalacion: "DEMO-H01" }),
      ],
      ctx({ scope: coordinator }),
    );
    expect(rows[0].status).toBe("error");
    expect(rows[1].status).toBe("nueva");
    // La fila 5 repite el número de la fila 4: duplicada dentro del archivo, aunque la fila 4 tenga error de permisos.
    expect(rows[2].status).toBe("error");
    expect(rows[3].status).toBe("duplicada");
  });
});

describe("resumen y plantilla", () => {
  it("describe el resumen y prepara la vista previa sin datos privados", () => {
    const result = validateWorkerRows(
      [row({ nombre_completo: "Persona Nueva", numero_trabajador: "E-300", telefono: "311 222 3333", instalacion: "DEMO-H01" }), row({ nombre_completo: "" })],
      ctx(),
    );
    expect(describeSummary(result.summary)).toBe("2 filas: 1 nueva, 0 actualizaciones, 0 duplicadas, 1 con error.");
    const preview = toPreviewRows(result.rows);
    expect(Object.keys(preview[0]).sort()).toEqual(["facility", "messages", "name", "row", "status"]);
    expect(JSON.stringify(preview)).not.toContain("311 222 3333");
  });

  it("la plantilla descargable tiene los encabezados esperados y su fila de ejemplo se rechaza", () => {
    const path = resolve(process.cwd(), "public/plantillas/trabajadores.csv");
    const parsed = parseCsv(readFileSync(path, "utf8"));
    expect(parsed.headers).toEqual([...WORKER_IMPORT_HEADERS]);
    expect(parsed.rows).toHaveLength(1);
    const { rows } = validateWorkerRows(parsed.rows, ctx());
    expect(rows[0].status).toBe("error");
    expect(rows[0].messages.join(" ")).toMatch(/fila de ejemplo/);
  });
});
