import type { Database } from "@/lib/types/database";

/** Fila de la vista pública (todas las columnas llegan como opcionales). */
export type PublicFacilityRow = Database["public"]["Views"]["public_facilities"]["Row"];

export type VerificationStatus = Database["public"]["Enums"]["verification_status"];

/**
 * Ficha pública completa de una instalación (solo columnas de public_facilities).
 * Nunca incluye trabajadores, teléfonos personales ni guardias.
 */
export type PublicFacilityDetail = {
  id: string;
  internalCode: string;
  name: string;
  unitKey: string | null;
  categoryId: number | null;
  description: string | null;
  stateId: number | null;
  municipalityId: number | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Teléfono institucional de la instalación (no personal). */
  phone: string | null;
  schedule: string | null;
  /** Solo trae elementos cuando servicesVerified es verdadero (la vista lo garantiza). */
  services: string[];
  servicesVerified: boolean;
  source: string;
  sourceUrl: string | null;
  /** Fecha (yyyy-MM-dd) sin hora. */
  lastVerifiedAt: string | null;
  verificationStatus: VerificationStatus;
  notes: string | null;
  timezone: string | null;
  isDemo: boolean;
  updatedAt: string | null;
};

/** Datos mínimos que viajan al navegador para la lista, la búsqueda y el mapa. */
export type DirectoryFacility = {
  id: string;
  internalCode: string;
  name: string;
  unitKey: string | null;
  categoryId: number | null;
  stateId: number | null;
  municipalityId: number | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  verified: boolean;
  isDemo: boolean;
};

export type CategoryOption = {
  id: number;
  slug: string;
  name: string;
  color: string;
  /** Valor de facility_categories.icon (ver resolveCategoryIcon en ./icons). */
  icon: string;
  active: boolean;
};
export type StateOption = { id: number; name: string; abbreviation: string };
export type MunicipalityOption = {
  id: number;
  stateId: number;
  name: string;
  /** Clave INEGI del municipio (3 dígitos). */
  inegiCode: string;
  /**
   * Nombre para mostrar: igual a `name`, o con la clave INEGI cuando el nombre
   * se repite dentro del estado (p. ej. en Oaxaca).
   */
  label: string;
};

/** Catálogos para mostrar nombres de categoría, estado y municipio. */
export type DirectoryLookups = {
  categories: CategoryOption[];
  states: StateOption[];
  municipalities: MunicipalityOption[];
};

/** Filtros de búsqueda (los mismos que viajan en la URL). */
export type DirectoryFilters = {
  q: string;
  /** slug de la categoría */
  categoria: string;
  /** id del estado (clave INEGI) */
  estado: number | null;
  /** id del municipio */
  municipio: number | null;
};

export type DirectoryView = "lista" | "mapa";

export type DirectoryParams = DirectoryFilters & {
  vista: DirectoryView;
  /** Cantidad de resultados visibles en la lista (paginación sin JavaScript). */
  limite: number | null;
};
