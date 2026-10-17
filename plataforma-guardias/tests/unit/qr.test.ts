import { describe, expect, it } from "vitest";
import {
  QR_TOKEN_PATTERN,
  buildQrUrl,
  classifyContextError,
  classifyIssueError,
  formatClockSeconds,
  isExpiredQrMessage,
  isValidQrToken,
  nextQrAction,
  qrScreenNotice,
  readQrParam,
  svgDataUri,
} from "@/lib/qr/core";
import {
  MIN_RENEW_DELAY_MS,
  isDueForRenewal,
  localExpiry,
  msUntilRenewal,
  renewAt,
  renewMarginSeconds,
  retryDelayMs,
  secondsLeft,
  validityMs,
} from "@/lib/qr/timing";
import { parseIssuedToken, parseQrContext } from "@/lib/qr/rpc";

// Forma de los códigos que emite issue_qr_token: 24 bytes en base64url (32 caracteres).
const TOKEN = "Ab3_dE-fGh1JkLmNoPqRsTuVwXyZ0123";

describe("formato del código", () => {
  it("acepta base64url de 20 a 100 caracteres (igual que /api/asistencia)", () => {
    expect(isValidQrToken(TOKEN)).toBe(true);
    expect(isValidQrToken("a".repeat(20))).toBe(true);
    expect(isValidQrToken("a".repeat(100))).toBe(true);
    expect(QR_TOKEN_PATTERN.source).toBe("^[A-Za-z0-9_-]{20,100}$");
  });

  it("rechaza códigos cortos, largos, con caracteres no permitidos o que no son texto", () => {
    expect(isValidQrToken("a".repeat(19))).toBe(false);
    expect(isValidQrToken("a".repeat(101))).toBe(false);
    expect(isValidQrToken(`${TOKEN.slice(0, 31)}=`)).toBe(false);
    expect(isValidQrToken(`${TOKEN.slice(0, 31)}+`)).toBe(false);
    expect(isValidQrToken(`${TOKEN.slice(0, 20)} ${TOKEN.slice(21)}`)).toBe(false);
    expect(isValidQrToken("<script>alert(1)</script>xxxxxxx")).toBe(false);
    expect(isValidQrToken(undefined)).toBe(false);
    expect(isValidQrToken(123)).toBe(false);
  });

  it("lee el parámetro c: ausente, inválido o válido", () => {
    expect(readQrParam(undefined)).toEqual({ kind: "missing" });
    expect(readQrParam(null)).toEqual({ kind: "missing" });
    expect(readQrParam("")).toEqual({ kind: "missing" });
    expect(readQrParam("   ")).toEqual({ kind: "missing" });
    expect(readQrParam([])).toEqual({ kind: "missing" });
    expect(readQrParam("abc")).toEqual({ kind: "invalid" });
    expect(readQrParam("%%%%%%%%%%%%%%%%%%%%%%")).toEqual({ kind: "invalid" });
    expect(readQrParam([TOKEN, TOKEN])).toEqual({ kind: "invalid" });
    expect(readQrParam(TOKEN)).toEqual({ kind: "ok", token: TOKEN });
    expect(readQrParam(` ${TOKEN}\n`)).toEqual({ kind: "ok", token: TOKEN });
    expect(readQrParam([TOKEN])).toEqual({ kind: "ok", token: TOKEN });
  });
});

describe("URL del código", () => {
  it("construye `${siteUrl}/registro/qr?c=TOKEN`", () => {
    expect(buildQrUrl("https://guardias.example.mx", TOKEN)).toBe(`https://guardias.example.mx/registro/qr?c=${TOKEN}`);
  });

  it("quita diagonales finales del sitio y conserva subrutas", () => {
    expect(buildQrUrl("https://guardias.example.mx/", TOKEN)).toBe(`https://guardias.example.mx/registro/qr?c=${TOKEN}`);
    expect(buildQrUrl(" http://localhost:3000// ", TOKEN)).toBe(`http://localhost:3000/registro/qr?c=${TOKEN}`);
    expect(buildQrUrl("https://example.mx/app", TOKEN)).toBe(`https://example.mx/app/registro/qr?c=${TOKEN}`);
  });

  it("la URL resultante devuelve el mismo código al leerla", () => {
    const url = new URL(buildQrUrl("https://guardias.example.mx", TOKEN));
    expect(url.pathname).toBe("/registro/qr");
    expect(readQrParam(url.searchParams.get("c"))).toEqual({ kind: "ok", token: TOKEN });
  });

  it("no construye URLs con códigos de formato inválido", () => {
    expect(() => buildQrUrl("https://x.mx", "corto")).toThrow(/formato inválido/);
    expect(() => buildQrUrl("https://x.mx", `${TOKEN}&next=//evil.example`)).toThrow();
  });

  it("convierte el SVG en data URI codificado (sin HTML crudo)", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0h1v1H0z"/></svg>';
    const uri = svgDataUri(svg);
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(uri).not.toContain("<");
    expect(uri).not.toContain('"');
    expect(decodeURIComponent(uri.slice("data:image/svg+xml;utf8,".length))).toBe(svg);
  });
});

describe("vigencia y renovación", () => {
  const issued = { expiresAt: "2026-10-17T20:02:00.000Z", serverTime: "2026-10-17T20:00:00.000Z", ttlSeconds: 120 };

  it("calcula la vigencia con las horas del servidor, sin depender del reloj del dispositivo", () => {
    expect(validityMs(issued)).toBe(120_000);
    // El dispositivo está 1 h adelantado: la cuenta regresiva sigue siendo de 120 s.
    const sentAt = Date.parse("2026-10-17T21:00:00.000Z");
    expect(localExpiry(issued, sentAt)).toBe(sentAt + 120_000);
  });

  it("si las fechas no sirven usa el TTL", () => {
    expect(validityMs({ expiresAt: "no-es-fecha", serverTime: issued.serverTime, ttlSeconds: 90 })).toBe(90_000);
    expect(validityMs({ expiresAt: issued.serverTime, serverTime: issued.serverTime, ttlSeconds: 60 })).toBe(60_000);
  });

  it("renueva 30 s antes de caducar (TTL 120 → a los 90 s); con TTL corto, a la mitad", () => {
    expect(renewMarginSeconds(120)).toBe(30);
    expect(renewMarginSeconds(600)).toBe(30);
    expect(renewMarginSeconds(60)).toBe(30);
    expect(renewMarginSeconds(30)).toBe(15);
    expect(renewMarginSeconds(4)).toBe(5);
    expect(renewMarginSeconds(Number.NaN)).toBe(5);
    const t0 = 1_000_000;
    const expires = localExpiry(issued, t0);
    expect(renewAt(expires, 120)).toBe(t0 + 90_000);
    expect(msUntilRenewal(expires, 120, t0)).toBe(90_000);
    expect(msUntilRenewal(expires, 120, t0 + 60_000)).toBe(30_000);
  });

  it("nunca programa una renovación inmediata en ciclo", () => {
    const t0 = 1_000_000;
    const expires = t0 + 120_000;
    expect(msUntilRenewal(expires, 120, t0 + 95_000)).toBe(MIN_RENEW_DELAY_MS);
    expect(msUntilRenewal(expires, 120, t0 + 500_000)).toBe(MIN_RENEW_DELAY_MS);
  });

  it("indica cuándo ya toca renovar (al volver a la pestaña)", () => {
    const t0 = 1_000_000;
    const expires = t0 + 120_000;
    expect(isDueForRenewal(expires, 120, t0 + 89_999)).toBe(false);
    expect(isDueForRenewal(expires, 120, t0 + 90_000)).toBe(true);
    expect(isDueForRenewal(expires, 120, t0 + 200_000)).toBe(true);
  });

  it("cuenta los segundos restantes redondeando hacia arriba y sin negativos", () => {
    const expires = 10_000;
    expect(secondsLeft(expires, 0)).toBe(10);
    expect(secondsLeft(expires, 100)).toBe(10);
    expect(secondsLeft(expires, 9_001)).toBe(1);
    expect(secondsLeft(expires, 10_000)).toBe(0);
    expect(secondsLeft(expires, 50_000)).toBe(0);
  });

  it("reintenta solo los errores transitorios o de ventana", () => {
    expect(retryDelayMs("offline")).toBe(10_000);
    expect(retryDelayMs("unknown")).toBe(15_000);
    expect(retryDelayMs("window")).toBe(60_000);
    expect(retryDelayMs("cancelled")).toBeNull();
    expect(retryDelayMs("forbidden")).toBeNull();
    expect(retryDelayMs("not_found")).toBeNull();
  });
});

describe("textos y errores", () => {
  it("el aviso de la pantalla dice que no prueba presencia física y cuánto falta", () => {
    expect(qrScreenNotice(87)).toBe("Este código solo facilita el registro: no prueba presencia física. Caduca en 87 s.");
    expect(qrScreenNotice(-3)).toBe("Este código solo facilita el registro: no prueba presencia física. Caduca en 0 s.");
    expect(qrScreenNotice(Number.NaN)).toContain("Caduca en 0 s.");
  });

  it("clasifica los errores de issue_qr_token", () => {
    expect(classifyIssueError({ message: "La guardia está cancelada", code: "22023" })).toBe("cancelled");
    expect(classifyIssueError({ message: "El código solo está disponible durante la ventana de registro de la guardia", code: "22023" })).toBe("window");
    expect(classifyIssueError({ message: "No tienes permiso para mostrar el código de esta guardia", code: "42501" })).toBe("forbidden");
    expect(classifyIssueError({ message: "Guardia no encontrada", code: "P0002" })).toBe("not_found");
    expect(classifyIssueError({ message: "fetch failed" })).toBe("unknown");
    expect(classifyIssueError(null)).toBe("unknown");
  });

  it("clasifica los errores de qr_token_context y de los registros con código", () => {
    expect(classifyContextError({ message: "El código QR expiró o no es válido. Escanea el código que se muestra ahora." })).toBe("expired");
    expect(classifyContextError({ message: "No estás asignado a la guardia de este código" })).toBe("not_assigned");
    expect(classifyContextError({ message: "Tu cuenta no está vinculada a un registro de trabajador" })).toBe("not_linked");
    expect(classifyContextError({ message: "Algo más" })).toBe("unknown");
    expect(isExpiredQrMessage("El código QR expiró o no es válido. Escanea el código que se muestra ahora.")).toBe(true);
    expect(isExpiredQrMessage("La guardia ya terminó. Solicita una corrección a coordinación.")).toBe(false);
    expect(isExpiredQrMessage(null)).toBe(false);
  });

  it("muestra la hora de caducidad con segundos en la zona de la sede", () => {
    expect(formatClockSeconds("2026-10-17T20:02:05Z", "America/Mazatlan")).toBe("13:02:05");
    expect(formatClockSeconds(new Date("2026-10-17T20:02:05Z"), "America/Mexico_City")).toBe("14:02:05");
    expect(formatClockSeconds("2026-10-17T20:02:05Z", "Zona/Inexistente")).toMatch(/^\d{2}:02:05$/);
  });
});

describe("siguiente acción del trabajador", () => {
  it("después de un registro guardado (o ya existente) no ofrece otro", () => {
    expect(nextQrAction("entrada", "created")).toBeNull();
    expect(nextQrAction("salida", "duplicate")).toBeNull();
  });

  it("si ya había entrada abierta ofrece salida; si no había, ofrece entrada", () => {
    expect(nextQrAction("entrada", "already_open")).toBe("salida");
    expect(nextQrAction("salida", "no_open_session")).toBe("entrada");
  });

  it("sin respuesta confirmada o con entrada en otra guardia conserva la acción", () => {
    expect(nextQrAction("entrada", null)).toBe("entrada");
    expect(nextQrAction("salida", null)).toBe("salida");
    expect(nextQrAction("entrada", "open_elsewhere")).toBe("entrada");
  });
});

describe("respuestas de las funciones RPC", () => {
  it("valida la respuesta de issue_qr_token", () => {
    expect(
      parseIssuedToken({ token: TOKEN, expires_at: "2026-10-17T20:02:00+00:00", ttl_seconds: 120, server_time: "2026-10-17T20:00:00+00:00" }),
    ).toEqual({ token: TOKEN, expiresAt: "2026-10-17T20:02:00+00:00", ttlSeconds: 120, serverTime: "2026-10-17T20:00:00+00:00" });
    expect(parseIssuedToken({ token: "x", expires_at: "2026-10-17T20:02:00Z", ttl_seconds: 120, server_time: "2026-10-17T20:00:00Z" })).toBeNull();
    expect(parseIssuedToken({ token: TOKEN, expires_at: "mañana", ttl_seconds: 120, server_time: "2026-10-17T20:00:00Z" })).toBeNull();
    expect(parseIssuedToken(null)).toBeNull();
  });

  it("valida la respuesta de qr_token_context", () => {
    const ctx = parseQrContext({
      assignment_id: "aebc1457-14ac-4f67-b21b-3e55242677db",
      shift_id: "d2000000-0000-4000-8000-000000000001",
      shift_title: "  ",
      meeting_point: "Acceso principal",
      starts_at: "2026-10-17T17:42:00+00:00",
      ends_at: "2026-10-17T23:42:00+00:00",
      facility_name: "[DEMO] Hospital de demostración A",
      facility_timezone: "America/Mazatlan",
      has_open_session: true,
      expires_at: "2026-10-17T20:02:00+00:00",
      server_time: "2026-10-17T20:00:00+00:00",
    });
    expect(ctx).toMatchObject({
      assignmentId: "aebc1457-14ac-4f67-b21b-3e55242677db",
      shiftTitle: null,
      meetingPoint: "Acceso principal",
      facilityTimezone: "America/Mazatlan",
      hasOpenSession: true,
    });
    expect(parseQrContext({ assignment_id: "x" })).toBeNull();
  });
});
