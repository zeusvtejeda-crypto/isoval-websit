// @vitest-environment node
/**
 * Pruebas del manifiesto de la PWA (src/app/manifest.ts) y de los íconos
 * generados por scripts/generar-iconos.mjs.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const ROOT = resolve(__dirname, "../..");
const m = manifest();
const icons = m.icons ?? [];

type PngInfo = { width: number; height: number; colorType: number; hasAlpha: boolean };

/** Lee el encabezado IHDR de un PNG (ancho, alto y tipo de color). */
function readPng(relativePath: string): PngInfo {
  const buffer = readFileSync(resolve(ROOT, relativePath));
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect([...buffer.subarray(0, 8)], `${relativePath} no es PNG`).toEqual(signature);
  expect(buffer.toString("ascii", 12, 16)).toBe("IHDR");
  const colorType = buffer[25];
  // Recorre los bloques (longitud, tipo, datos, CRC) para detectar tRNS.
  const chunkTypes: string[] = [];
  for (let offset = 8; offset + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    chunkTypes.push(buffer.toString("ascii", offset + 4, offset + 8));
    offset += 12 + length;
  }
  expect(chunkTypes.at(-1)).toBe("IEND");
  const hasTransparencyChunk = chunkTypes.includes("tRNS");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType,
    // 4 = gris + alfa, 6 = RGBA; tRNS agrega transparencia a los demás tipos.
    hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk,
  };
}

function publicPath(src: string) {
  return `public${src}`;
}

describe("manifiesto de la PWA", () => {
  it("tiene los campos requeridos para instalarse", () => {
    expect(m).toMatchObject({
      name: "Guardias y Directorio de Instalaciones",
      short_name: "Guardias",
      lang: "es-MX",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#14532d",
    });
    expect(m.short_name!.length).toBeLessThanOrEqual(12);
  });

  it("aclara que no es una aplicación oficial del IMSS y no lo sugiere en el nombre", () => {
    expect(m.description).toMatch(/no es una aplicación oficial del IMSS/i);
    expect(m.name).not.toMatch(/IMSS/i);
    expect(m.short_name).not.toMatch(/IMSS/i);
  });

  it("el color del tema coincide con el viewport del layout raíz", () => {
    const layout = readFileSync(resolve(ROOT, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain(`themeColor: "${m.theme_color}"`);
  });

  it("incluye íconos PNG 192 y 512 (any) y 512 (maskable)", () => {
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "maskable" }),
      ]),
    );
  });

  it.each(icons.map((icon) => [icon.src, icon] as const))("el ícono %s existe y mide lo que declara", (src, icon) => {
    expect(src.startsWith("/icons/")).toBe(true);
    expect(existsSync(resolve(ROOT, publicPath(src)))).toBe(true);
    const png = readPng(publicPath(src));
    expect(`${png.width}x${png.height}`).toBe(icon.sizes);
    // Un ícono maskable debe ser opaco: el sistema recorta la forma.
    if (icon.purpose === "maskable") expect(png.hasAlpha).toBe(false);
  });

  it("tiene accesos directos a /registro y /directorio dentro del alcance", () => {
    const shortcuts = m.shortcuts ?? [];
    expect(shortcuts.map((s) => s.url)).toEqual(expect.arrayContaining(["/registro", "/directorio"]));
    for (const shortcut of shortcuts) {
      expect(shortcut.name.length).toBeGreaterThan(0);
      expect(shortcut.url.startsWith(m.scope!)).toBe(true);
      for (const icon of shortcut.icons ?? []) {
        expect(existsSync(resolve(ROOT, publicPath(icon.src)))).toBe(true);
      }
    }
  });

  it("start_url está dentro de scope", () => {
    expect(m.start_url!.startsWith(m.scope!)).toBe(true);
  });
});

describe("íconos del sitio (src/app)", () => {
  it("icon.png mide 512×512", () => {
    const png = readPng("src/app/icon.png");
    expect([png.width, png.height]).toEqual([512, 512]);
  });

  it("apple-icon.png mide 180×180 y es opaco (iOS rellena la transparencia con negro)", () => {
    const png = readPng("src/app/apple-icon.png");
    expect([png.width, png.height]).toEqual([180, 180]);
    expect(png.hasAlpha).toBe(false);
  });
});
