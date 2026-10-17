import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QrDisplay } from "@/components/qr/qr-display";
import { QrAttendance } from "@/components/qr/qr-attendance";
import type { QrIssueResult } from "@/lib/qr/rpc";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
}));

const SHIFT = "d2000000-0000-4000-8000-000000000001";
const ASSIGNMENT = "aebc1457-14ac-4f67-b21b-3e55242677db";
const TZ = "America/Mazatlan"; // UTC−7
const TOKEN_1 = "Ab3_dE-fGh1JkLmNoPqRsTuVwXyZ0001";
const TOKEN_2 = "Ab3_dE-fGh1JkLmNoPqRsTuVwXyZ0002";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0h1v1H0z"/></svg>';

const DETAILS = {
  title: "[DEMO] Guardia matutina",
  facilityName: "[DEMO] Hospital de demostración A",
  meetingPoint: "Acceso principal",
  schedule: "sáb 17 oct 2026, 10:42 – 16:42",
  zone: "Hora del Pacífico",
};

function issued(token: string, ttlSeconds = 120): QrIssueResult {
  const now = Date.now();
  return {
    ok: true,
    token,
    url: `http://localhost:3000/registro/qr?c=${token}`,
    svg: SVG,
    serverTime: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
    ttlSeconds,
  };
}

let visibility: DocumentVisibilityState = "visible";

function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

function renderDisplay(action: (id: string) => Promise<QrIssueResult>) {
  return render(<QrDisplay shiftId={SHIFT} issueAction={action} details={DETAILS} windowText="El código se puede mostrar del 17/10/2026 08:42 al 17/10/2026 20:42 (hora de la sede)." />);
}

const qrBox = () => screen.getByTestId("qr-code");

describe("QrDisplay (pantalla del código)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pide un código al montar y lo muestra como imagen SVG con el aviso obligatorio", async () => {
    const action = vi.fn().mockResolvedValue(issued(TOKEN_1));
    renderDisplay(action);
    expect(screen.getByText("Generando código…")).toBeInTheDocument();

    const img = await screen.findByRole("img", { name: /Código QR para registrar/ });
    expect(action).toHaveBeenCalledWith(SHIFT);
    expect(img.getAttribute("src")).toBe(`data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`);
    expect(qrBox()).toHaveAttribute("data-token", TOKEN_1);
    expect(qrBox()).toHaveAttribute("data-url", `http://localhost:3000/registro/qr?c=${TOKEN_1}`);
    expect(qrBox()).toHaveAttribute("data-state", "ready");
    expect(screen.getByText(/^Este código solo facilita el registro: no prueba presencia física\. Caduca en 1[12]\d s\.$/)).toBeInTheDocument();
    expect(screen.getByText("[DEMO] Guardia matutina")).toBeInTheDocument();
    expect(screen.getByText("Acceso principal")).toBeInTheDocument();
    // El SVG nunca se inserta como HTML.
    expect(qrBox().querySelector("svg")).toBeNull();
  });

  it("renueva el código automáticamente 30 s antes de caducar", async () => {
    const action = vi.fn().mockResolvedValueOnce(issued(TOKEN_1)).mockResolvedValueOnce(issued(TOKEN_2));
    renderDisplay(action);
    await waitFor(() => expect(qrBox()).toHaveAttribute("data-token", TOKEN_1));

    await act(() => vi.advanceTimersByTimeAsync(85_000));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Caduca en (3[0-9]|40) s\./)).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(6_000));
    await waitFor(() => expect(qrBox()).toHaveAttribute("data-token", TOKEN_2));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("con la pestaña oculta no renueva; al volver a verla pide un código nuevo", async () => {
    const action = vi.fn().mockResolvedValueOnce(issued(TOKEN_1)).mockResolvedValueOnce(issued(TOKEN_2));
    renderDisplay(action);
    await waitFor(() => expect(qrBox()).toHaveAttribute("data-token", TOKEN_1));

    act(() => setVisibility("hidden"));
    await act(() => vi.advanceTimersByTimeAsync(130_000));
    expect(action).toHaveBeenCalledTimes(1);
    // Caducado: ya no se muestra como vigente.
    expect(qrBox()).toHaveAttribute("data-state", "expired");
    expect(screen.queryByRole("img", { name: /Código QR/ })).toBeNull();
    expect(screen.getByText("Código caducado")).toBeInTheDocument();

    act(() => setVisibility("visible"));
    await waitFor(() => expect(qrBox()).toHaveAttribute("data-token", TOKEN_2));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("«Renovar ahora» pide otro código", async () => {
    const action = vi.fn().mockResolvedValueOnce(issued(TOKEN_1)).mockResolvedValueOnce(issued(TOKEN_2));
    renderDisplay(action);
    await waitFor(() => expect(qrBox()).toHaveAttribute("data-token", TOKEN_1));
    fireEvent.click(screen.getByRole("button", { name: "Renovar ahora" }));
    await waitFor(() => expect(qrBox()).toHaveAttribute("data-token", TOKEN_2));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("fuera de la ventana de registro explica el motivo, no muestra código y reintenta cada minuto", async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, kind: "window", message: "El código solo está disponible durante la ventana de registro de la guardia" })
      .mockResolvedValueOnce(issued(TOKEN_1));
    renderDisplay(action);
    expect(await screen.findByText("Fuera de la ventana de registro")).toBeInTheDocument();
    expect(screen.getByText(/El código se puede mostrar del 17\/10\/2026 08:42/)).toBeInTheDocument();
    expect(qrBox()).toHaveAttribute("data-state", "error");
    expect(qrBox()).not.toHaveAttribute("data-token");

    await act(() => vi.advanceTimersByTimeAsync(61_000));
    await waitFor(() => expect(qrBox()).toHaveAttribute("data-token", TOKEN_1));
  });

  it("con la guardia cancelada muestra el error y no reintenta solo", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, kind: "cancelled", message: "La guardia está cancelada" });
    renderDisplay(action);
    expect(await screen.findByText("Guardia cancelada")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(300_000));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("si no hay respuesta del servidor avisa sin conexión, conserva el código vigente y lo da por caducado al vencer", async () => {
    const action = vi.fn().mockResolvedValueOnce(issued(TOKEN_1)).mockRejectedValue(new TypeError("Failed to fetch"));
    renderDisplay(action);
    await waitFor(() => expect(qrBox()).toHaveAttribute("data-token", TOKEN_1));

    await act(() => vi.advanceTimersByTimeAsync(91_000));
    expect(await screen.findByText("No se pudo renovar el código (sin conexión)")).toBeInTheDocument();
    expect(screen.getByText(/El código en pantalla sigue vigente \d+ s/)).toBeInTheDocument();
    expect(qrBox()).toHaveAttribute("data-token", TOKEN_1);

    await act(() => vi.advanceTimersByTimeAsync(40_000));
    expect(qrBox()).toHaveAttribute("data-state", "expired");
    expect(screen.queryByRole("img", { name: /Código QR/ })).toBeNull();
    expect(screen.getByText(/Caduca en 0 s\./)).toBeInTheDocument();
    expect(action.mock.calls.length).toBeGreaterThanOrEqual(3); // reintentos automáticos
  });
});

// -----------------------------------------------------------------------------

const fetchMock = vi.fn();

function okResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
}

function confirmed(action: "entrada" | "salida", at: string, result = "created") {
  return {
    ok: true,
    result,
    message: action === "entrada" ? "Entrada registrada." : "Salida registrada.",
    serverTime: at,
    session: {
      id: "09f38663-9135-4e0f-b846-eaf6a865d47a",
      assignment_id: ASSIGNMENT,
      check_in_at: action === "entrada" ? at : "2026-10-17T15:00:00Z",
      check_out_at: action === "salida" ? at : null,
      check_in_method: "qr",
      check_out_method: action === "salida" ? "qr" : null,
    },
  };
}

function renderAttendance(hasOpenSession = false) {
  return render(
    <QrAttendance assignmentId={ASSIGNMENT} qrToken={TOKEN_1} hasOpenSession={hasOpenSession} timeZone={TZ} label="[DEMO] Hospital A · Acceso principal" />,
  );
}

describe("QrAttendance (página del trabajador)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("muestra los avisos obligatorios y registra la entrada con el código (hora del servidor)", async () => {
    fetchMock.mockReturnValue(okResponse(confirmed("entrada", "2026-10-17T15:05:00Z")));
    renderAttendance(false);
    expect(screen.getByText("Entrada registrada no equivale a presencia física verificada.")).toBeInTheDocument();
    expect(screen.getByText("El código QR no prueba presencia física.")).toBeInTheDocument();
    expect(screen.getByText("Sin entrada abierta en esta guardia")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar salida con código QR" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Registrar entrada con código QR" }));
    expect(await screen.findByText("Entrada registrada a las 08:05 (hora del servidor)")).toBeInTheDocument();
    expect(screen.getByTestId("qr-confirmation")).toHaveAttribute("data-registered-at", "2026-10-17T15:05:00Z");
    expect(screen.getByText("Tienes una entrada abierta en esta guardia")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registrar (entrada|salida) con código QR/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Ver mi historial" })).toHaveAttribute("href", "/mi-historial");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/asistencia");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ action: "entrada", assignmentId: ASSIGNMENT, qrToken: TOKEN_1 });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("con entrada abierta ofrece la salida con código", async () => {
    fetchMock.mockReturnValue(okResponse(confirmed("salida", "2026-10-17T21:02:00Z")));
    renderAttendance(true);
    expect(screen.getByText("Tienes una entrada abierta en esta guardia")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Registrar salida con código QR" }));
    expect(await screen.findByText("Salida registrada a las 14:02 (hora del servidor)")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ action: "salida", qrToken: TOKEN_1 });
  });

  it("si el servidor indica que ya había una entrada abierta, ofrece la salida", async () => {
    fetchMock.mockReturnValue(okResponse({ ...confirmed("entrada", "2026-10-17T15:00:00Z", "already_open"), message: "Ya tienes una entrada abierta en esta guardia; no se registró otra." }));
    renderAttendance(false);
    await userEvent.click(screen.getByRole("button", { name: "Registrar entrada con código QR" }));
    expect(await screen.findByText("No se registró otra entrada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar salida con código QR" })).toBeInTheDocument();
    expect(screen.getByTestId("qr-confirmation")).not.toHaveAttribute("data-registered-at");
  });

  it("sin respuesta muestra «Registro NO confirmado» y el reintento reutiliza la misma solicitud", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockReturnValueOnce(okResponse(confirmed("entrada", "2026-10-17T15:06:00Z", "duplicate")));
    renderAttendance(false);
    await userEvent.click(screen.getByRole("button", { name: "Registrar entrada con código QR" }));
    expect(await screen.findByText("Registro NO confirmado")).toBeInTheDocument();
    expect(screen.queryByText(/Entrada registrada a las/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Reintentar envío" }));
    expect(await screen.findByText("Entrada registrada a las 08:06 (hora del servidor)")).toBeInTheDocument();
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(second.requestId).toBe(first.requestId);
    expect(second.qrToken).toBe(TOKEN_1);
  });

  it("si el código caducó lo explica y pide volver a escanear", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ ok: false, message: "El código QR expiró o no es válido. Escanea el código que se muestra ahora." }),
      } as Response),
    );
    renderAttendance(false);
    await userEvent.click(screen.getByRole("button", { name: "Registrar entrada con código QR" }));
    expect(await screen.findByText("El código QR caducó o no es válido")).toBeInTheDocument();
    expect(screen.getByText("Pide que muestren el código vigente y vuelve a escanearlo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar entrada con código QR" })).toBeInTheDocument();
  });
});
