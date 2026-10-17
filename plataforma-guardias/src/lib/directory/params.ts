import { z } from "zod";
import type { DirectoryFilters, DirectoryLookups, DirectoryParams, DirectoryView } from "./types";

export const DIRECTORY_PATH = "/directorio";
/** Resultados que se muestran de inicio en la lista (y cuántos agrega «Mostrar más»). */
export const LIST_STEP = 50;
const MAX_LIMIT = 10_000;
const MAX_QUERY = 120;

export const EMPTY_FILTERS: DirectoryFilters = { q: "", categoria: "", estado: null, municipio: null };

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function first(raw: RawParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const value = raw[key];
  return Array.isArray(value) ? value[0] : value;
}

const positiveInt = (max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(max));

const schema = z.object({
  q: z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY))
    .catch(""),
  categoria: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,80}$/)
    .catch(""),
  estado: positiveInt(99).nullable().catch(null),
  municipio: positiveInt(999_999).nullable().catch(null),
  vista: z.enum(["lista", "mapa"]).catch("lista"),
  limite: positiveInt(MAX_LIMIT).nullable().catch(null),
});

/** Lee los filtros de la URL; los valores inválidos se ignoran (nunca lanza). */
export function parseDirectoryParams(raw: RawParams): DirectoryParams {
  const get = (k: string) => first(raw, k) ?? null;
  const parsed = schema.parse({
    q: get("q") ?? "",
    categoria: get("categoria") ?? "",
    estado: get("estado"),
    municipio: get("municipio"),
    vista: get("vista") ?? "lista",
    limite: get("limite"),
  });
  return parsed;
}

/**
 * Ajusta los filtros a los catálogos disponibles:
 * - categoría, estado o municipio desconocidos se descartan;
 * - un municipio sin estado fija su estado;
 * - un municipio de otro estado se descarta (los municipios dependen del estado).
 */
export function reconcileFilters(filters: DirectoryFilters, lookups: DirectoryLookups): DirectoryFilters {
  const categoria = filters.categoria && lookups.categories.some((c) => c.slug === filters.categoria) ? filters.categoria : "";
  let estado = filters.estado != null && lookups.states.some((s) => s.id === filters.estado) ? filters.estado : null;
  let municipio: number | null = null;
  if (filters.municipio != null) {
    const m = lookups.municipalities.find((x) => x.id === filters.municipio);
    if (m) {
      if (estado == null && lookups.states.some((s) => s.id === m.stateId)) estado = m.stateId;
      if (m.stateId === estado) municipio = m.id;
    }
  }
  if (estado == null) municipio = null;
  return { q: filters.q, categoria, estado, municipio };
}

export function hasActiveFilters(filters: DirectoryFilters): boolean {
  return Boolean(filters.q.trim() || filters.categoria || filters.estado != null || filters.municipio != null);
}

/** Construye la URL del directorio omitiendo valores vacíos o por omisión. */
export function directoryHref(
  filters: DirectoryFilters,
  options: { vista?: DirectoryView; limite?: number | null } = {},
): string {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  if (q) params.set("q", q);
  if (filters.categoria) params.set("categoria", filters.categoria);
  if (filters.estado != null) params.set("estado", String(filters.estado));
  if (filters.municipio != null) params.set("municipio", String(filters.municipio));
  if (options.vista === "mapa") params.set("vista", "mapa");
  if (options.limite != null && options.limite > LIST_STEP) params.set("limite", String(options.limite));
  const qs = params.toString();
  return qs ? `${DIRECTORY_PATH}?${qs}` : DIRECTORY_PATH;
}

/** Formulario de edición de una instalación en administración (la ruta exige requireAdmin). */
export function facilityEditHref(id: string): string {
  return `/administracion/instalaciones/${encodeURIComponent(id)}/editar`;
}

/** Texto plural en español: "1 instalación", "3 instalaciones". */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString("es-MX")} ${count === 1 ? singular : plural}`;
}
