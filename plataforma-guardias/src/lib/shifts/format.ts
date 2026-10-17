/**
 * Formatos de presentación de guardias (puros).
 */
import { formatDuration, formatTime } from "@/lib/time";
import { daysBetween, localDay } from "./dates";

const TIMEZONE_LABELS: Record<string, string> = {
  "America/Mazatlan": "Tiempo del Pacífico (Mazatlán)",
  "America/Bahia_Banderas": "Tiempo del Centro (Bahía de Banderas)",
  "America/Mexico_City": "Tiempo del Centro (Ciudad de México)",
  "America/Monterrey": "Tiempo del Centro (Monterrey)",
  "America/Merida": "Tiempo del Centro (Mérida)",
  "America/Matamoros": "Tiempo del Centro (Matamoros)",
  "America/Chihuahua": "Tiempo del Centro (Chihuahua)",
  "America/Cancun": "Tiempo del Sureste (Cancún)",
  "America/Hermosillo": "Tiempo del Pacífico sin horario de verano (Hermosillo)",
  "America/Tijuana": "Tiempo del Noroeste (Tijuana)",
};

/** Nombre legible de la zona horaria; si no se conoce, el identificador IANA. */
export function timezoneLabel(tz: string | null | undefined): string {
  if (!tz) return "Zona horaria no definida";
  return TIMEZONE_LABELS[tz] ?? tz;
}

/** Título visible: título de la guardia o, si no tiene, el punto de reunión. */
export function shiftDisplayTitle(shift: { title: string | null; meeting_point: string }): string {
  const t = shift.title?.trim();
  return t ? t : shift.meeting_point;
}

/** "22:00 – 06:00 (+1 día)" en la zona de la sede. */
export function formatTimeRangeCompact(startsAt: Date | string, endsAt: Date | string, tz: string | null | undefined): string {
  const base = `${formatTime(startsAt, tz)} – ${formatTime(endsAt, tz)}`;
  const days = daysBetween(localDay(startsAt, tz), localDay(endsAt, tz));
  if (days <= 0) return base;
  return `${base} (+${days} día${days === 1 ? "" : "s"})`;
}

/** "3 asignados (mín. 3, máx. 6)" */
export function staffingSummary(coverage: { assigned: number; minStaff: number; maxStaff: number | null }): string {
  const who = `${coverage.assigned} ${coverage.assigned === 1 ? "asignado" : "asignados"}`;
  const limits = coverage.maxStaff != null ? `mín. ${coverage.minStaff}, máx. ${coverage.maxStaff}` : `mín. ${coverage.minStaff}, sin máximo`;
  return `${who} (${limits})`;
}

/** Diferencia con signo explícito: "+30 min", "−1 h", "0 min". */
export function formatSignedDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  if (minutes > 0) return `+${formatDuration(minutes)}`;
  return formatDuration(minutes);
}

/** Duración de reloj legible para avisos del formulario: "8 h", "24 h", "7 h 30 min". */
export function formatClockDuration(minutes: number): string {
  return formatDuration(minutes);
}

/** Identificador corto para referencia visual de un registro. */
export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
