import type { MunicipalityOption } from "./types";

/*
 * Municipios con el mismo nombre dentro de un estado (en el catálogo nacional
 * del INEGI ocurre en Oaxaca): se distinguen con su clave INEGI.
 */

export type MunicipalityRow = { id: number; state_id: number; name: string; inegi_code: string };

const key = (stateId: number, name: string) => `${stateId}|${name.trim()}`;

/** Claves «estado|nombre» que aparecen más de una vez en las filas dadas. */
export function repeatedMunicipalityNames(rows: ReadonlyArray<Pick<MunicipalityRow, "state_id" | "name">>): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const r of rows) {
    const k = key(r.state_id, r.name);
    if (seen.has(k)) repeated.add(k);
    else seen.add(k);
  }
  return repeated;
}

/** «San Juan Mixtepec (clave INEGI 208)» si el nombre se repite; si no, el nombre. */
export function municipalityLabel(name: string, inegiCode: string | null | undefined, repeated: boolean): string {
  const code = inegiCode?.trim();
  return repeated && code ? `${name} (clave INEGI ${code})` : name;
}

/** Convierte una fila de municipalities en opción con su nombre para mostrar. */
export function toMunicipalityOption(row: MunicipalityRow, repeated: boolean): MunicipalityOption {
  return {
    id: row.id,
    stateId: row.state_id,
    name: row.name,
    inegiCode: row.inegi_code,
    label: municipalityLabel(row.name, row.inegi_code, repeated),
  };
}

/**
 * Opciones de municipio. `catalog` debe traer todos los municipios de los
 * estados involucrados (para detectar nombres repetidos aunque solo uno tenga
 * instalaciones); se devuelven solo los de `ids` (o todos si no se indica),
 * ordenados por nombre y clave.
 */
export function buildMunicipalityOptions(catalog: readonly MunicipalityRow[], ids?: ReadonlySet<number>): MunicipalityOption[] {
  const repeated = repeatedMunicipalityNames(catalog);
  return catalog
    .filter((m) => !ids || ids.has(m.id))
    .map((m) => toMunicipalityOption(m, repeated.has(key(m.state_id, m.name))))
    .sort((a, b) => a.name.localeCompare(b.name, "es-MX") || a.inegiCode.localeCompare(b.inegiCode));
}
