import type { DirectoryFacility, PublicFacilityDetail, PublicFacilityRow } from "./types";

/** Columnas que se piden a public_facilities (todas son públicas). */
export const PUBLIC_FACILITY_COLUMNS =
  "id, internal_code, official_name, unit_key, category_id, description, state_id, municipality_id, address, latitude, longitude, phone, schedule, services, services_verified, source, source_url, last_verified_at, verification_status, notes, timezone, is_demo, updated_at";

/** Columnas mínimas para la lista y el mapa. */
export const DIRECTORY_LIST_COLUMNS =
  "id, internal_code, official_name, unit_key, category_id, state_id, municipality_id, address, latitude, longitude, verification_status, is_demo";

const blank = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Convierte una fila de la vista en ficha; descarta filas sin id o nombre. */
export function toPublicFacilityDetail(row: Partial<PublicFacilityRow>): PublicFacilityDetail | null {
  if (!row.id || !blank(row.official_name)) return null;
  const servicesVerified = row.services_verified === true;
  const latitude = num(row.latitude);
  const longitude = num(row.longitude);
  const pair = latitude != null && longitude != null;
  return {
    id: row.id,
    internalCode: blank(row.internal_code) ?? "—",
    name: blank(row.official_name)!,
    unitKey: blank(row.unit_key),
    categoryId: row.category_id ?? null,
    description: blank(row.description),
    stateId: row.state_id ?? null,
    municipalityId: row.municipality_id ?? null,
    address: blank(row.address),
    latitude: pair ? latitude : null,
    longitude: pair ? longitude : null,
    phone: blank(row.phone),
    schedule: blank(row.schedule),
    // Defensa adicional: la vista ya vacía los servicios no verificados.
    services: servicesVerified ? (row.services ?? []).map((s) => s.trim()).filter(Boolean) : [],
    servicesVerified,
    source: blank(row.source) ?? "Sin fuente registrada",
    sourceUrl: blank(row.source_url),
    lastVerifiedAt: row.last_verified_at ?? null,
    verificationStatus: row.verification_status === "verificado" ? "verificado" : "pendiente",
    notes: blank(row.notes),
    timezone: blank(row.timezone),
    isDemo: row.is_demo === true,
    updatedAt: row.updated_at ?? null,
  };
}

/** Versión compacta para el navegador (lista, búsqueda y mapa). */
export function toDirectoryFacility(row: Partial<PublicFacilityRow>): DirectoryFacility | null {
  const d = toPublicFacilityDetail(row);
  return d ? toDirectoryFacilityFromDetail(d) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Versión compacta a partir de una ficha ya convertida. */
export function toDirectoryFacilityFromDetail(d: PublicFacilityDetail): DirectoryFacility {
  return {
    id: d.id,
    internalCode: d.internalCode,
    name: d.name,
    unitKey: d.unitKey,
    categoryId: d.categoryId,
    stateId: d.stateId,
    municipalityId: d.municipalityId,
    address: d.address,
    latitude: d.latitude,
    longitude: d.longitude,
    verified: d.verificationStatus === "verificado",
    isDemo: d.isDemo,
  };
}
