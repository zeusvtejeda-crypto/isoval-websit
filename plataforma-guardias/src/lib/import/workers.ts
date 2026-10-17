/**
 * Importación de trabajadores desde CSV/XLSX: validación por fila (pura).
 *
 * - Estados: nueva, actualización, duplicada o error.
 * - Duplicados: número de trabajador repetido en el archivo o existente en la
 *   base (también en sedes que la cuenta no ve: se comprueba con
 *   employee_numbers_taken, que solo responde sí/no); mismo nombre normalizado
 *   + misma sede (en la base o en otra fila).
 * - Un número ya registrado con otro nombre se marca como duplicada: la
 *   importación no renombra a otra persona por un número mal capturado.
 * - La instalación se resuelve por clave de unidad, identificador interno
 *   (INS-…) o nombre oficial exacto.
 * - Cada trabajador pertenece a una sede: en altas la instalación es obligatoria.
 * - Coordinación solo puede importar a sus sedes (se valida cada fila).
 * - En actualizaciones, las celdas vacías conservan el valor registrado.
 *
 * No importa nada de @/lib/import/parse (solo tipos) para poder usarse en el
 * navegador sin arrastrar las bibliotecas de lectura de archivos.
 */
import type { RawRow } from "@/lib/import/parse";
import type { Tone } from "@/lib/attendance/labels";
import {
  DEFAULT_STATE_ID,
  EMPLOYEE_NUMBER_MAX,
  EMPLOYEE_NUMBER_TAKEN,
  NAME_MAX,
  NAME_MIN,
  PHONE_ERROR,
  PHONE_RE,
  TEXT_MAX,
  USUAL_SHIFT_OPTIONS,
  collapseSpaces,
  employeeNumberKey,
  matchUsualShift,
  normalizeText,
} from "@/lib/validation/worker";

// ---------------------------------------------------------------------------
// Columnas
// ---------------------------------------------------------------------------

export const WORKER_IMPORT_HEADERS = [
  "nombre_completo",
  "numero_trabajador",
  "estado",
  "municipio",
  "instalacion",
  "area",
  "puesto",
  "turno_habitual",
  "telefono",
  "activo",
] as const;
export type WorkerImportHeader = (typeof WORKER_IMPORT_HEADERS)[number];

/** Encabezados alternos aceptados (ya normalizados como en parse.ts). */
const HEADER_ALIASES: Record<string, WorkerImportHeader> = {
  nombre: "nombre_completo",
  nombre_y_apellidos: "nombre_completo",
  numero_de_trabajador: "numero_trabajador",
  num_trabajador: "numero_trabajador",
  no_trabajador: "numero_trabajador",
  no_de_trabajador: "numero_trabajador",
  numero_empleado: "numero_trabajador",
  numero_de_empleado: "numero_trabajador",
  entidad: "estado",
  entidad_federativa: "estado",
  sede: "instalacion",
  instalacion_de_adscripcion: "instalacion",
  adscripcion: "instalacion",
  turno: "turno_habitual",
  tel: "telefono",
  telefono_celular: "telefono",
  celular: "telefono",
  activa: "activo",
};

export function canonicalHeader(header: string): WorkerImportHeader | null {
  if ((WORKER_IMPORT_HEADERS as readonly string[]).includes(header)) return header as WorkerImportHeader;
  return HEADER_ALIASES[header] ?? null;
}

export type HeaderCheck = { missing: WorkerImportHeader[]; unknown: string[]; duplicated: WorkerImportHeader[] };

/** Revisa encabezados (normalizados): obligatorios, desconocidos y repetidos. */
export function checkWorkerHeaders(headers: string[]): HeaderCheck {
  const seen = new Set<WorkerImportHeader>();
  const unknown: string[] = [];
  const duplicated: WorkerImportHeader[] = [];
  for (const h of headers) {
    const c = canonicalHeader(h);
    if (!c) {
      unknown.push(h);
      continue;
    }
    if (seen.has(c) && !duplicated.includes(c)) duplicated.push(c);
    seen.add(c);
  }
  const missing = (["nombre_completo"] as const).filter((h) => !seen.has(h));
  return { missing, unknown, duplicated };
}

type CanonicalRow = Partial<Record<WorkerImportHeader, string>>;

/** Fila con nombres de columna canónicos (gana el primer valor no vacío). */
export function canonicalizeRow(raw: RawRow): CanonicalRow {
  const out: CanonicalRow = {};
  for (const [key, value] of Object.entries(raw)) {
    const c = canonicalHeader(key);
    if (!c) continue;
    const v = (value ?? "").toString().trim();
    if (!out[c]) out[c] = v;
  }
  return out;
}

/** Números de trabajador del archivo (claves sin repetir) para la comprobación previa. */
export function employeeNumberKeysInRows(rows: RawRow[]): string[] {
  const keys = new Set<string>();
  for (const raw of rows) {
    const key = employeeNumberKey(canonicalizeRow(raw).numero_trabajador);
    if (key) keys.add(key);
  }
  return [...keys];
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export const WORKER_IMPORT_MODES = ["crear_actualizar", "solo_crear"] as const;
export type WorkerImportMode = (typeof WORKER_IMPORT_MODES)[number];

export const IMPORT_MODE_LABELS: Record<WorkerImportMode, string> = {
  crear_actualizar: "Crear y actualizar",
  solo_crear: "Solo crear (omitir los que ya existen)",
};

export type WorkerImportStatus = "nueva" | "actualizacion" | "duplicada" | "error";

export const IMPORT_STATUS_LABELS: Record<WorkerImportStatus, string> = {
  nueva: "Nueva",
  actualizacion: "Actualización",
  duplicada: "Duplicada",
  error: "Error",
};

export const IMPORT_STATUS_TONE: Record<WorkerImportStatus, Tone> = {
  nueva: "success",
  actualizacion: "info",
  duplicada: "warning",
  error: "danger",
};

export type ImportStateRef = { id: number; name: string; abbreviation: string };
export type ImportMunicipalityRef = { id: number; state_id: number; name: string; inegi_code: string };
export type ImportFacilityRef = {
  id: string;
  internal_code: string;
  unit_key: string | null;
  official_name: string;
  state_id: number;
  active: boolean;
};
export type ExistingWorkerRef = {
  id: string;
  internal_code: string;
  full_name: string;
  state_id: number;
  municipality_id: number | null;
  facility_id: string | null;
  area: string | null;
  position: string | null;
  usual_shift: string | null;
  active: boolean;
  /** Datos privados visibles para la cuenta (RLS); null si no hay fila visible. */
  employee_number: string | null;
  phone: string | null;
};

export type WorkerImportScope = { isAdmin: boolean; facilityIds: string[] };

export type WorkerImportContext = {
  mode: WorkerImportMode;
  scope: WorkerImportScope;
  states: ImportStateRef[];
  municipalities: ImportMunicipalityRef[];
  facilities: ImportFacilityRef[];
  existing: ExistingWorkerRef[];
  /**
   * Números de trabajador del archivo (clave employeeNumberKey) que ya están
   * registrados en registros que la cuenta no ve (por ejemplo, de otra sede).
   */
  takenEmployeeNumbers?: string[];
  defaultStateId?: number;
};

export type WorkerWriteValues = {
  full_name: string;
  state_id: number;
  municipality_id: number | null;
  facility_id: string;
  area: string | null;
  position: string | null;
  usual_shift: string | null;
  active: boolean;
};

export type WorkerPrivateValues = { employee_number: string | null; phone: string | null };

export type WorkerImportRowResult = {
  /** Número de fila en el archivo (encabezado = fila 1). */
  row: number;
  status: WorkerImportStatus;
  messages: string[];
  name: string;
  facilityLabel: string | null;
  /** Registro existente que se actualiza (o con el que se duplica). */
  targetId: string | null;
  targetCode: string | null;
  /** Valores completos para crear (status = nueva). */
  create: WorkerWriteValues | null;
  /** Solo los campos que cambian (status = actualizacion). */
  patch: Partial<WorkerWriteValues> | null;
  /** Valores completos de worker_private a escribir; null = no se escribe. */
  privateData: WorkerPrivateValues | null;
  /** Etiquetas de los campos que cambian (actualización). */
  changes: string[];
  /** Actualización sin cambios: no se escribe nada. */
  noop: boolean;
};

export type WorkerImportSummary = {
  total: number;
  nueva: number;
  actualizacion: number;
  duplicada: number;
  error: number;
  /** Actualizaciones que no cambian nada. */
  sinCambios: number;
  /** Filas que se escribirían al importar. */
  aplicables: number;
};

export type WorkerImportResult = { rows: WorkerImportRowResult[]; summary: WorkerImportSummary };

const FIELD_LABELS: Record<keyof WorkerWriteValues | keyof WorkerPrivateValues, string> = {
  full_name: "nombre",
  state_id: "estado",
  municipality_id: "municipio",
  facility_id: "instalación",
  area: "área",
  position: "puesto",
  usual_shift: "turno habitual",
  active: "activo",
  employee_number: "número de trabajador",
  phone: "teléfono",
};

// ---------------------------------------------------------------------------
// Resolución de catálogos
// ---------------------------------------------------------------------------

/** Sí/no en español o inglés; null si está vacío o no se reconoce. */
export function parseYesNo(value: string | null | undefined): boolean | null {
  const v = normalizeText(value);
  if (!v) return null;
  if (["si", "s", "true", "1", "verdadero", "x", "yes", "y", "activo", "activa"].includes(v)) return true;
  if (["no", "n", "false", "0", "falso", "inactivo", "inactiva"].includes(v)) return false;
  return null;
}

type Resolved<T> = { value: T } | { error: string };

export function resolveState(value: string, states: ImportStateRef[]): Resolved<ImportStateRef> {
  const v = value.trim();
  if (/^\d{1,2}$/.test(v)) {
    const byId = states.find((s) => s.id === Number(v));
    if (byId) return { value: byId };
  }
  const upper = v.toUpperCase();
  const byAbbr = states.find((s) => s.abbreviation.toUpperCase() === upper);
  if (byAbbr) return { value: byAbbr };
  const n = normalizeText(v);
  const byName = states.find((s) => normalizeText(s.name) === n);
  if (byName) return { value: byName };
  // Nombres oficiales largos («Veracruz de Ignacio de la Llave»): se acepta el inicio.
  const partial = states.filter((s) => normalizeText(s.name).startsWith(n + " "));
  if (partial.length === 1) return { value: partial[0] };
  return { error: `No se reconoce el estado «${v}». Usa el nombre, la abreviatura o la clave INEGI (por ejemplo, Nayarit, NAY o 18).` };
}

export function resolveMunicipality(
  value: string,
  state: ImportStateRef,
  municipalities: ImportMunicipalityRef[],
): Resolved<ImportMunicipalityRef> {
  const v = value.trim();
  const inState = municipalities.filter((m) => m.state_id === state.id);
  if (/^\d{1,3}$/.test(v)) {
    const code = v.padStart(3, "0");
    const byCode = inState.find((m) => m.inegi_code === code);
    if (byCode) return { value: byCode };
  }
  const n = normalizeText(v);
  const byName = inState.filter((m) => normalizeText(m.name) === n);
  if (byName.length === 1) return { value: byName[0] };
  if (byName.length > 1) {
    return {
      error: `Hay ${byName.length} municipios llamados «${v}» en ${state.name}; usa la clave INEGI (${byName.map((m) => m.inegi_code).join(" o ")}).`,
    };
  }
  return { error: `El municipio «${v}» no corresponde a ${state.name}.` };
}

/** Clave de unidad, identificador interno o nombre oficial exacto (sin distinguir acentos ni mayúsculas). */
export function resolveFacility(value: string, facilities: ImportFacilityRef[]): Resolved<ImportFacilityRef> {
  const v = value.trim();
  const upper = v.toUpperCase();
  const byKey = facilities.filter((f) => f.unit_key && f.unit_key.trim().toUpperCase() === upper);
  if (byKey.length === 1) return { value: byKey[0] };
  const byCode = facilities.find((f) => f.internal_code.toUpperCase() === upper);
  if (byCode) return { value: byCode };
  const exact = facilities.filter((f) => f.official_name.trim() === v);
  if (exact.length === 1) return { value: exact[0] };
  const n = normalizeText(v);
  const byName = exact.length > 1 ? exact : facilities.filter((f) => normalizeText(f.official_name) === n);
  if (byName.length === 1) return { value: byName[0] };
  if (byName.length > 1) {
    return { error: `Hay varias instalaciones llamadas «${v}». Usa la clave de unidad o el identificador interno (INS-…).` };
  }
  return {
    error: `No se encontró la instalación «${v}». Usa la clave de unidad, el identificador interno (INS-…) o el nombre oficial exacto.`,
  };
}

function canManage(scope: WorkerImportScope, facilityId: string | null): boolean {
  if (scope.isAdmin) return true;
  return !!facilityId && scope.facilityIds.includes(facilityId);
}

function nameKey(name: string, facilityId: string | null): string {
  return `${normalizeText(name)}|${facilityId ?? ""}`;
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

/** Celdas ya validadas de una fila (undefined = celda vacía). */
type ParsedCells = {
  name: string;
  employeeNumber: string | undefined;
  phone: string | undefined;
  area: string | undefined;
  position: string | undefined;
  usualShift: string | undefined;
  active: boolean | undefined;
  state: ImportStateRef | undefined;
  municipality: ImportMunicipalityRef | undefined;
  /** Texto de municipio sin resolver todavía (depende del estado final). */
  municipalityText: string | undefined;
  facility: ImportFacilityRef | undefined;
};

function parseCells(cells: CanonicalRow, ctx: WorkerImportContext, errors: string[]): ParsedCells {
  const name = collapseSpaces(cells.nombre_completo ?? "");
  if (!name) errors.push("Falta el nombre completo.");
  else if (name.length < NAME_MIN) errors.push(`El nombre debe tener al menos ${NAME_MIN} caracteres.`);
  else if (name.length > NAME_MAX) errors.push(`El nombre admite máximo ${NAME_MAX} caracteres.`);
  if (normalizeText(name).startsWith("[ejemplo]")) {
    errors.push("Es la fila de ejemplo de la plantilla: bórrala o reemplázala con datos reales.");
  }

  const employeeNumber = cells.numero_trabajador?.trim() || undefined;
  if (employeeNumber && employeeNumber.length > EMPLOYEE_NUMBER_MAX) {
    errors.push(`El número de trabajador admite máximo ${EMPLOYEE_NUMBER_MAX} caracteres.`);
  }

  const phone = cells.telefono?.trim() || undefined;
  if (phone && !PHONE_RE.test(phone)) errors.push(PHONE_ERROR);

  const area = cells.area ? collapseSpaces(cells.area) || undefined : undefined;
  if (area && area.length > TEXT_MAX) errors.push(`El área admite máximo ${TEXT_MAX} caracteres.`);
  const position = cells.puesto ? collapseSpaces(cells.puesto) || undefined : undefined;
  if (position && position.length > TEXT_MAX) errors.push(`El puesto admite máximo ${TEXT_MAX} caracteres.`);

  let usualShift: string | undefined;
  if (cells.turno_habitual?.trim()) {
    const s = matchUsualShift(cells.turno_habitual);
    if (s) usualShift = s;
    else errors.push(`Turno habitual no reconocido «${cells.turno_habitual.trim()}». Usa: ${USUAL_SHIFT_OPTIONS.join(", ")}.`);
  }

  let active: boolean | undefined;
  if (cells.activo?.trim()) {
    const b = parseYesNo(cells.activo);
    if (b === null) errors.push(`Valor de «activo» no reconocido «${cells.activo.trim()}». Usa «sí» o «no».`);
    else active = b;
  }

  let state: ImportStateRef | undefined;
  if (cells.estado?.trim()) {
    const r = resolveState(cells.estado, ctx.states);
    if ("error" in r) errors.push(r.error);
    else state = r.value;
  }

  let facility: ImportFacilityRef | undefined;
  if (cells.instalacion?.trim()) {
    const r = resolveFacility(cells.instalacion, ctx.facilities);
    if ("error" in r) errors.push(r.error);
    else if (!r.value.active) errors.push(`La instalación «${r.value.official_name}» está inactiva.`);
    else if (!canManage(ctx.scope, r.value.id)) {
      errors.push(`No puedes importar trabajadores a «${r.value.official_name}»: no está entre las sedes que gestionas.`);
    } else facility = r.value;
  }

  const municipalityText = cells.municipio?.trim() || undefined;
  return { name, employeeNumber, phone, area, position, usualShift, active, state, municipality: undefined, municipalityText, facility };
}

function emptyResult(row: number, name: string): WorkerImportRowResult {
  return {
    row,
    status: "error",
    messages: [],
    name,
    facilityLabel: null,
    targetId: null,
    targetCode: null,
    create: null,
    patch: null,
    privateData: null,
    changes: [],
    noop: false,
  };
}

function describeWorker(w: ExistingWorkerRef): string {
  return `${w.internal_code} (${w.full_name})`;
}

/**
 * Valida las filas del archivo contra los catálogos y los trabajadores
 * visibles para la cuenta. No escribe nada: devuelve qué haría cada fila.
 */
export function validateWorkerRows(rows: RawRow[], ctx: WorkerImportContext): WorkerImportResult {
  const defaultStateId = ctx.defaultStateId ?? DEFAULT_STATE_ID;
  const stateById = new Map(ctx.states.map((s) => [s.id, s]));
  const facilityById = new Map(ctx.facilities.map((f) => [f.id, f]));
  const takenElsewhere = new Set(ctx.takenEmployeeNumbers ?? []);

  // Índices de lo registrado.
  const byEmployee = new Map<string, ExistingWorkerRef>();
  const byName = new Map<string, ExistingWorkerRef[]>();
  for (const w of ctx.existing) {
    const key = employeeNumberKey(w.employee_number);
    if (key && !byEmployee.has(key)) byEmployee.set(key, w);
    const nk = nameKey(w.full_name, w.facility_id);
    byName.set(nk, [...(byName.get(nk) ?? []), w]);
  }

  // Lo visto en el archivo (primera fila que usa cada clave).
  const seenEmployee = new Map<string, number>();
  const seenName = new Map<string, number>();
  const seenTarget = new Map<string, number>();

  const results: WorkerImportRowResult[] = rows.map((raw, index) => {
    const rowNumber = index + 2;
    const cells = canonicalizeRow(raw);
    const errors: string[] = [];
    const p = parseCells(cells, ctx, errors);
    const result = emptyResult(rowNumber, p.name || "(sin nombre)");
    result.facilityLabel = p.facility?.official_name ?? (cells.instalacion?.trim() || null);

    const empKey = employeeNumberKey(p.employeeNumber);
    const firstEmpRow = empKey ? seenEmployee.get(empKey) : undefined;
    if (empKey && firstEmpRow === undefined) seenEmployee.set(empKey, rowNumber);

    if (errors.length > 0) {
      result.messages = errors;
      return result;
    }

    // --- Duplicado dentro del archivo por número de trabajador ---
    if (firstEmpRow !== undefined) {
      result.status = "duplicada";
      result.messages = [`El número de trabajador «${p.employeeNumber}» se repite: ya aparece en la fila ${firstEmpRow}.`];
      return result;
    }

    // --- Coincidencias con lo registrado ---
    const matchEmp = empKey ? byEmployee.get(empKey) : undefined;
    const lookupFacilityId = p.facility ? p.facility.id : (matchEmp?.facility_id ?? null);
    const nk = nameKey(p.name, lookupFacilityId);
    const nameMatches = (byName.get(nk) ?? []).filter((w) => w.id !== matchEmp?.id);
    const matchName = matchEmp ? undefined : nameMatches[0];

    if (!matchEmp && nameMatches.length > 1) {
      result.status = "duplicada";
      result.messages = [
        `Hay ${nameMatches.length} personas registradas con el mismo nombre en esa sede (${nameMatches.map((w) => w.internal_code).join(", ")}). Edítalas manualmente.`,
      ];
      return result;
    }

    const target = matchEmp ?? matchName;

    if (!target) {
      // --- Nueva ---
      const firstNameRow = seenName.get(nk);
      if (firstNameRow !== undefined) {
        result.status = "duplicada";
        result.messages = [`Mismo nombre y misma sede que la fila ${firstNameRow}.`];
        return result;
      }

      if (!p.facility) {
        result.messages = ["Indica la instalación de adscripción (clave de unidad, identificador interno o nombre oficial)."];
        return result;
      }
      if (empKey && takenElsewhere.has(empKey)) {
        result.status = "duplicada";
        result.messages = [EMPLOYEE_NUMBER_TAKEN];
        return result;
      }

      const state = p.state ?? stateById.get(p.facility.state_id) ?? stateById.get(defaultStateId);
      if (!state) {
        result.messages = ["Indica el estado."];
        return result;
      }
      let municipalityId: number | null = null;
      if (p.municipalityText) {
        const r = resolveMunicipality(p.municipalityText, state, ctx.municipalities);
        if ("error" in r) {
          result.messages = [r.error];
          return result;
        }
        municipalityId = r.value.id;
      }

      // Solo las filas válidas reservan el nombre: una fila con error no vuelve duplicadas a las siguientes.
      seenName.set(nk, rowNumber);
      result.status = "nueva";
      result.create = {
        full_name: p.name,
        state_id: state.id,
        municipality_id: municipalityId,
        facility_id: p.facility.id,
        area: p.area ?? null,
        position: p.position ?? null,
        usual_shift: p.usualShift ?? null,
        active: p.active ?? true,
      };
      result.privateData = p.employeeNumber || p.phone ? { employee_number: p.employeeNumber ?? null, phone: p.phone ?? null } : null;
      const notes = [`Se creará un registro nuevo en ${state.name}.`];
      if (result.create.active === false) notes.push("Se registrará como inactivo.");
      result.messages = notes;
      return result;
    }

    // --- Ya existe ---
    result.targetId = target.id;
    result.targetCode = target.internal_code;

    if (matchName && empKey && matchName.employee_number && employeeNumberKey(matchName.employee_number) !== empKey) {
      result.status = "duplicada";
      result.messages = [
        `Ya existe ${describeWorker(matchName)} en la misma sede con otro número de trabajador. Si es otra persona, captúrala manualmente.`,
      ];
      return result;
    }

    // Un número de trabajador ya registrado con OTRO nombre (aunque se ignoren acentos,
    // mayúsculas y espacios) suele ser un error de captura: no se renombra a otra persona
    // en bloque. Los cambios de nombre se hacen desde la ficha.
    if (matchEmp && normalizeText(p.name) !== normalizeText(matchEmp.full_name)) {
      result.status = "duplicada";
      result.messages = [
        `El número de trabajador «${p.employeeNumber}» ya está registrado para ${describeWorker(matchEmp)}, con otro nombre. ` +
          "Si es la misma persona, usa el nombre registrado (el nombre se corrige desde su ficha); si no, revisa el número.",
      ];
      return result;
    }

    if (ctx.mode === "solo_crear") {
      result.status = "duplicada";
      result.messages = [
        matchEmp
          ? `Ya existe una persona con ese número de trabajador: ${describeWorker(target)}. Se omite (modo «solo crear»).`
          : `Ya existe una persona con el mismo nombre en la misma sede: ${describeWorker(target)}. Se omite (modo «solo crear»).`,
      ];
      return result;
    }

    const firstTargetRow = seenTarget.get(target.id);
    if (firstTargetRow !== undefined) {
      result.status = "duplicada";
      result.messages = [`La fila ${firstTargetRow} ya actualiza a ${describeWorker(target)}.`];
      return result;
    }

    if (!canManage(ctx.scope, target.facility_id)) {
      result.messages = [`${describeWorker(target)} está adscrito a una sede que no gestionas; no puedes actualizarlo.`];
      return result;
    }

    // Valores finales (las celdas vacías conservan lo registrado).
    const notes: string[] = [];
    const patch: Partial<WorkerWriteValues> = {};
    const finalStateId = p.state?.id ?? target.state_id;
    let finalMunicipality: number | null = target.municipality_id;
    if (p.municipalityText) {
      const state = stateById.get(finalStateId);
      if (!state) {
        result.messages = ["Indica el estado."];
        return result;
      }
      const r = resolveMunicipality(p.municipalityText, state, ctx.municipalities);
      if ("error" in r) {
        result.messages = [r.error];
        return result;
      }
      finalMunicipality = r.value.id;
    } else if (finalStateId !== target.state_id && target.municipality_id !== null) {
      finalMunicipality = null;
      notes.push("Se quitará el municipio porque cambió el estado.");
    }

    const finalFacility = p.facility?.id ?? target.facility_id;
    if (!finalFacility) {
      result.messages = ["Indica la instalación de adscripción (clave de unidad, identificador interno o nombre oficial)."];
      return result;
    }
    const finalName = p.name;
    if (finalName !== target.full_name) {
      patch.full_name = finalName;
      notes.push(`Cambia el nombre de «${target.full_name}» a «${finalName}».`);
    }
    const finalKey = nameKey(finalName, finalFacility);
    // Otra persona ya registrada con el mismo nombre en la sede final.
    if (finalName !== target.full_name || finalFacility !== target.facility_id) {
      const clash = (byName.get(finalKey) ?? []).find((w) => w.id !== target.id);
      if (clash) {
        result.status = "duplicada";
        result.messages = [`Ya existe ${describeWorker(clash)} con el mismo nombre en esa sede.`];
        return result;
      }
    }
    // Otra fila del archivo (alta o actualización) que deja el mismo nombre en la misma sede.
    const firstNameRow = seenName.get(finalKey);
    if (firstNameRow !== undefined) {
      result.status = "duplicada";
      result.messages = [`Mismo nombre y misma sede que la fila ${firstNameRow}.`];
      return result;
    }
    // Número nuevo que ya pertenece a un registro que la cuenta no ve.
    if (empKey && employeeNumberKey(target.employee_number) !== empKey && takenElsewhere.has(empKey)) {
      result.status = "duplicada";
      result.messages = [EMPLOYEE_NUMBER_TAKEN];
      return result;
    }
    seenTarget.set(target.id, rowNumber);
    seenName.set(finalKey, rowNumber);
    if (finalStateId !== target.state_id) patch.state_id = finalStateId;
    if (finalMunicipality !== target.municipality_id) patch.municipality_id = finalMunicipality;
    if (finalFacility !== target.facility_id) patch.facility_id = finalFacility;
    if (p.area !== undefined && p.area !== target.area) patch.area = p.area;
    if (p.position !== undefined && p.position !== target.position) patch.position = p.position;
    if (p.usualShift !== undefined && p.usualShift !== target.usual_shift) patch.usual_shift = p.usualShift;
    if (p.active !== undefined && p.active !== target.active) patch.active = p.active;

    const changes = (Object.keys(patch) as (keyof WorkerWriteValues)[]).map((k) => FIELD_LABELS[k]);

    const empChanged = !!empKey && employeeNumberKey(target.employee_number) !== empKey;
    const phoneChanged = !!p.phone && p.phone !== target.phone;
    if (empChanged) changes.push(FIELD_LABELS.employee_number);
    if (phoneChanged) changes.push(FIELD_LABELS.phone);
    result.privateData =
      empChanged || phoneChanged
        ? {
            employee_number: empChanged ? (p.employeeNumber ?? null) : target.employee_number,
            phone: phoneChanged ? (p.phone ?? null) : target.phone,
          }
        : null;

    result.status = "actualizacion";
    result.patch = Object.keys(patch).length > 0 ? patch : null;
    result.changes = changes;
    result.noop = changes.length === 0;
    result.facilityLabel = facilityById.get(finalFacility)?.official_name ?? result.facilityLabel;
    result.messages = [
      result.noop
        ? `Coincide con ${describeWorker(target)}. Sin cambios: no se modificará.`
        : `Actualiza a ${describeWorker(target)}. Cambia: ${changes.join(", ")}.`,
      ...notes,
    ];
    return result;
  });

  return { rows: results, summary: summarizeImport(results) };
}

export function summarizeImport(rows: WorkerImportRowResult[]): WorkerImportSummary {
  const s: WorkerImportSummary = { total: rows.length, nueva: 0, actualizacion: 0, duplicada: 0, error: 0, sinCambios: 0, aplicables: 0 };
  for (const r of rows) {
    s[r.status] += 1;
    if (r.status === "actualizacion" && r.noop) s.sinCambios += 1;
    if (r.status === "nueva" || (r.status === "actualizacion" && !r.noop)) s.aplicables += 1;
  }
  return s;
}

/** Resumen legible para la interfaz. */
export function describeSummary(s: WorkerImportSummary): string {
  const parts = [
    `${s.nueva} ${s.nueva === 1 ? "nueva" : "nuevas"}`,
    `${s.actualizacion} ${s.actualizacion === 1 ? "actualización" : "actualizaciones"}${s.sinCambios ? ` (${s.sinCambios} sin cambios)` : ""}`,
    `${s.duplicada} ${s.duplicada === 1 ? "duplicada" : "duplicadas"}`,
    `${s.error} con error`,
  ];
  return `${s.total} ${s.total === 1 ? "fila" : "filas"}: ${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Resultado que se envía al navegador (sin datos privados)
// ---------------------------------------------------------------------------

export type ImportApplyResult = "creada" | "actualizada" | "sin_cambios" | "fallo";

export const IMPORT_APPLY_LABELS: Record<ImportApplyResult, string> = {
  creada: "Creada",
  actualizada: "Actualizada",
  sin_cambios: "Sin cambios",
  fallo: "No se guardó",
};

export const IMPORT_APPLY_TONE: Record<ImportApplyResult, Tone> = {
  creada: "success",
  actualizada: "info",
  sin_cambios: "muted",
  fallo: "danger",
};

export type ImportPreviewRow = {
  row: number;
  status: WorkerImportStatus;
  name: string;
  facility: string | null;
  messages: string[];
  applied?: ImportApplyResult;
};

export type ImportOutcome = {
  intent: "validar" | "importar";
  fingerprint: string;
  fileName: string;
  mode: WorkerImportMode;
  summary: WorkerImportSummary;
  warnings: string[];
  rows: ImportPreviewRow[];
  applied?: { created: number; updated: number; unchanged: number; failed: number };
};

export function toPreviewRows(rows: WorkerImportRowResult[]): ImportPreviewRow[] {
  return rows.map((r) => ({ row: r.row, status: r.status, name: r.name, facility: r.facilityLabel, messages: r.messages }));
}

/** Avisos por encabezados desconocidos o repetidos. */
export function headerWarnings(check: HeaderCheck): string[] {
  const out: string[] = [];
  if (check.unknown.length) out.push(`Columnas no reconocidas (se ignoran): ${check.unknown.join(", ")}.`);
  if (check.duplicated.length) out.push(`Columnas repetidas (se usa el primer valor no vacío): ${check.duplicated.join(", ")}.`);
  return out;
}
