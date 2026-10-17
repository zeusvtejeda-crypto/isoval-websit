/**
 * Importación de instalaciones desde CSV/XLSX: validación por fila (pura).
 *
 * - Estados de fila: nueva, actualización, duplicada o error.
 * - Resolución: categoría por slug o nombre (sin acentos); estado por nombre,
 *   abreviatura o clave INEGI; municipio por nombre (o clave INEGI) dentro del
 *   estado.
 * - Duplicados dentro del archivo: misma clave de unidad, mismo identificador
 *   interno o mismo nombre normalizado en el mismo municipio.
 * - Duplicados contra la base: clave de unidad, identificador interno o nombre
 *   normalizado + estado + municipio.
 * - El nombre + lugar solo cuenta como duplicado cuando alguna de las dos
 *   instalaciones no tiene clave de unidad (compatibleUnitKeys): en catálogos
 *   oficiales (CLUES) hay unidades distintas con el mismo nombre en el mismo
 *   municipio (p. ej. una unidad médica rural y un centro de atención
 *   obstétrica co-ubicados). Si una fila sin clave ni identificador coincide
 *   con varias, no se adivina cuál actualizar: se marca como duplicada.
 * - El municipio y la fuente de información son obligatorios en cada fila.
 * - En actualizaciones, las celdas opcionales vacías conservan lo registrado.
 *
 * Solo importa tipos de @/lib/import/parse para poder usarse en el navegador
 * sin arrastrar las bibliotecas de lectura de archivos.
 */
import type { RawRow } from "@/lib/import/parse";
import type { Tone } from "@/lib/attendance/labels";
import {
  ADDRESS_MAX,
  DESCRIPTION_MAX,
  NOTES_MAX,
  OFFICIAL_NAME_MAX,
  OFFICIAL_NAME_MIN,
  PHONE_MAX,
  SCHEDULE_MAX,
  SERVICES_MAX_ITEMS,
  SERVICE_MAX,
  SOURCE_MAX,
  TOLERANCE_DEFAULT,
  TOLERANCE_MAX,
  TOLERANCE_MIN,
  UNIT_KEY_MAX,
  checkCoordinates,
  collapseSpaces,
  compatibleUnitKeys,
  defaultTimezoneFor,
  isHttpUrlList,
  matchMexicoTimezone,
  namePlaceKey,
  normalizeText,
  parseDateText,
  parseDecimalText,
  parseServices,
  sameServices,
  slugify,
  unitKeyKey,
  type VerificationStatus,
} from "@/lib/validation/facility";

// ---------------------------------------------------------------------------
// Columnas
// ---------------------------------------------------------------------------

export const FACILITY_IMPORT_HEADERS = [
  "identificador_interno",
  "nombre_oficial",
  "clave_unidad",
  "categoria",
  "descripcion",
  "estado",
  "municipio",
  "direccion",
  "latitud",
  "longitud",
  "telefono",
  "horario",
  "servicios",
  "servicios_verificados",
  "fuente",
  "url_fuente",
  "fecha_verificacion",
  "estado_verificacion",
  "observaciones",
  "zona_horaria",
  "tolerancia_minutos",
] as const;
export type FacilityImportHeader = (typeof FACILITY_IMPORT_HEADERS)[number];

export const FACILITY_REQUIRED_HEADERS = ["nombre_oficial", "categoria", "estado", "municipio", "fuente"] as const satisfies readonly FacilityImportHeader[];

/** Encabezados alternos aceptados (ya normalizados como en parse.ts). */
const HEADER_ALIASES: Record<string, FacilityImportHeader> = {
  id_interno: "identificador_interno",
  codigo_interno: "identificador_interno",
  identificador: "identificador_interno",
  nombre: "nombre_oficial",
  nombre_de_la_unidad: "nombre_oficial",
  nombre_de_la_instalacion: "nombre_oficial",
  clave: "clave_unidad",
  clave_de_unidad: "clave_unidad",
  clave_de_la_unidad: "clave_unidad",
  categoria_de_la_instalacion: "categoria",
  tipo: "categoria",
  tipo_de_unidad: "categoria",
  entidad: "estado",
  entidad_federativa: "estado",
  domicilio: "direccion",
  lat: "latitud",
  latitude: "latitud",
  lng: "longitud",
  lon: "longitud",
  long: "longitud",
  longitude: "longitud",
  tel: "telefono",
  telefono_institucional: "telefono",
  horario_de_atencion: "horario",
  servicios_verificado: "servicios_verificados",
  fuente_de_informacion: "fuente",
  fuente_de_la_informacion: "fuente",
  url: "url_fuente",
  url_de_la_fuente: "url_fuente",
  enlace_fuente: "url_fuente",
  fecha_de_verificacion: "fecha_verificacion",
  ultima_verificacion: "fecha_verificacion",
  fecha_ultima_verificacion: "fecha_verificacion",
  verificacion: "estado_verificacion",
  estado_de_verificacion: "estado_verificacion",
  notas: "observaciones",
  comentarios: "observaciones",
  zona: "zona_horaria",
  timezone: "zona_horaria",
  tolerancia: "tolerancia_minutos",
  tolerancia_de_llegada: "tolerancia_minutos",
  tolerancia_llegada_minutos: "tolerancia_minutos",
};

export function canonicalHeader(header: string): FacilityImportHeader | null {
  if ((FACILITY_IMPORT_HEADERS as readonly string[]).includes(header)) return header as FacilityImportHeader;
  return HEADER_ALIASES[header] ?? null;
}

export type HeaderCheck = { missing: FacilityImportHeader[]; unknown: string[]; duplicated: FacilityImportHeader[] };

/** Revisa encabezados (normalizados): obligatorios, desconocidos y repetidos. */
export function checkFacilityHeaders(headers: string[]): HeaderCheck {
  const seen = new Set<FacilityImportHeader>();
  const unknown: string[] = [];
  const duplicated: FacilityImportHeader[] = [];
  for (const h of headers) {
    const c = canonicalHeader(h);
    if (!c) {
      unknown.push(h);
      continue;
    }
    if (seen.has(c) && !duplicated.includes(c)) duplicated.push(c);
    seen.add(c);
  }
  const missing = FACILITY_REQUIRED_HEADERS.filter((h) => !seen.has(h));
  return { missing, unknown, duplicated };
}

type CanonicalRow = Partial<Record<FacilityImportHeader, string>>;

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

/** Avisos por encabezados desconocidos o repetidos. */
export function headerWarnings(check: HeaderCheck): string[] {
  const out: string[] = [];
  if (check.unknown.length) out.push(`Columnas no reconocidas (se ignoran): ${check.unknown.join(", ")}.`);
  if (check.duplicated.length) out.push(`Columnas repetidas (se usa el primer valor no vacío): ${check.duplicated.join(", ")}.`);
  return out;
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export const FACILITY_IMPORT_MODES = ["crear_actualizar", "solo_crear"] as const;
export type FacilityImportMode = (typeof FACILITY_IMPORT_MODES)[number];

export const IMPORT_MODE_LABELS: Record<FacilityImportMode, string> = {
  crear_actualizar: "Crear y actualizar",
  solo_crear: "Solo crear (omitir las que ya existen)",
};

export type FacilityImportStatus = "nueva" | "actualizacion" | "duplicada" | "error";

export const IMPORT_STATUS_LABELS: Record<FacilityImportStatus, string> = {
  nueva: "Nueva",
  actualizacion: "Actualización",
  duplicada: "Duplicada",
  error: "Error",
};

export const IMPORT_STATUS_TONE: Record<FacilityImportStatus, Tone> = {
  nueva: "success",
  actualizacion: "info",
  duplicada: "warning",
  error: "danger",
};

export type ImportCategoryRef = { id: number; slug: string; name: string; active: boolean };
export type ImportStateRef = { id: number; name: string; abbreviation: string; default_timezone: string };
export type ImportMunicipalityRef = { id: number; state_id: number; name: string; inegi_code: string; timezone: string | null };

export type FacilityImportCatalogs = {
  categories: ImportCategoryRef[];
  states: ImportStateRef[];
  municipalities: ImportMunicipalityRef[];
};

/** Valores que la importación escribe (alta o actualización). */
export type FacilityWriteValues = {
  official_name: string;
  unit_key: string | null;
  category_id: number;
  description: string | null;
  state_id: number;
  municipality_id: number;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  schedule: string | null;
  services: string[];
  services_verified: boolean;
  source: string;
  source_url: string | null;
  last_verified_at: string | null;
  verification_status: VerificationStatus;
  notes: string | null;
  timezone: string;
  arrival_tolerance_minutes: number;
};

export type FacilityCreateValues = FacilityWriteValues & { is_demo: boolean };

/** Instalación registrada (visible para administración). */
export type ExistingFacilityRef = FacilityWriteValues & {
  id: string;
  internal_code: string;
  is_demo: boolean;
  active: boolean;
};

export type FacilityImportOptions = {
  /** Las altas se marcan como datos de demostración. */
  markDemo?: boolean;
  /** Hoy (yyyy-MM-dd) para rechazar fechas de verificación futuras. */
  today?: string;
};

export type FacilityImportRowResult = {
  /** Número de fila en el archivo (encabezado = fila 1). */
  row: number;
  status: FacilityImportStatus;
  messages: string[];
  name: string;
  /** «Municipio, Estado» final (o el texto capturado si no se resolvió). */
  place: string | null;
  category: string | null;
  /** Registro existente que se actualiza (o con el que se duplica). */
  targetId: string | null;
  targetCode: string | null;
  /** Valores completos para crear (status = nueva). */
  create: FacilityCreateValues | null;
  /** Solo los campos que cambian (status = actualizacion). */
  patch: Partial<FacilityWriteValues> | null;
  /** Etiquetas de los campos que cambian (actualización). */
  changes: string[];
  /** Actualización sin cambios: no se escribe nada. */
  noop: boolean;
};

export type FacilityImportSummary = {
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

export type FacilityImportResult = { rows: FacilityImportRowResult[]; summary: FacilityImportSummary };

export const FIELD_LABELS: Record<keyof FacilityWriteValues, string> = {
  official_name: "nombre oficial",
  unit_key: "clave de unidad",
  category_id: "categoría",
  description: "descripción",
  state_id: "estado",
  municipality_id: "municipio",
  address: "dirección",
  latitude: "latitud",
  longitude: "longitud",
  phone: "teléfono",
  schedule: "horario",
  services: "servicios",
  services_verified: "servicios verificados",
  source: "fuente",
  source_url: "URL de la fuente",
  last_verified_at: "fecha de verificación",
  verification_status: "estado de verificación",
  notes: "observaciones",
  timezone: "zona horaria",
  arrival_tolerance_minutes: "tolerancia de llegada",
};

// ---------------------------------------------------------------------------
// Resolución de catálogos y valores
// ---------------------------------------------------------------------------

type Resolved<T> = { value: T } | { error: string };

/** Sí/no en español o inglés; null si está vacío o no se reconoce. */
export function parseYesNo(value: string | null | undefined): boolean | null {
  const v = normalizeText(value);
  if (!v) return null;
  if (["si", "s", "true", "1", "verdadero", "x", "yes", "y", "verificado", "verificados"].includes(v)) return true;
  if (["no", "n", "false", "0", "falso", "sin verificar", "pendiente"].includes(v)) return false;
  return null;
}

/** «verificado», «verificada», «sí» → verificado; «pendiente», «no» → pendiente. */
export function parseVerificationStatus(value: string | null | undefined): VerificationStatus | null {
  const v = normalizeText(value);
  if (!v) return null;
  if (["verificado", "verificada", "si", "verified", "1", "true"].includes(v)) return "verificado";
  if (["pendiente", "pendiente de verificacion", "sin verificar", "no", "no verificado", "no verificada", "pending", "0", "false"].includes(v)) {
    return "pendiente";
  }
  return null;
}

export function resolveCategory(value: string, categories: ImportCategoryRef[]): Resolved<ImportCategoryRef> {
  const v = value.trim();
  const lower = v.toLowerCase();
  const bySlug = categories.find((c) => c.slug === lower) ?? categories.find((c) => c.slug === slugify(v));
  if (bySlug) return { value: bySlug };
  const n = normalizeText(v);
  const byName = categories.find((c) => normalizeText(c.name) === n);
  if (byName) return { value: byName };
  const available = categories
    .filter((c) => c.active)
    .map((c) => c.slug)
    .join(", ");
  return { error: `No se reconoce la categoría «${v}». Usa el identificador (slug) o el nombre de una categoría registrada: ${available}.` };
}

export function resolveState(value: string, states: ImportStateRef[]): Resolved<ImportStateRef> {
  const v = value.trim();
  if (/^\d{1,2}$/.test(v)) {
    const byId = states.find((s) => s.id === Number(v));
    if (byId) return { value: byId };
  }
  const upper = v.toUpperCase().replace(/\./g, "");
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

export function resolveMunicipality(value: string, state: ImportStateRef, municipalities: ImportMunicipalityRef[]): Resolved<ImportMunicipalityRef> {
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
  if (inState.length === 0) return { error: `No hay municipios cargados para ${state.name}: no se pueden registrar instalaciones en ese estado.` };
  return { error: `El municipio «${v}» no corresponde a ${state.name}.` };
}

// ---------------------------------------------------------------------------
// Lectura de celdas
// ---------------------------------------------------------------------------

/** Celdas ya validadas de una fila (undefined = celda vacía). */
type ParsedCells = {
  internalCode: string | undefined;
  name: string;
  unitKey: string | undefined;
  category: ImportCategoryRef | undefined;
  description: string | undefined;
  state: ImportStateRef | undefined;
  municipality: ImportMunicipalityRef | undefined;
  address: string | undefined;
  /** Par de coordenadas capturado (undefined = ambas vacías). */
  coords: { latitude: number; longitude: number } | undefined;
  phone: string | undefined;
  schedule: string | undefined;
  services: string[] | undefined;
  servicesVerified: boolean | undefined;
  source: string;
  sourceUrl: string | undefined;
  verifiedAt: string | undefined;
  verificationStatus: VerificationStatus | undefined;
  notes: string | undefined;
  timezone: string | undefined;
  tolerance: number | undefined;
};

function optionalCell(value: string | undefined, max: number, label: string, errors: string[], keepLines = false): string | undefined {
  if (value === undefined) return undefined;
  const v = keepLines ? value.trim() : collapseSpaces(value);
  if (!v) return undefined;
  if (v.length > max) errors.push(`${label}: máximo ${max} caracteres.`);
  return v;
}

function parseCells(cells: CanonicalRow, catalogs: FacilityImportCatalogs, options: FacilityImportOptions, errors: string[]): ParsedCells {
  const internalCode = cells.identificador_interno?.trim().toUpperCase() || undefined;

  const name = collapseSpaces(cells.nombre_oficial ?? "");
  if (!name) errors.push("Falta el nombre oficial.");
  else if (name.length < OFFICIAL_NAME_MIN) errors.push(`El nombre oficial debe tener al menos ${OFFICIAL_NAME_MIN} caracteres.`);
  else if (name.length > OFFICIAL_NAME_MAX) errors.push(`El nombre oficial admite máximo ${OFFICIAL_NAME_MAX} caracteres.`);
  if (normalizeText(name).startsWith("[ejemplo]")) {
    errors.push("Es la fila de ejemplo de la plantilla: bórrala o reemplázala con datos reales.");
  }

  const unitKey = cells.clave_unidad ? collapseSpaces(cells.clave_unidad) || undefined : undefined;
  if (unitKey && unitKey.length > UNIT_KEY_MAX) errors.push(`La clave de unidad admite máximo ${UNIT_KEY_MAX} caracteres.`);

  let category: ImportCategoryRef | undefined;
  if (cells.categoria?.trim()) {
    const r = resolveCategory(cells.categoria, catalogs.categories);
    if ("error" in r) errors.push(r.error);
    else category = r.value;
  } else errors.push("Falta la categoría.");

  let state: ImportStateRef | undefined;
  if (cells.estado?.trim()) {
    const r = resolveState(cells.estado, catalogs.states);
    if ("error" in r) errors.push(r.error);
    else state = r.value;
  } else errors.push("Falta el estado.");

  const municipalityText = cells.municipio?.trim() || undefined;
  let municipality: ImportMunicipalityRef | undefined;
  if (!municipalityText) errors.push("Falta el municipio.");
  else if (state) {
    const r = resolveMunicipality(municipalityText, state, catalogs.municipalities);
    if ("error" in r) errors.push(r.error);
    else municipality = r.value;
  }

  const description = optionalCell(cells.descripcion, DESCRIPTION_MAX, "Descripción", errors, true);
  const address = optionalCell(cells.direccion, ADDRESS_MAX, "Dirección", errors);
  const phone = optionalCell(cells.telefono, PHONE_MAX, "Teléfono", errors);
  const schedule = optionalCell(cells.horario, SCHEDULE_MAX, "Horario", errors, true);
  const notes = optionalCell(cells.observaciones, NOTES_MAX, "Observaciones", errors, true);

  // Coordenadas: juntas o ninguna, dentro de México.
  let coords: ParsedCells["coords"];
  const latText = cells.latitud?.trim() ?? "";
  const lngText = cells.longitud?.trim() ?? "";
  if (latText || lngText) {
    const lat = parseDecimalText(latText);
    const lng = parseDecimalText(lngText);
    if (latText && lat === null) errors.push(`Latitud inválida «${latText}»: escribe un número decimal (por ejemplo, 21.5039).`);
    if (lngText && lng === null) errors.push(`Longitud inválida «${lngText}»: escribe un número decimal negativo (por ejemplo, -104.8946).`);
    if ((!latText || lat !== null) && (!lngText || lng !== null)) {
      const check = checkCoordinates(latText ? lat : null, lngText ? lng : null);
      if (!check.ok) errors.push(check.message);
      else if (check.latitude !== null && check.longitude !== null) coords = { latitude: check.latitude, longitude: check.longitude };
    }
  }

  let services: string[] | undefined;
  if (cells.servicios?.trim()) {
    services = parseServices(cells.servicios, { allowInlineSeparators: true });
    if (services.length > SERVICES_MAX_ITEMS) errors.push(`Máximo ${SERVICES_MAX_ITEMS} servicios por instalación.`);
    if (services.some((s) => s.length > SERVICE_MAX)) errors.push(`Cada servicio admite máximo ${SERVICE_MAX} caracteres.`);
  }

  let servicesVerified: boolean | undefined;
  if (cells.servicios_verificados?.trim()) {
    const b = parseYesNo(cells.servicios_verificados);
    if (b === null) errors.push(`Valor de «servicios_verificados» no reconocido «${cells.servicios_verificados.trim()}». Usa «sí» o «no».`);
    else servicesVerified = b;
  }

  const source = collapseSpaces(cells.fuente ?? "");
  if (!source) errors.push("Falta la fuente de información (obligatoria en cada fila).");
  else if (source.length > SOURCE_MAX) errors.push(`La fuente admite máximo ${SOURCE_MAX} caracteres.`);

  const sourceUrl = cells.url_fuente?.trim() || undefined;
  if (sourceUrl && !isHttpUrlList(sourceUrl)) {
    errors.push(`URL de la fuente inválida «${sourceUrl}»: cada dirección debe empezar con https:// o http:// (varias, separadas por « | »).`);
  }

  let verifiedAt: string | undefined;
  if (cells.fecha_verificacion?.trim()) {
    const d = parseDateText(cells.fecha_verificacion);
    if (!d) errors.push(`Fecha de verificación inválida «${cells.fecha_verificacion.trim()}». Usa AAAA-MM-DD o DD/MM/AAAA.`);
    else if (options.today && d > options.today) errors.push("La fecha de verificación no puede ser futura.");
    else verifiedAt = d;
  }

  let verificationStatus: VerificationStatus | undefined;
  if (cells.estado_verificacion?.trim()) {
    const s = parseVerificationStatus(cells.estado_verificacion);
    if (!s) errors.push(`Estado de verificación no reconocido «${cells.estado_verificacion.trim()}». Usa «verificado» o «pendiente».`);
    else verificationStatus = s;
  }

  let timezone: string | undefined;
  if (cells.zona_horaria?.trim()) {
    const tz = matchMexicoTimezone(cells.zona_horaria);
    if (!tz) errors.push(`Zona horaria no válida «${cells.zona_horaria.trim()}». Usa una zona de México, por ejemplo America/Mazatlan o America/Mexico_City.`);
    else timezone = tz;
  }

  let tolerance: number | undefined;
  if (cells.tolerancia_minutos?.trim()) {
    const t = cells.tolerancia_minutos.trim();
    const n = /^\d{1,4}$/.test(t) ? Number(t) : NaN;
    if (!Number.isInteger(n) || n < TOLERANCE_MIN || n > TOLERANCE_MAX) {
      errors.push(`Tolerancia inválida «${t}»: número entero de ${TOLERANCE_MIN} a ${TOLERANCE_MAX} minutos.`);
    } else tolerance = n;
  }

  return {
    internalCode,
    name,
    unitKey,
    category,
    description,
    state,
    municipality,
    address,
    coords,
    phone,
    schedule,
    services,
    servicesVerified,
    source,
    sourceUrl,
    verifiedAt,
    verificationStatus,
    notes,
    timezone,
    tolerance,
  };
}

function emptyResult(row: number, name: string): FacilityImportRowResult {
  return {
    row,
    status: "error",
    messages: [],
    name,
    place: null,
    category: null,
    targetId: null,
    targetCode: null,
    create: null,
    patch: null,
    changes: [],
    noop: false,
  };
}

function describeFacility(f: ExistingFacilityRef): string {
  return `${f.internal_code} (${f.official_name})`;
}

type CatalogMaps = { states: Map<number, ImportStateRef>; municipalities: Map<number, ImportMunicipalityRef> };

function placeLabel(stateId: number, municipalityId: number | null, maps: CatalogMaps): string | null {
  const state = maps.states.get(stateId);
  if (!state) return null;
  const muni = municipalityId ? maps.municipalities.get(municipalityId) : undefined;
  return muni ? `${muni.name}, ${state.name}` : state.name;
}

function sameValue(key: keyof FacilityWriteValues, a: FacilityWriteValues[typeof key], b: FacilityWriteValues[typeof key]): boolean {
  if (key === "services") return sameServices(a as string[], b as string[]);
  return a === b;
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

/**
 * Valida las filas del archivo contra los catálogos y las instalaciones
 * registradas. No escribe nada: devuelve qué haría cada fila.
 */
export function validateFacilityRows(
  rows: RawRow[],
  catalogs: FacilityImportCatalogs,
  existing: ExistingFacilityRef[],
  mode: FacilityImportMode,
  options: FacilityImportOptions = {},
): FacilityImportResult {
  const markDemo = options.markDemo ?? false;
  const municipalityById = new Map(catalogs.municipalities.map((m) => [m.id, m]));
  const categoryById = new Map(catalogs.categories.map((c) => [c.id, c]));
  const maps: CatalogMaps = { states: new Map(catalogs.states.map((st) => [st.id, st])), municipalities: municipalityById };

  // Índices de lo registrado.
  const byCode = new Map<string, ExistingFacilityRef>();
  const byUnit = new Map<string, ExistingFacilityRef>();
  const byPlace = new Map<string, ExistingFacilityRef[]>();
  for (const f of existing) {
    byCode.set(f.internal_code.toUpperCase(), f);
    const uk = unitKeyKey(f.unit_key);
    if (uk && !byUnit.has(uk)) byUnit.set(uk, f);
    const pk = namePlaceKey(f.official_name, f.state_id, f.municipality_id);
    byPlace.set(pk, [...(byPlace.get(pk) ?? []), f]);
  }
  /** Registradas con el mismo nombre y lugar que podrían ser la misma instalación (ver compatibleUnitKeys). */
  const placeMatches = (key: string | null, unit: string | null, excludeId?: string): ExistingFacilityRef[] =>
    key ? (byPlace.get(key) ?? []).filter((f) => f.id !== excludeId && compatibleUnitKeys(unit, f.unit_key)) : [];

  // Lo visto en el archivo (primera fila que usa cada clave).
  const seenUnit = new Map<string, number>();
  const seenPlace = new Map<string, { row: number; unit: string | null }[]>();
  const firstSeenPlace = (key: string | null, unit: string | null) =>
    key ? (seenPlace.get(key) ?? []).find((e) => compatibleUnitKeys(unit, e.unit))?.row : undefined;
  const rememberPlace = (key: string | null, unit: string | null, row: number) => {
    if (key) seenPlace.set(key, [...(seenPlace.get(key) ?? []), { row, unit }]);
  };
  const seenCode = new Map<string, number>();
  const seenTarget = new Map<string, number>();
  const remember = (map: Map<string, number>, key: string | null, row: number) => {
    if (key && !map.has(key)) map.set(key, row);
  };

  const results = rows.map((raw, index): FacilityImportRowResult => {
    const rowNumber = index + 2;
    const cells = canonicalizeRow(raw);
    const errors: string[] = [];
    const p = parseCells(cells, catalogs, options, errors);
    const result = emptyResult(rowNumber, p.name || "(sin nombre)");
    result.category = p.category?.name ?? (cells.categoria?.trim() || null);
    result.place = p.state
      ? placeLabel(p.state.id, p.municipality?.id ?? null, maps)
      : [cells.municipio?.trim(), cells.estado?.trim()].filter(Boolean).join(", ") || null;

    // Claves de la fila tal como vienen en el archivo.
    const unitKey = unitKeyKey(p.unitKey);
    const placeKey = p.name && p.state && p.municipality ? namePlaceKey(p.name, p.state.id, p.municipality.id) : null;
    const firstUnitRow = unitKey ? seenUnit.get(unitKey) : undefined;
    const firstPlaceRow = firstSeenPlace(placeKey, unitKey);
    const firstCodeRow = p.internalCode ? seenCode.get(p.internalCode) : undefined;
    remember(seenUnit, unitKey, rowNumber);
    rememberPlace(placeKey, unitKey, rowNumber);
    remember(seenCode, p.internalCode ?? null, rowNumber);

    if (errors.length > 0 || !p.category || !p.state || !p.municipality) {
      result.messages = errors.length > 0 ? errors : ["Fila incompleta."];
      return result;
    }
    const state = p.state;
    const category = p.category;
    const municipality = p.municipality;

    // --- Duplicados dentro del archivo ---
    if (firstCodeRow !== undefined) {
      result.status = "duplicada";
      result.messages = [`El identificador interno «${p.internalCode}» se repite: ya aparece en la fila ${firstCodeRow}.`];
      return result;
    }
    if (firstUnitRow !== undefined) {
      result.status = "duplicada";
      result.messages = [`La clave de unidad «${p.unitKey}» se repite: ya aparece en la fila ${firstUnitRow}.`];
      return result;
    }
    if (firstPlaceRow !== undefined) {
      result.status = "duplicada";
      result.messages = [`Mismo nombre oficial y mismo municipio que la fila ${firstPlaceRow}.`];
      return result;
    }

    // --- Coincidencias con lo registrado ---
    let target: ExistingFacilityRef | undefined;
    if (p.internalCode) {
      target = byCode.get(p.internalCode);
      if (!target) {
        result.messages = [
          `No existe una instalación con el identificador interno «${p.internalCode}». Lo asigna la plataforma: déjalo vacío para crear una nueva.`,
        ];
        return result;
      }
    }
    const matchUnit = unitKey ? byUnit.get(unitKey) : undefined;
    if (target && matchUnit && matchUnit.id !== target.id) {
      result.status = "duplicada";
      result.targetId = matchUnit.id;
      result.targetCode = matchUnit.internal_code;
      result.messages = [`La clave de unidad «${p.unitKey}» ya pertenece a ${describeFacility(matchUnit)}.`];
      return result;
    }
    target = target ?? matchUnit;
    if (!target) {
      // Sin identificador ni clave registrada: por nombre y lugar, sin adivinar
      // cuál actualizar si hay varias unidades co-ubicadas con ese nombre.
      const candidates = placeMatches(placeKey, unitKey);
      if (candidates.length > 1) {
        result.status = "duplicada";
        result.messages = [
          `Hay ${candidates.length} instalaciones con ese nombre en ese municipio (${candidates.map((f) => f.internal_code).join(", ")}); indica clave_unidad o identificador_interno.`,
        ];
        return result;
      }
      target = candidates[0];
    }

    if (!target) {
      // --- Nueva ---
      if (!category.active) {
        result.messages = [`La categoría «${category.name}» está inactiva. Actívala o usa otra categoría.`];
        return result;
      }
      const services = p.services ?? [];
      const servicesVerified = p.servicesVerified ?? false;
      if (servicesVerified && services.length === 0) {
        result.messages = ["Marcaste los servicios como verificados, pero la columna «servicios» está vacía."];
        return result;
      }
      const verificationStatus = p.verificationStatus ?? "pendiente";
      if (verificationStatus === "verificado" && !p.verifiedAt) {
        result.messages = ["Para marcar como verificada indica la fecha de verificación (columna «fecha_verificacion»)."];
        return result;
      }
      result.status = "nueva";
      result.create = {
        official_name: p.name,
        unit_key: p.unitKey ?? null,
        category_id: category.id,
        description: p.description ?? null,
        state_id: state.id,
        municipality_id: municipality.id,
        address: p.address ?? null,
        latitude: p.coords?.latitude ?? null,
        longitude: p.coords?.longitude ?? null,
        phone: p.phone ?? null,
        schedule: p.schedule ?? null,
        services,
        services_verified: servicesVerified,
        source: p.source,
        source_url: p.sourceUrl ?? null,
        last_verified_at: p.verifiedAt ?? null,
        verification_status: verificationStatus,
        notes: p.notes ?? null,
        timezone: p.timezone ?? defaultTimezoneFor(state.default_timezone, municipality.timezone),
        arrival_tolerance_minutes: p.tolerance ?? TOLERANCE_DEFAULT,
        is_demo: markDemo,
      };
      const notes = [`Se creará una instalación nueva en ${result.place ?? state.name}.`];
      if (markDemo) notes.push("Se marcará como dato de demostración.");
      if (!p.coords) notes.push("Sin coordenadas: no aparecerá en el mapa.");
      if (!p.timezone) notes.push(`Zona horaria por omisión: ${result.create.timezone}.`);
      result.messages = notes;
      return result;
    }

    // --- Ya existe ---
    result.targetId = target.id;
    result.targetCode = target.internal_code;

    if (mode === "solo_crear") {
      result.status = "duplicada";
      const reason = p.internalCode
        ? "con ese identificador interno"
        : matchUnit
          ? "con esa clave de unidad"
          : "con el mismo nombre oficial en el mismo estado y municipio";
      result.messages = [`Ya existe una instalación ${reason}: ${describeFacility(target)}. Se omite (modo «solo crear»).`];
      return result;
    }

    const firstTargetRow = seenTarget.get(target.id);
    if (firstTargetRow !== undefined) {
      result.status = "duplicada";
      result.messages = [`La fila ${firstTargetRow} ya actualiza a ${describeFacility(target)}.`];
      return result;
    }
    seenTarget.set(target.id, rowNumber);

    // Valores finales (las celdas opcionales vacías conservan lo registrado;
    // estado y municipio se exigen siempre, así que la ubicación nunca queda a medias).
    const notes: string[] = [];
    const locationChanged = state.id !== target.state_id || municipality.id !== target.municipality_id;
    let timezone = target.timezone;
    if (p.timezone) timezone = p.timezone;
    else if (locationChanged) {
      timezone = defaultTimezoneFor(state.default_timezone, municipality.timezone);
      if (timezone !== target.timezone) notes.push(`La zona horaria se ajusta a la de la nueva ubicación (${timezone}).`);
    }

    const final: FacilityWriteValues = {
      official_name: p.name,
      // Una clave igual sin distinguir mayúsculas no cuenta como cambio.
      unit_key: p.unitKey && unitKeyKey(p.unitKey) !== unitKeyKey(target.unit_key) ? p.unitKey : target.unit_key,
      category_id: category.id,
      description: p.description ?? target.description,
      state_id: state.id,
      municipality_id: municipality.id,
      address: p.address ?? target.address,
      latitude: p.coords ? p.coords.latitude : target.latitude,
      longitude: p.coords ? p.coords.longitude : target.longitude,
      phone: p.phone ?? target.phone,
      schedule: p.schedule ?? target.schedule,
      services: p.services ?? target.services,
      services_verified: p.servicesVerified ?? target.services_verified,
      source: p.source,
      source_url: p.sourceUrl ?? target.source_url,
      last_verified_at: p.verifiedAt ?? target.last_verified_at,
      verification_status: p.verificationStatus ?? target.verification_status,
      notes: p.notes ?? target.notes,
      timezone,
      arrival_tolerance_minutes: p.tolerance ?? target.arrival_tolerance_minutes,
    };

    if (final.category_id !== target.category_id && !category.active) {
      result.messages = [`La categoría «${category.name}» está inactiva. Actívala o usa otra categoría.`];
      return result;
    }
    if (final.services_verified && final.services.length === 0) {
      result.messages = ["Los servicios quedarían marcados como verificados sin ningún servicio capturado."];
      return result;
    }
    if (final.verification_status === "verificado" && !final.last_verified_at) {
      result.messages = ["Para marcar como verificada indica la fecha de verificación (columna «fecha_verificacion»)."];
      return result;
    }

    // Otra instalación registrada con la misma clave o el mismo nombre y lugar.
    const finalUnit = unitKeyKey(final.unit_key);
    const unitClash = finalUnit ? byUnit.get(finalUnit) : undefined;
    if (unitClash && unitClash.id !== target.id) {
      result.status = "duplicada";
      result.messages = [`La clave de unidad «${final.unit_key}» ya pertenece a ${describeFacility(unitClash)}.`];
      return result;
    }
    const finalPlace = namePlaceKey(final.official_name, final.state_id, final.municipality_id);
    const placeClash = placeMatches(finalPlace, finalUnit, target.id)[0];
    if (placeClash) {
      result.status = "duplicada";
      result.messages = [`Ya existe ${describeFacility(placeClash)} con el mismo nombre oficial en el mismo estado y municipio.`];
      return result;
    }
    // Las claves finales también cuentan para las filas siguientes.
    remember(seenUnit, finalUnit, rowNumber);
    if (finalPlace !== placeKey) rememberPlace(finalPlace, finalUnit, rowNumber);

    const patch: Partial<FacilityWriteValues> = {};
    const changes: string[] = [];
    for (const key of Object.keys(final) as (keyof FacilityWriteValues)[]) {
      if (!sameValue(key, final[key], target[key])) {
        (patch as Record<string, unknown>)[key] = final[key];
        changes.push(FIELD_LABELS[key]);
      }
    }
    if (patch.official_name) notes.unshift(`Cambia el nombre de «${target.official_name}» a «${final.official_name}».`);
    if (patch.category_id) notes.push(`Cambia la categoría a «${categoryById.get(final.category_id)?.name ?? final.category_id}».`);
    if (!target.active) notes.push("La instalación está inactiva: se actualiza sin reactivarla.");
    if (target.is_demo !== markDemo) {
      notes.push(target.is_demo ? "El registro existente es de demostración y conserva esa marca." : "El registro existente es de producción y conserva esa marca.");
    }

    result.status = "actualizacion";
    result.patch = changes.length > 0 ? patch : null;
    result.changes = changes;
    result.noop = changes.length === 0;
    result.place = placeLabel(final.state_id, final.municipality_id, maps) ?? result.place;
    result.messages = [
      result.noop
        ? `Coincide con ${describeFacility(target)}. Sin cambios: no se modificará.`
        : `Actualiza a ${describeFacility(target)}. Cambia: ${changes.join(", ")}.`,
      ...notes,
    ];
    return result;
  });

  return { rows: results, summary: summarizeImport(results) };
}

export function summarizeImport(rows: FacilityImportRowResult[]): FacilityImportSummary {
  const s: FacilityImportSummary = { total: rows.length, nueva: 0, actualizacion: 0, duplicada: 0, error: 0, sinCambios: 0, aplicables: 0 };
  for (const r of rows) {
    s[r.status] += 1;
    if (r.status === "actualizacion" && r.noop) s.sinCambios += 1;
    if (r.status === "nueva" || (r.status === "actualizacion" && !r.noop)) s.aplicables += 1;
  }
  return s;
}

/** Resumen legible para la interfaz. */
export function describeSummary(s: FacilityImportSummary): string {
  const parts = [
    `${s.nueva} ${s.nueva === 1 ? "nueva" : "nuevas"}`,
    `${s.actualizacion} ${s.actualizacion === 1 ? "actualización" : "actualizaciones"}${s.sinCambios ? ` (${s.sinCambios} sin cambios)` : ""}`,
    `${s.duplicada} ${s.duplicada === 1 ? "duplicada" : "duplicadas"}`,
    `${s.error} con error`,
  ];
  return `${s.total} ${s.total === 1 ? "fila" : "filas"}: ${parts.join(", ")}.`;
}

/** Motivo que se guarda en la bitácora al importar. */
export function importReason(fileName: string): string {
  const name = collapseSpaces(fileName).slice(0, 200) || "archivo";
  return `Importación: ${name}`;
}

// ---------------------------------------------------------------------------
// Resultado que se envía al navegador
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
  status: FacilityImportStatus;
  name: string;
  place: string | null;
  category: string | null;
  targetCode: string | null;
  messages: string[];
  applied?: ImportApplyResult;
};

export type FacilityImportOutcome = {
  intent: "validar" | "importar";
  fingerprint: string;
  fileName: string;
  mode: FacilityImportMode;
  markDemo: boolean;
  summary: FacilityImportSummary;
  warnings: string[];
  rows: ImportPreviewRow[];
  applied?: { created: number; updated: number; unchanged: number; failed: number };
};

export function toPreviewRows(rows: FacilityImportRowResult[]): ImportPreviewRow[] {
  return rows.map((r) => ({
    row: r.row,
    status: r.status,
    name: r.name,
    place: r.place,
    category: r.category,
    targetCode: r.targetCode,
    messages: r.messages,
  }));
}
