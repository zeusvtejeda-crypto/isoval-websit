/**
 * PostgREST limita las respuestas (1000 filas por omisión). Esta función pagina
 * hasta obtener todo, para que reportes y exportaciones no se trunquen en silencio.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  throw new Error(`La consulta supera el máximo de ${maxRows} filas; acota los filtros.`);
}

/** Divide una lista para filtros `in (...)` sin exceder la longitud de URL. */
export function chunk<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
