import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttendanceButtons } from "@/components/attendance/attendance-buttons";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
}));

const ASSIGNMENT = "71ee77ad-676f-4fe3-b3e1-3f29c8f4df2c";
const TZ = "America/Mazatlan"; // UTC−7

const fetchMock = vi.fn();

function okResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
}

function created(action: "entrada" | "salida", at: string) {
  return {
    ok: true,
    result: "created",
    message: action === "entrada" ? "Entrada registrada." : "Salida registrada.",
    serverTime: at,
    session: {
      id: "09f38663-9135-4e0f-b846-eaf6a865d47a",
      assignment_id: ASSIGNMENT,
      check_in_at: action === "entrada" ? at : "2026-10-17T13:00:00Z",
      check_out_at: action === "salida" ? at : null,
      check_in_method: "propio",
      check_out_method: action === "salida" ? "propio" : null,
    },
  };
}

function renderButtons(props: Partial<Parameters<typeof AttendanceButtons>[0]> = {}) {
  return render(
    <AttendanceButtons assignmentId={ASSIGNMENT} timeZone={TZ} label="[DEMO] Hospital A · Acceso principal" canCheckIn canCheckOut={false} {...props} />,
  );
}

const entrada = () => screen.getByRole("button", { name: /Registrar entrada|Enviando/ });

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AttendanceButtons", () => {
  it("siempre muestra el aviso de que la entrada no equivale a presencia física", () => {
    renderButtons();
    expect(screen.getByText("Entrada registrada no equivale a presencia física verificada.")).toBeInTheDocument();
  });

  it("al confirmar muestra la hora del SERVIDOR en la zona de la sede y actualiza la página", async () => {
    fetchMock.mockReturnValue(okResponse(created("entrada", "2026-10-17T15:05:00Z")));
    renderButtons();
    await userEvent.click(entrada());
    expect(await screen.findByText("Entrada registrada a las 08:05 (hora del servidor)")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ action: "entrada", assignmentId: ASSIGNMENT });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("muestra la salida confirmada con la hora del servidor", async () => {
    fetchMock.mockReturnValue(okResponse(created("salida", "2026-10-17T21:02:00Z")));
    renderButtons({ canCheckIn: false, canCheckOut: true });
    await userEvent.click(screen.getByRole("button", { name: "Registrar salida" }));
    expect(await screen.findByText("Salida registrada a las 14:02 (hora del servidor)")).toBeInTheDocument();
  });

  it("con error de red muestra «no confirmado» y NUNCA «registrada»", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderButtons();
    await userEvent.click(entrada());
    expect(await screen.findByText("Registro NO confirmado")).toBeInTheDocument();
    expect(screen.getByText(/no se guardó o no pudo confirmarse/)).toBeInTheDocument();
    expect(screen.queryByText(/registrada a las/i)).toBeNull();
    expect(screen.queryByText("Registro confirmado")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("al reintentar tras «no confirmado» reutiliza la misma solicitud (no duplica)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockReturnValueOnce(okResponse({ ...created("entrada", "2026-10-17T15:05:00Z"), result: "duplicate" }));
    renderButtons();
    await userEvent.click(entrada());
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar envío" }));
    expect(await screen.findByText("Entrada registrada a las 08:05 (hora del servidor)")).toBeInTheDocument();
    expect(screen.getByText(/no se duplicó/)).toBeInTheDocument();
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(second.requestId).toBe(first.requestId);
  });

  it("doble clic envía una sola solicitud y muestra «Enviando…» deshabilitado", async () => {
    let resolve: (v: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    renderButtons();
    const button = entrada();
    fireEvent.click(button);
    fireEvent.click(button);
    await userEvent.dblClick(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(entrada()).toBeDisabled();
    expect(entrada()).toHaveTextContent("Enviando…");
    // Mientras no responde el servidor no se muestra nada como registrado.
    expect(screen.queryByText(/registrada a las/i)).toBeNull();
    await act(async () => {
      resolve({ ok: true, status: 200, json: () => Promise.resolve(created("entrada", "2026-10-17T15:05:00Z")) } as Response);
    });
    expect(await screen.findByText("Entrada registrada a las 08:05 (hora del servidor)")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin conexión deshabilita los botones, lo explica y no envía", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    renderButtons({ canCheckOut: true });
    expect(screen.getByText("Sin conexión")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Registrar entrada" });
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Registrar salida" })).toBeDisabled();
    fireEvent.click(button);
    await userEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/registrada a las/i)).toBeNull();
  });

  it("si el servidor rechaza, muestra su mensaje", async () => {
    fetchMock.mockReturnValue(okResponse({ ok: false, message: "Todavía no abre el registro de esta guardia" }));
    renderButtons();
    await userEvent.click(entrada());
    expect(await screen.findByText("Todavía no abre el registro de esta guardia")).toBeInTheDocument();
    expect(screen.getByText("No se registró")).toBeInTheDocument();
    expect(screen.queryByText(/registrada a las/i)).toBeNull();
  });

  it("una entrada ya abierta no se presenta como registro nuevo", async () => {
    fetchMock.mockReturnValue(
      okResponse({ ...created("entrada", "2026-10-17T15:05:00Z"), result: "already_open", message: "Ya tienes una entrada abierta en esta guardia; no se registró otra." }),
    );
    renderButtons();
    await userEvent.click(entrada());
    expect(await screen.findByText("No se registró otra entrada")).toBeInTheDocument();
    expect(screen.getByText(/desde las 08:05/)).toBeInTheDocument();
    expect(screen.queryByText(/registrada a las/i)).toBeNull();
  });

  it("explica por qué un botón está deshabilitado y envía la nota opcional", async () => {
    fetchMock.mockReturnValue(okResponse(created("entrada", "2026-10-17T15:05:00Z")));
    renderButtons({ canCheckOut: false, checkOutDisabledReason: "No hay una entrada abierta en esta guardia." });
    expect(screen.getByText("No hay una entrada abierta en esta guardia.")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Agregar una nota (opcional)"));
    await userEvent.type(screen.getByLabelText(/Nota para coordinación/), "Llegué por la puerta 2");
    await userEvent.click(entrada());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).notes).toBe("Llegué por la puerta 2");
    expect(await screen.findByText(/Guardia: \[DEMO\] Hospital A/)).toBeInTheDocument();
  });

  it("una respuesta sin JSON (p. ej. 502 del proxy) queda «no confirmada» y el reintento usa la misma solicitud", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError("Unexpected token <")) } as unknown as Response),
    );
    fetchMock.mockReturnValueOnce(okResponse({ ...created("entrada", "2026-10-17T15:05:00Z"), result: "duplicate" }));
    renderButtons();
    await userEvent.click(entrada());
    expect(await screen.findByText("Registro NO confirmado")).toBeInTheDocument();
    expect(screen.queryByText(/registrada a las/i)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar envío" }));
    expect(await screen.findByText("Entrada registrada a las 08:05 (hora del servidor)")).toBeInTheDocument();
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(second.requestId).toBe(first.requestId);
  });

  it("si el servidor no pudo confirmar con la base (503 «unconfirmed»), queda «no confirmado» y el reintento usa la misma solicitud", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ ok: false, unconfirmed: true, message: "No se pudo confirmar el registro con el servidor de datos. Reintenta: no se duplicará." }),
      } as unknown as Response),
    );
    fetchMock.mockReturnValueOnce(okResponse({ ...created("entrada", "2026-10-17T15:05:00Z"), result: "duplicate" }));
    renderButtons();
    await userEvent.click(entrada());
    expect(await screen.findByText("Registro NO confirmado")).toBeInTheDocument();
    expect(screen.queryByText(/No se registró/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar envío" }));
    expect(await screen.findByText("Entrada registrada a las 08:05 (hora del servidor)")).toBeInTheDocument();
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(second.requestId).toBe(first.requestId);
  });

  it("si se pierde la conexión tras «no confirmado», el reintento queda deshabilitado y no envía", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderButtons();
    await userEvent.click(entrada());
    const retry = await screen.findByRole("button", { name: "Reintentar envío" });
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(retry).toBeDisabled();
    expect(screen.getByText("Podrás reintentar cuando vuelva la conexión.")).toBeInTheDocument();
    fireEvent.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/registrada a las/i)).toBeNull();
  });

  it("«entrada abierta en otra guardia» y «sin entrada abierta» no se presentan como registros", async () => {
    fetchMock.mockReturnValueOnce(
      okResponse({
        ok: true,
        result: "open_elsewhere",
        message: "Hay una entrada abierta en otra guardia. Registra la salida de esa guardia o solicita una corrección.",
        serverTime: "2026-10-17T15:05:00Z",
        session: null,
      }),
    );
    const { unmount } = renderButtons();
    await userEvent.click(entrada());
    expect(await screen.findByText("No se registró la entrada")).toBeInTheDocument();
    expect(screen.getByText(/entrada abierta en otra guardia/)).toBeInTheDocument();
    expect(screen.queryByText(/registrada a las/i)).toBeNull();
    unmount();

    fetchMock.mockReturnValueOnce(
      okResponse({ ok: true, result: "no_open_session", message: "No hay una entrada abierta en esta guardia.", serverTime: "2026-10-17T15:05:00Z", session: null }),
    );
    renderButtons({ canCheckIn: false, canCheckOut: true });
    await userEvent.click(screen.getByRole("button", { name: "Registrar salida" }));
    expect(await screen.findByText("No se registró la salida")).toBeInTheDocument();
    expect(screen.queryByText(/registrada a las/i)).toBeNull();
  });

  it("conserva el resultado del último envío aunque ya no haya asignación que registrar", async () => {
    fetchMock.mockReturnValue(okResponse(created("salida", "2026-10-17T21:02:00Z")));
    const { rerender } = renderButtons({ canCheckIn: false, canCheckOut: true });
    await userEvent.click(screen.getByRole("button", { name: "Registrar salida" }));
    await screen.findByText("Salida registrada a las 14:02 (hora del servidor)");
    rerender(<AttendanceButtons assignmentId={null} timeZone={TZ} canCheckIn={false} canCheckOut={false} />);
    expect(screen.getByText("Salida registrada a las 14:02 (hora del servidor)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registrar/ })).toBeNull();
  });
});
