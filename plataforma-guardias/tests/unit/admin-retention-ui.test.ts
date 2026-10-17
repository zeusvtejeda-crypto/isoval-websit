import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RetentionActions, RetentionSettingsForm } from "@/app/(app)/administracion/configuracion/_components/retention-forms";
import type { RetentionImpact } from "@/lib/admin/settings";

const impact: RetentionImpact = {
  executed: false,
  attendanceCutoff: "2024-10-17T12:00:00Z",
  auditCutoff: "2021-10-17T12:00:00Z",
  inactiveWorkerCutoff: "2024-10-17T12:00:00Z",
  shifts: 0,
  sessions: 0,
  auditRows: 0,
  workerPrivateRows: 2,
  auditRowsRedacted: 3,
};

// Server Actions simuladas (las reales requieren sesión y Supabase).
const actions = vi.hoisted(() => ({
  saveRetention: vi.fn(async () => ({ ok: true as const, message: "Periodos guardados." })),
  previewRetention: vi.fn(),
  applyRetention: vi.fn(),
}));
vi.mock("@/app/(app)/administracion/configuracion/actions", () => actions);

describe("RetentionSettingsForm", () => {
  it("incluye los meses para datos privados de trabajadores inactivos", async () => {
    const user = userEvent.setup();
    render(createElement(RetentionSettingsForm, { retention: { attendance_months: 24, audit_months: 60, inactive_worker_months: 18 } }));
    const input = screen.getByRole("spinbutton", { name: /datos privados de trabajadores inactivos/ });
    expect(input).toHaveValue(18);
    expect(input).toHaveAttribute("min", "1");
    await user.clear(input);
    await user.type(input, "30");
    await user.type(screen.getByRole("textbox", { name: /Motivo del cambio/ }), "Acuerdo del comité de datos");
    await user.click(screen.getByRole("button", { name: "Guardar periodos" }));
    expect(await screen.findByText("Periodos guardados.")).toBeInTheDocument();
    const sent = actions.saveRetention.mock.calls.at(-1) as unknown as [unknown, FormData];
    expect(sent[1].get("inactive_worker_months")).toBe("30");
    expect(sent[1].get("reason")).toBe("Acuerdo del comité de datos");
    // Tras guardar, el motivo se vacía para no reutilizarlo sin querer.
    expect(screen.getByRole("textbox", { name: /Motivo del cambio/ })).toHaveValue("");
  });
});

describe("RetentionActions", () => {
  it("«Calcular impacto» muestra los datos privados de trabajadores inactivos aunque no haya guardias por eliminar", async () => {
    const user = userEvent.setup();
    actions.previewRetention.mockResolvedValueOnce({ ok: true, message: "Cálculo realizado.", data: impact });
    render(createElement(RetentionActions));
    await user.click(screen.getByRole("button", { name: "Calcular impacto" }));
    const summary = await screen.findByText(/número de trabajador y teléfono de 2 trabajadores inactivos/);
    expect(summary).toHaveTextContent("17 oct 2024");
    expect(screen.getByText("Se eliminarían:")).toBeInTheDocument();
    // Las copias de esos datos en la bitácora también se redactan.
    expect(screen.getByText(/3 eventos de bitácora que copiaban esos datos/)).toBeInTheDocument();
  });

  it("la confirmación de «Aplicar ahora» advierte que también se borran las copias en la bitácora", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(createElement(RetentionActions));
    await user.click(screen.getByRole("checkbox", { name: /eliminación es definitiva/ }));
    await user.click(screen.getByRole("button", { name: "Aplicar política ahora" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/copias de esos datos en la bitácora/);
    expect(actions.applyRetention).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
