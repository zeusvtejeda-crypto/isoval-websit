import { format, isValid, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { categoryIconMarkup, contrastInk, resolveCategoryIcon } from "./icons";

/**
 * Fecha sin hora (columna date, "2026-10-17") → "17 de octubre de 2026".
 * No se convierte de zona horaria: una fecha sin hora no debe recorrerse de día.
 */
export function formatDateOnly(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseISO(value);
  if (!isValid(date)) return null;
  return format(date, "d 'de' MMMM 'de' yyyy", { locale: es });
}

/** Solo enlaces http(s); cualquier otro esquema (javascript:, data:…) se descarta. */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Varias URLs de fuente («url1 | url2»): devuelve solo las http(s) válidas. */
export function safeExternalUrls(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\s+\|\s+|\s*\n\s*/)
    .map((v) => safeExternalUrl(v))
    .filter((v): v is string => Boolean(v));
}

/** Enlace tel: con solo dígitos y «+»; null si no hay suficientes dígitos. */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 7 ? `tel:${digits}` : null;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export const DEFAULT_CATEGORY_COLOR = "#166534";

/** Color #RRGGBB válido o el verde por omisión (evita inyectar estilos). */
export function safeHexColor(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_CATEGORY_COLOR;
}

/**
 * Marcador del mapa (SVG en línea) con el color y el ícono de la categoría y un
 * título accesible. Todo el texto se escapa; el ícono sale de datos constantes
 * (un valor desconocido usa el ícono por omisión) y su tinta contrasta con el
 * color de fondo.
 */
export function markerSvg(color: string | null | undefined, label: string, icon?: string | null): string {
  const fill = safeHexColor(color);
  const text = escapeHtml(label);
  const name = resolveCategoryIcon(icon);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="32" height="42" role="img" aria-label="${text}" focusable="false">` +
    `<title>${text}</title>` +
    `<path d="M16 1.5C8 1.5 1.5 7.9 1.5 15.8c0 10.4 14.5 24.7 14.5 24.7s14.5-14.3 14.5-24.7C30.5 7.9 24 1.5 16 1.5z" fill="${fill}" stroke="#ffffff" stroke-width="2"/>` +
    `<g data-icon="${name}" transform="translate(8.5 8) scale(0.625)" fill="none" stroke="${contrastInk(fill)}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">` +
    categoryIconMarkup(name) +
    `</g>` +
    `</svg>`
  );
}
