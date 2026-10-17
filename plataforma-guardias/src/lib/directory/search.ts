import type { CategoryOption, DirectoryFacility, DirectoryFilters, DirectoryLookups, MunicipalityOption, StateOption } from "./types";

/**
 * Normaliza texto para buscar: sin acentos ni diéresis, minúsculas, sin signos
 * de puntuación (se conserva el guion de las claves) y espacios simples.
 * "Bahía de Banderas" → "bahia de banderas"; "Tépic," → "tepic".
 */
export function normalizeSearch(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Solo letras y números: "DEMO-H01" → "demoh01". Sirve para claves escritas sin guion. */
export function compactSearch(value: string | null | undefined): string {
  return normalizeSearch(value).replace(/[^a-z0-9]/g, "");
}

/** Palabras de la búsqueda ya normalizadas. */
export function searchTokens(query: string | null | undefined): string[] {
  const normalized = normalizeSearch(query);
  return normalized ? normalized.split(" ") : [];
}

export type IndexedFacility = DirectoryFacility & {
  categorySlug: string | null;
  /** Texto normalizado: nombre, claves, municipio, estado y dirección. */
  haystack: string;
  /** Igual que haystack pero solo letras y números (claves sin guion). */
  compactHaystack: string;
  normalizedName: string;
  compactUnitKey: string;
};

export type LookupMaps = {
  categories: Map<number, CategoryOption>;
  states: Map<number, StateOption>;
  municipalities: Map<number, MunicipalityOption>;
};

export function buildLookupMaps(lookups: DirectoryLookups): LookupMaps {
  return {
    categories: new Map(lookups.categories.map((c) => [c.id, c])),
    states: new Map(lookups.states.map((s) => [s.id, s])),
    municipalities: new Map(lookups.municipalities.map((m) => [m.id, m])),
  };
}

/** Prepara las instalaciones para filtrar rápido en el navegador. */
export function buildSearchIndex(facilities: DirectoryFacility[], maps: LookupMaps): IndexedFacility[] {
  return facilities.map((f) => {
    const category = f.categoryId != null ? maps.categories.get(f.categoryId) : undefined;
    const state = f.stateId != null ? maps.states.get(f.stateId) : undefined;
    const municipality = f.municipalityId != null ? maps.municipalities.get(f.municipalityId) : undefined;
    const parts = [f.name, f.unitKey, f.internalCode, municipality?.name, state?.name, state?.abbreviation, f.address];
    const haystack = normalizeSearch(parts.filter(Boolean).join(" | "));
    return {
      ...f,
      categorySlug: category?.slug ?? null,
      haystack,
      compactHaystack: haystack.replace(/[^a-z0-9]/g, ""),
      normalizedName: normalizeSearch(f.name),
      compactUnitKey: compactSearch(f.unitKey),
    };
  });
}

function matchesTokens(item: IndexedFacility, tokens: string[]): boolean {
  return tokens.every((token) => {
    if (item.haystack.includes(token)) return true;
    const compact = token.replace(/[^a-z0-9]/g, "");
    return compact.length > 0 && item.compactHaystack.includes(compact);
  });
}

/** 0 = clave de unidad exacta, 1 = el nombre contiene todas las palabras, 2 = otro campo. */
function relevance(item: IndexedFacility, tokens: string[], compactQuery: string): number {
  if (compactQuery && item.compactUnitKey === compactQuery) return 0;
  if (tokens.every((t) => item.normalizedName.includes(t))) return 1;
  return 2;
}

/**
 * Filtra por texto (insensible a acentos y mayúsculas; todas las palabras deben
 * aparecer en nombre, clave de unidad, identificador, municipio, estado o
 * dirección), categoría, estado y municipio. Con búsqueda de texto ordena
 * primero la clave exacta y luego las coincidencias en el nombre; si no, conserva
 * el orden original.
 */
export function filterFacilities<T extends IndexedFacility>(items: T[], filters: DirectoryFilters): T[] {
  const tokens = searchTokens(filters.q);
  const out = items.filter((item) => {
    if (filters.categoria && item.categorySlug !== filters.categoria) return false;
    if (filters.estado != null && item.stateId !== filters.estado) return false;
    if (filters.municipio != null && item.municipalityId !== filters.municipio) return false;
    return tokens.length === 0 || matchesTokens(item, tokens);
  });
  if (tokens.length === 0) return out;
  const compactQuery = compactSearch(filters.q);
  return out
    .map((item, index) => ({ item, index, score: relevance(item, tokens, compactQuery) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((x) => x.item);
}

export function hasCoordinates<T extends { latitude: number | null; longitude: number | null }>(
  f: T,
): f is T & { latitude: number; longitude: number } {
  return (
    typeof f.latitude === "number" &&
    typeof f.longitude === "number" &&
    Number.isFinite(f.latitude) &&
    Number.isFinite(f.longitude)
  );
}

/** Municipios de un estado (o todos si no hay estado), en orden alfabético. */
export function municipalitiesForState(municipalities: MunicipalityOption[], stateId: number | null): MunicipalityOption[] {
  const list = stateId == null ? municipalities : municipalities.filter((m) => m.stateId === stateId);
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "es-MX"));
}
