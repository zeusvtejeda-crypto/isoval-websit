import Papa from "papaparse";
import ExcelJS from "exceljs";
import JSZip from "jszip";

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

/**
 * Texto de un CSV a partir de sus bytes: UTF-8 (con o sin BOM) y, si no es UTF-8
 * válido, Windows-1252, que es lo que guarda Excel en Windows con «CSV
 * (delimitado por comas)». Así los acentos no se convierten en «�».
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const text = new TextDecoder("windows-1252").decode(bytes);
    // Un archivo casi todo en UTF-8 con algún byte de otra codificación se
    // leería entero como Windows-1252 y los acentos quedarían como «Ã­» o «Ã±».
    if (MIXED_ENCODING.test(text)) throw new Error(MIXED_ENCODING_MESSAGE);
    return text;
  }
}

/** Secuencias típicas de UTF-8 leído como Windows-1252 (p. ej. «Ã­», «Ã±», «Ã“»). */
const MIXED_ENCODING = /[ÂÃ][\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013-\u2026\u2030\u2039\u203A\u20AC\u2122]/;
export const MIXED_ENCODING_MESSAGE =
  "El archivo mezcla codificaciones (UTF-8 y otra): guárdalo completo como «CSV UTF-8» o .xlsx para no dañar los acentos.";

export function parseCsv(text: string): ParsedFile {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  if (result.errors.length && result.data.length === 0) {
    throw new Error("No se pudo leer el CSV: " + result.errors[0].message);
  }
  // «�» (U+FFFD) en un UTF-8 válido indica que el texto ya se dañó antes (al
  // copiarlo de otra codificación): se rechaza en lugar de importar nombres dañados.
  const damaged = result.data.findIndex((r) => r.some((c) => (c ?? "").includes("\ufffd")));
  if (damaged >= 0) {
    throw new Error(`La fila ${damaged + 1} tiene caracteres dañados («\ufffd»): corrígelos en el archivo original y vuelve a guardarlo como «CSV UTF-8» o .xlsx.`);
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

/** Máximo descomprimido de un .xlsx (defensa contra bombas zip). */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

/**
 * Suma los tamaños descomprimidos declarados en el directorio central del ZIP
 * sin descomprimir nada. Devuelve null si el archivo no es un ZIP válido o usa
 * ZIP64 (tamaños de 4 GB o más), que se rechaza.
 */
export function zipDeclaredUncompressedSize(buffer: ArrayBuffer): { bytes: number; entries: number } | null {
  const view = new DataView(buffer);
  const len = buffer.byteLength;
  // Fin del directorio central: firma 0x06054b50 en los últimos 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdOffset === 0xffffffff || cdOffset >= len) return null;
  let ptr = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (ptr + 46 > len || view.getUint32(ptr, true) !== 0x02014b50) return null;
    const uncompressed = view.getUint32(ptr + 24, true);
    if (uncompressed === 0xffffffff) return null;
    total += uncompressed;
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return { bytes: total, entries };
}

const TOO_BIG = "El archivo de Excel es demasiado grande una vez descomprimido. Divídelo en partes o usa CSV.";

/**
 * Descomprime por flujo cada entrada contando los bytes reales y se detiene al
 * pasar el límite. No confía en los tamaños declarados (un archivo malicioso
 * puede declarar 16 KB e inflar gigabytes): la memoria queda acotada.
 */
export async function assertInflatedSizeWithin(buffer: ArrayBuffer, limit = MAX_XLSX_UNCOMPRESSED_BYTES): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("El archivo de Excel no es válido o está dañado.");
  }
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    await new Promise<void>((resolve, reject) => {
      const stream = entry.nodeStream("nodebuffer");
      let done = false;
      stream
        .on("data", (chunk: Buffer) => {
          if (done) return;
          total += chunk.length;
          if (total > limit) {
            done = true;
            stream.pause();
            reject(new Error(TOO_BIG));
          }
        })
        .on("error", (err: Error) => {
          if (done) return;
          done = true;
          reject(/mismatch|corrupted|invalid/i.test(err.message) ? new Error("El archivo de Excel no es válido o está dañado.") : err);
        })
        .on("end", () => {
          if (done) return;
          done = true;
          resolve();
        })
        .resume();
    });
  }
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
  const declared = zipDeclaredUncompressedSize(buffer);
  if (!declared) throw new Error("El archivo de Excel no es válido o está dañado.");
  if (declared.entries > MAX_ZIP_ENTRIES || declared.bytes > MAX_XLSX_UNCOMPRESSED_BYTES) {
    throw new Error(TOO_BIG);
  }
  await assertInflatedSizeWithin(buffer);
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
    return parseCsv(decodeCsvBytes(await file.arrayBuffer()));
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
