import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseXlsx, zipDeclaredUncompressedSize, MAX_XLSX_UNCOMPRESSED_BYTES } from "@/lib/import/parse";

async function xlsxBuffer(rows: string[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Hoja1");
  rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return buf instanceof ArrayBuffer ? buf : new Uint8Array(buf as ArrayLike<number>).buffer;
}

describe("lectura segura de XLSX", () => {
  it("lee un archivo válido y normaliza encabezados", async () => {
    const parsed = await parseXlsx(await xlsxBuffer([["Nombre Oficial", "Clave Unidad"], ["Unidad A", "X1"]]));
    expect(parsed.headers).toEqual(["nombre_oficial", "clave_unidad"]);
    expect(parsed.rows).toEqual([{ nombre_oficial: "Unidad A", clave_unidad: "X1" }]);
  });

  it("calcula el tamaño descomprimido declarado sin descomprimir", async () => {
    const info = zipDeclaredUncompressedSize(await xlsxBuffer([["a"], ["b"]]));
    expect(info).not.toBeNull();
    expect(info!.bytes).toBeGreaterThan(0);
    expect(info!.bytes).toBeLessThan(MAX_XLSX_UNCOMPRESSED_BYTES);
  });

  it("rechaza archivos que no son ZIP", async () => {
    await expect(parseXlsx(new TextEncoder().encode("no es un zip").buffer)).rejects.toThrow(/no es válido/);
  });

  it("rechaza archivos cuyo tamaño descomprimido declarado excede el límite", async () => {
    const buf = await xlsxBuffer([["a"], ["b"]]);
    const bytes = new Uint8Array(buf.slice(0));
    const view = new DataView(bytes.buffer);
    // Altera el tamaño descomprimido declarado de la primera entrada del directorio central.
    for (let i = 0; i < bytes.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, MAX_XLSX_UNCOMPRESSED_BYTES + 1, true);
        break;
      }
    }
    await expect(parseXlsx(bytes.buffer)).rejects.toThrow(/demasiado grande/);
  });
});
