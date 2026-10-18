import { describe, expect, it } from "vitest";
import { MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, MIXED_ENCODING_MESSAGE, decodeCsvBytes, parseCsv, parseImportFile } from "@/lib/import/parse";

/** Bytes en Windows-1252 (lo que guarda Excel con «CSV (delimitado por comas)»). */
function windows1252(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    if (code > 0xff) throw new Error(`Carácter fuera de Windows-1252: ${ch}`);
    return code;
  });
}

const CSV = "nombre_oficial,municipio\r\nCLÍNICA RURAL ÑUÑO,Bahía de Banderas\r\n";

describe("codificación de CSV", () => {
  it("lee un CSV en Windows-1252 sin dañar los acentos", () => {
    const bytes = windows1252(CSV);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toThrow();
    const parsed = parseCsv(decodeCsvBytes(bytes));
    expect(parsed.rows).toEqual([{ nombre_oficial: "CLÍNICA RURAL ÑUÑO", municipio: "Bahía de Banderas" }]);
  });

  it("UTF-8 (con o sin BOM) se lee tal cual", () => {
    const utf8 = new TextEncoder().encode(CSV);
    expect(decodeCsvBytes(utf8)).toBe(CSV);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
    expect(parseCsv(decodeCsvBytes(withBom)).rows[0]).toEqual({ nombre_oficial: "CLÍNICA RURAL ÑUÑO", municipio: "Bahía de Banderas" });
  });

  it("parseImportFile decodifica el archivo subido (instalaciones y trabajadores)", async () => {
    const file = new File([windows1252(CSV)], "instalaciones.csv", { type: "text/csv" });
    const parsed = await parseImportFile(file);
    expect(parsed.headers).toEqual(["nombre_oficial", "municipio"]);
    expect(parsed.rows[0].nombre_oficial).toBe("CLÍNICA RURAL ÑUÑO");
  });

  it("rechaza texto con caracteres ya dañados («�») en lugar de importarlos", () => {
    const damaged = "nombre_oficial,municipio\nCL�NICA RURAL,Tepic\n";
    expect(() => parseCsv(damaged)).toThrow(/La fila 2 tiene caracteres dañados/);
  });

  it("rechaza un archivo UTF-8 con algún byte de otra codificación en lugar de dañar todos los acentos", () => {
    const utf8 = new TextEncoder().encode(CSV);
    const mixed = new Uint8Array([...utf8, ...windows1252("Clínica Café,Xalisco\r\n")]);
    expect(() => decodeCsvBytes(mixed)).toThrow(MIXED_ENCODING_MESSAGE);
    // Un Windows-1252 completo con acentos y signos habituales sigue leyéndose.
    expect(decodeCsvBytes(windows1252("Ñuño «Ánimas» · Tepic, Bahía\r\n"))).toBe("Ñuño «Ánimas» · Tepic, Bahía\r\n");
  });
});

describe("límites del archivo", () => {
  it("rechaza más filas o columnas que el límite sin procesar todo el archivo", () => {
    const many = "nombre_oficial,municipio\n" + "A,Tepic\n".repeat(MAX_IMPORT_ROWS + 50);
    expect(() => parseCsv(many)).toThrow(/más de 5000 filas/);
    expect(parseCsv("nombre_oficial,municipio\n" + "A,Tepic\n".repeat(MAX_IMPORT_ROWS)).rows).toHaveLength(MAX_IMPORT_ROWS); // justo en el límite
    const wide = "nombre_oficial\n" + Array(MAX_IMPORT_COLUMNS + 1).fill("x").join(",") + "\n";
    expect(() => parseCsv(wide)).toThrow(/columnas/);
  });

  it("un Excel dañado se rechaza con un mensaje propio, sin el error interno de la biblioteca", async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5])], "dañado.xlsx");
    await expect(parseImportFile(file)).rejects.toThrow("El archivo de Excel no es válido o está dañado.");
  });
});
