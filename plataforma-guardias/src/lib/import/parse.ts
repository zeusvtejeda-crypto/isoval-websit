import Papa from "papaparse";
import ExcelJS from "exceljs";

/**
 * Lectura genérica de archivos CSV o Excel (.xlsx) a filas de texto.
 * Los encabezados se normalizan (minúsculas, sin acentos, guiones bajos).
 */
export type RawRow = Record<string, string>;
export type ParsedFile = { headers: string[]; rows: RawRow[] };

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cleanRows(headers: string[], rows: string[][]): ParsedFile {
  const norm = headers.map(normalizeHeader);
  const out: RawRow[] = [];
  for (const r of rows) {
    if (r.every((c) => (c ?? "").toString().trim() === "")) continue;
    const row: RawRow = {};
    norm.forEach((h, i) => {
      if (h) row[h] = (r[i] ?? "").toString().trim();
    });
    out.push(row);
  }
  if (out.length > MAX_IMPORT_ROWS) {
    throw new Error(`El archivo tiene más de ${MAX_IMPORT_ROWS} filas. Divídelo en partes.`);
  }
  return { headers: norm.filter(Boolean), rows: out };
}

export function parseCsv(text: string): ParsedFile {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  if (result.errors.length && result.data.length === 0) {
    throw new Error("No se pudo leer el CSV: " + result.errors[0].message);
  }
  const [headers = [], ...rows] = result.data;
  return cleanRows(headers, rows);
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return value.result == null ? "" : String(value.result);
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((t) => t.text).join("");
    if ("hyperlink" in value) return String((value as { text?: string }).text ?? value.hyperlink);
    return "";
  }
  return String(value);
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("El archivo de Excel no tiene hojas.");
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    // row.values es base 1
    matrix.push(values.slice(1).map(cellToString));
  });
  const [headers = [], ...rows] = matrix;
  return cleanRows(headers, rows);
}

/** Detecta el formato por extensión/tipo y devuelve las filas. */
export async function parseImportFile(file: File): Promise<ParsedFile> {
  if (file.size === 0) throw new Error("El archivo está vacío.");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("El archivo supera 5 MB.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    return parseCsv(await file.text());
  }
  if (name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return parseXlsx(await file.arrayBuffer());
  }
  throw new Error("Formato no admitido. Usa CSV o Excel (.xlsx).");
}

/** Número decimal tolerante a coma decimal. */
export function parseDecimal(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

/** Verdadero/falso en español o inglés. */
export function parseBool(value: string | undefined): boolean | null {
  if (value == null || value.trim() === "") return null;
  const v = normalizeHeader(value);
  if (["si", "s", "true", "1", "verdadero", "x", "yes", "y"].includes(v)) return true;
  if (["no", "n", "false", "0", "falso"].includes(v)) return false;
  return null;
}
