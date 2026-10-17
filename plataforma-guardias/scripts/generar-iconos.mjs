#!/usr/bin/env node
/**
 * Genera los íconos de la PWA a partir de un SVG propio.
 *
 * Diseño: cuadro verde oscuro (#14532d) con un calendario blanco y una palomita.
 * Es un símbolo genérico de «guardia registrada»: sin cruz médica, sin águila ni
 * ningún elemento que imite la identidad del IMSS (la plataforma no es oficial).
 *
 * Uso (desde plataforma-guardias/):  node scripts/generar-iconos.mjs
 *
 * Salidas:
 *   public/icons/icon-192.png      192×192  purpose "any" (esquinas redondeadas, fondo transparente)
 *   public/icons/icon-512.png      512×512  purpose "any"
 *   public/icons/maskable-512.png  512×512  purpose "maskable" (fondo a sangre, símbolo dentro de la zona segura)
 *   src/app/icon.png               512×512  ícono del sitio (Next.js agrega <link rel="icon">)
 *   src/app/apple-icon.png         180×180  ícono de Apple (opaco: iOS aplica su propia máscara)
 *
 * sharp viene incluido con Next.js; no hay que instalar nada adicional.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Verde oscuro de la marca (brand-900); coincide con theme_color del manifiesto. */
const BRAND = "#14532d";
const WHITE = "#ffffff";

/**
 * Símbolo en un lienzo de 512×512 centrado en (256, 256): calendario con dos
 * argollas, encabezado sólido y una palomita. Caja total aprox. 122–390 × 98–396.
 */
const GLYPH = `
  <g fill="none" stroke="${WHITE}" stroke-linecap="round" stroke-linejoin="round">
    <rect x="136" y="152" width="240" height="230" rx="30" stroke-width="28"/>
    <path d="M136 196 h240" stroke-width="28"/>
    <path d="M200 112 v68 M312 112 v68" stroke-width="28"/>
    <path d="M198 294 l40 40 l78 -84" stroke-width="32"/>
  </g>
  <rect x="150" y="166" width="212" height="34" fill="${WHITE}"/>
`;

/**
 * @param {object} options
 * @param {number} options.size        tamaño final en píxeles
 * @param {"any" | "maskable" | "apple"} options.variant
 */
function buildSvg({ size, variant }) {
  // "any": cuadro redondeado con transparencia alrededor.
  // "maskable" y "apple": fondo a sangre (el sistema recorta la forma).
  const background =
    variant === "any"
      ? `<rect width="512" height="512" rx="112" fill="${BRAND}"/>`
      : `<rect width="512" height="512" fill="${BRAND}"/>`;

  // Zona segura de un ícono maskable: círculo de radio 0.4 × lado. Se reduce el
  // símbolo para que quede holgado dentro de ella.
  const scale = variant === "maskable" ? 0.8 : variant === "apple" ? 0.92 : 1;
  const transform = scale === 1 ? "" : ` transform="translate(256 256) scale(${scale}) translate(-256 -256)"`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  ${background}
  <g${transform}>${GLYPH}</g>
</svg>`;
}

const TARGETS = [
  { file: "public/icons/icon-192.png", size: 192, variant: "any" },
  { file: "public/icons/icon-512.png", size: 512, variant: "any" },
  { file: "public/icons/maskable-512.png", size: 512, variant: "maskable" },
  { file: "src/app/icon.png", size: 512, variant: "any" },
  { file: "src/app/apple-icon.png", size: 180, variant: "apple" },
];

async function generate({ file, size, variant }) {
  const out = path.join(ROOT, file);
  await mkdir(path.dirname(out), { recursive: true });

  let image = sharp(Buffer.from(buildSvg({ size, variant }))).resize(size, size);
  // Los íconos a sangre deben ser opacos (sin canal alfa).
  if (variant !== "any") image = image.flatten({ background: BRAND });

  const info = await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(out);
  if (info.width !== size || info.height !== size) {
    throw new Error(`${file}: se esperaba ${size}×${size} y se obtuvo ${info.width}×${info.height}`);
  }
  console.log(`✔ ${file} (${size}×${size}, ${variant}, ${info.size} bytes)`);
}

try {
  for (const target of TARGETS) await generate(target);
} catch (error) {
  console.error("No se pudieron generar los íconos:", error);
  process.exitCode = 1;
}
