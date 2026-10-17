import type { CategoryIcon } from "@/lib/validation/facility";

/*
 * Íconos de las categorías de instalaciones (facility_categories.icon).
 *
 * Dibujos propios y simples en una retícula de 24×24, solo trazos (sin relleno)
 * para que tomen el color del texto o la tinta que se indique. A propósito no
 * hay cruz médica, logotipos ni emblemas institucionales: la plataforma no es
 * oficial. El valor «cross» (antes «Cruz médica») se dibuja como un corazón con
 * pulso.
 *
 * La lista de valores es la fija de administración (CATEGORY_ICONS): el tipo
 * Record<CategoryIcon, …> obliga a dibujar cualquier valor nuevo. Este módulo no
 * importa nada en tiempo de ejecución (solo el tipo), así que puede usarse en el
 * navegador sin arrastrar la validación.
 */

export type CategoryIconName = CategoryIcon;

/** Ícono por omisión (el mismo valor por omisión de la columna en la BD). */
export const DEFAULT_CATEGORY_ICON: CategoryIconName = "building";

/** Trazos (atributo «d» de <path>) de cada ícono. Datos constantes, nunca texto del usuario. */
export const CATEGORY_ICON_PATHS: Readonly<Record<CategoryIconName, readonly string[]>> = {
  building: [
    "M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21",
    "M3 21h18",
    "M9 7h1.5M13.5 7H15M9 11h1.5M13.5 11H15M9 15h1.5M13.5 15H15",
    "M10.5 21v-2.5h3V21",
  ],
  hospital: ["M3 21h18", "M5 21V9h14v12", "M9 9V5h6v4", "M9.5 12v6M14.5 12v6M9.5 15h5"],
  stethoscope: [
    "M4 3h2M12 3h2",
    "M5 3v5a4 4 0 0 0 8 0V3",
    "M9 12v2a5 5 0 0 0 10 0v-2",
    "M17 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  ],
  // Corazón con pulso (sin cruz).
  cross: ["M12 20C5 15.5 3 12 3 9a4.5 4.5 0 0 1 9-1.5A4.5 4.5 0 0 1 21 9c0 3-2 6.5-9 11z", "M7 12.5h2.5l1.5-2.5 2 4.5 1.5-2H17"],
  // Vehículo con luz de emergencia (sin cruz).
  ambulance: [
    "M3 17V7h11v10",
    "M14 10h3.5l3.5 4v3h-2",
    "M3 17h2M9 17h6",
    "M5 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    "M15 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    "M7 7V5h3v2",
    "M6 11.5h5",
  ],
  pill: ["M8 8h8a4 4 0 0 1 0 8H8a4 4 0 0 1 0-8z", "M12 8v8"],
  flask: ["M9 3h6", "M10 3v6.5L4.6 18.4A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.6L14 9.5V3", "M7.2 15h9.6"],
  baby: [
    "M4 13a8 8 0 1 0 16 0a8 8 0 1 0-16 0",
    "M9 12h.01M15 12h.01",
    "M9.5 16a3 3 0 0 0 5 0",
    "M12 5c0-1.5 1-2.5 2.5-2.5",
  ],
  landmark: ["M3 9.5L12 4l9 5.5z", "M6 12v6M10 12v6M14 12v6M18 12v6", "M4 18.5h16M3 21h18"],
  briefcase: [
    "M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
    "M9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2",
    "M3 13h18",
  ],
  users: [
    "M5.5 8a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0",
    "M2.5 20v-1.5A4.5 4.5 0 0 1 7 14h4a4.5 4.5 0 0 1 4.5 4.5V20",
    "M15.5 4.7a3.5 3.5 0 0 1 0 6.6",
    "M18 14.2a4.5 4.5 0 0 1 3.5 4.3V20",
  ],
  school: ["M2 9.5L12 5l10 4.5L12 14z", "M6 11.5V16c3.5 2.5 8.5 2.5 12 0v-4.5", "M22 9.5V15"],
  warehouse: ["M2 21h20", "M3 21V9l9-5 9 5v12", "M7 21v-9h10v9", "M7 15h10M7 18h10"],
  "map-pin": ["M12 21.5S5 15.3 5 9.5a7 7 0 0 1 14 0c0 5.8-7 12-7 12z", "M10 9.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0"],
};

/** Valores con ícono propio. */
export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICON_PATHS) as CategoryIconName[];

export function isCategoryIconName(value: unknown): value is CategoryIconName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CATEGORY_ICON_PATHS, value);
}

/** Ícono conocido o el de por omisión (valor vacío, desconocido o de otra versión). */
export function resolveCategoryIcon(value: string | null | undefined): CategoryIconName {
  const v = value?.trim();
  return isCategoryIconName(v) ? v : DEFAULT_CATEGORY_ICON;
}

export function categoryIconPaths(value: string | null | undefined): readonly string[] {
  return CATEGORY_ICON_PATHS[resolveCategoryIcon(value)];
}

/**
 * Trazos del ícono como elementos <path> en texto, para el SVG en línea del
 * marcador del mapa (L.divIcon). Solo usa datos constantes de este módulo.
 */
export function categoryIconMarkup(value: string | null | undefined): string {
  return categoryIconPaths(value)
    .map((d) => `<path d="${d}"/>`)
    .join("");
}

export const INK_LIGHT = "#ffffff";
export const INK_DARK = "#111827";

function channel(hex: string): number {
  const c = parseInt(hex, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa (WCAG) de un color #RRGGBB; null si no es válido. */
export function relativeLuminance(color: string): number | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  return 0.2126 * channel(color.slice(1, 3)) + 0.7152 * channel(color.slice(3, 5)) + 0.0722 * channel(color.slice(5, 7));
}

/**
 * Tinta del ícono sobre el color de la categoría: blanco sobre colores oscuros
 * (la paleta del proyecto) y casi negro si administración elige un color claro.
 */
export function contrastInk(background: string): typeof INK_LIGHT | typeof INK_DARK {
  const l = relativeLuminance(background);
  if (l == null) return INK_LIGHT;
  const darkL = relativeLuminance(INK_DARK)!;
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (darkL + 0.05);
  return onWhite >= onDark ? INK_LIGHT : INK_DARK;
}
