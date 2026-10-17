/**
 * Registro con código QR: lógica pura compartida por servidor y navegador.
 *
 * El código lo emite y valida el servidor (issue_qr_token / qr_token_context /
 * check_in_qr / check_out_qr). El QR solo facilita abrir el registro con la
 * cuenta propia: NO prueba presencia física.
 */

/** Ruta de la página del trabajador que abre el código escaneado. */
export const QR_REGISTER_PATH = "/registro/qr";

/** Mismo formato que acepta POST /api/asistencia (base64url, 20 a 100 caracteres). */
export const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

/** Textos obligatorios del registro con QR (no modificar sin revisión). */
export const QR_NOT_PRESENCE = "El código QR no prueba presencia física.";
export const QR_EXPIRED_HINT = "Pide que muestren el código vigente y vuelve a escanearlo.";
export const QR_SCAN_PROMPT = "¿Te mostraron un código QR? Escanéalo con la cámara de tu teléfono";

/** Aviso visible en la pantalla del código, con la vigencia restante. */
export function qrScreenNotice(secondsLeft: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(secondsLeft) ? secondsLeft : 0));
  return `Este código solo facilita el registro: no prueba presencia física. Caduca en ${n} s.`;
}

export function isValidQrToken(value: unknown): value is string {
  return typeof value === "string" && QR_TOKEN_PATTERN.test(value);
}

export type QrParam = { kind: "missing" } | { kind: "invalid" } | { kind: "ok"; token: string };

/** Lee el parámetro `c` de /registro/qr (ausente, con formato inválido o válido). */
export function readQrParam(raw: string | string[] | undefined | null): QrParam {
  if (raw == null) return { kind: "missing" };
  if (Array.isArray(raw)) {
    // Varios `c` en la misma liga: no se adivina cuál es el bueno.
    if (raw.length === 0) return { kind: "missing" };
    if (raw.length > 1) return { kind: "invalid" };
    return readQrParam(raw[0]);
  }
  const value = raw.trim();
  if (!value) return { kind: "missing" };
  return isValidQrToken(value) ? { kind: "ok", token: value } : { kind: "invalid" };
}

/** URL que se codifica en el QR: `${siteUrl}/registro/qr?c=${token}`. */
export function buildQrUrl(siteUrl: string, token: string): string {
  if (!isValidQrToken(token)) throw new Error("Código QR con formato inválido");
  const base = siteUrl.trim().replace(/\/+$/, "");
  return `${base}${QR_REGISTER_PATH}?c=${encodeURIComponent(token)}`;
}

/** «14:05:30» en la zona indicada (los códigos duran segundos, no minutos). */
export function formatClockSeconds(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("es-MX", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("es-MX", options).format(date);
  }
}

/** SVG (texto) → data URI para <img>, sin insertar HTML en la página. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// -----------------------------------------------------------------------------
// Errores de la base de datos → estados de la interfaz
// -----------------------------------------------------------------------------

type DbErrorLike = { message?: string | null; code?: string | null } | null | undefined;

/** Estados de error de la pantalla que muestra el código. */
export type QrIssueErrorKind = "offline" | "window" | "cancelled" | "forbidden" | "not_found" | "unknown";

export function classifyIssueError(error: DbErrorLike): Exclude<QrIssueErrorKind, "offline"> {
  const msg = error?.message ?? "";
  const code = error?.code ?? "";
  if (/cancelada/i.test(msg)) return "cancelled";
  if (/ventana de registro/i.test(msg)) return "window";
  if (code === "42501" || /permiso/i.test(msg)) return "forbidden";
  if (code === "P0002" || /no encontrada/i.test(msg)) return "not_found";
  return "unknown";
}

/** Estados de error de la página del trabajador al abrir un código. */
export type QrContextErrorKind = "expired" | "not_assigned" | "not_linked" | "unknown";

export function classifyContextError(error: DbErrorLike): QrContextErrorKind {
  const msg = error?.message ?? "";
  if (/expir|no es v[aá]lido|caduc/i.test(msg)) return "expired";
  if (/no est[aá]s asignad/i.test(msg)) return "not_assigned";
  if (/no est[aá] vinculad/i.test(msg)) return "not_linked";
  return "unknown";
}

/** ¿El mensaje de un rechazo indica que el código caducó o no es válido? */
export function isExpiredQrMessage(message: string | null | undefined): boolean {
  return classifyContextError({ message }) === "expired";
}

// -----------------------------------------------------------------------------
// Siguiente acción sugerida en la página del trabajador
// -----------------------------------------------------------------------------

export type QrAttendanceAction = "entrada" | "salida";
export type QrServerOutcome = "created" | "duplicate" | "already_open" | "open_elsewhere" | "no_open_session";

/**
 * Qué botón mostrar después de la última respuesta CONFIRMADA del servidor.
 * - null: el registro quedó guardado (o ya existía); no se ofrece otro.
 * - already_open: ya había entrada abierta en esta guardia → ofrecer salida.
 * - no_open_session: no había entrada abierta → ofrecer entrada.
 * Sin respuesta confirmada se conserva la acción actual.
 */
export function nextQrAction(current: QrAttendanceAction, outcome: QrServerOutcome | null): QrAttendanceAction | null {
  switch (outcome) {
    case "created":
    case "duplicate":
      return null;
    case "already_open":
      return "salida";
    case "no_open_session":
      return "entrada";
    default:
      return current;
  }
}
