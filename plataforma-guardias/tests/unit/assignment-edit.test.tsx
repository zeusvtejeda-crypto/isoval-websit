import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActionResult } from "@/lib/actions";
import { EditAssignmentForm } from "@/components/shifts/assignment-forms";

/**
 * «Editar asignación»: punto asignado, «cubre a» y notas con motivo obligatorio.
 */

afterEach(() => cleanup());

const FACILITY = "d0000000-0000-4000-8000-000000000001";
type Action = (prev: ActionResult | null, data: FormData) => Promise<ActionResult>;

const assignedWorkers = [
  { id: "w1", full_name: "[DEMO] Ana Martínez" },
  { id: "w2", full_name: "[DEMO] Luis Hernández" },
];
const facilityWorkers = [
  { id: "w2", full_name: "[DEMO] Luis Hernández", internal_code: "T-0002", facility_id: FACILITY },
  { id: "w3", full_name: "[DEMO] María López", internal_code: "T-0003", facility_id: FACILITY },
];

function renderForm(action: Action, overrides: Partial<Parameters<typeof EditAssignmentForm>[0]> = {}) {
  const props = {
    action,
    assignmentId: "a1",
    workerId: "w1",
    assignedPoint: "Puerta norte",
    substituteId: null,
    substituteName: null,
    notes: "Trae radio",
    assignedWorkers,
    facilityWorkers,
    ...overrides,
  };
  const view = render(<EditAssignmentForm {...props} />);
  return { ...view, props };
}

const reasonField = () => screen.getByLabelText(/Motivo del cambio/) as HTMLTextAreaElement;
const substituteField = () => screen.getByLabelText(/Cubre a \(sustitución\)/) as HTMLSelectElement;

describe("EditAssignmentForm", () => {
  it("muestra los valores guardados, no ofrece a la propia persona como sustituida y envía los campos con el motivo", async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async () => ({ ok: true, message: "Asignación actualizada." }));
    renderForm(action);

    expect(screen.getByLabelText(/Punto asignado/)).toHaveValue("Puerta norte");
    expect(screen.getByLabelText(/^Notas/)).toHaveValue("Trae radio");
    expect(substituteField()).toHaveValue("");
    // w1 es la persona asignada; w2 aparece una sola vez (asignada a la guardia).
    expect(Array.from(substituteField().options).map((o) => o.value)).toEqual(["", "w2", "w3"]);
    expect(reasonField()).toBeRequired();
    expect(reasonField()).toHaveAttribute("minLength", "5");

    await user.clear(screen.getByLabelText(/Punto asignado/));
    await user.selectOptions(substituteField(), "w3");
    await user.type(reasonField(), "Cubre la incapacidad de María");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(action).toHaveBeenCalledTimes(1);
    const sent = action.mock.calls[0][1];
    expect(sent.get("assignment_id")).toBe("a1");
    expect(sent.get("assigned_point")).toBe("");
    expect(sent.get("substitute_for_worker_id")).toBe("w3");
    expect(sent.get("notes")).toBe("Trae radio");
    expect(sent.get("reason")).toBe("Cubre la incapacidad de María");
    expect(await screen.findByText("Asignación actualizada.")).toBeInTheDocument();
  });

  it("conserva a la persona sustituida actual aunque no esté en las listas", () => {
    renderForm(vi.fn<Action>(), { substituteId: "w9", substituteName: "[DEMO] Pedro Ruiz" });
    expect(substituteField()).toHaveValue("w9");
    expect(screen.getByRole("option", { name: "[DEMO] Pedro Ruiz" })).toBeInTheDocument();
    cleanup();
    renderForm(vi.fn<Action>(), { substituteId: "w9", substituteName: null });
    expect(screen.getByRole("option", { name: "Persona no visible para tu cuenta" })).toHaveValue("w9");
  });

  it("muestra los errores por campo y conserva lo capturado", async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async () => ({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { reason: "Indica el motivo del cambio (mínimo 5 caracteres).", substitute_for_worker_id: "Elige a una persona de la lista." },
    }));
    renderForm(action);
    await user.selectOptions(substituteField(), "w2");
    await user.type(reasonField(), "Ajuste");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Indica el motivo del cambio (mínimo 5 caracteres).")).toBeInTheDocument();
    expect(screen.getByText("Elige a una persona de la lista.")).toBeInTheDocument();
    expect(substituteField()).toHaveValue("w2");
    expect(reasonField()).toHaveValue("Ajuste");
  });

  it("al guardar, los campos toman los valores nuevos y el motivo queda vacío", async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async () => ({ ok: true, message: "Asignación actualizada." }));
    const { rerender, props } = renderForm(action);
    const point = screen.getByLabelText(/Punto asignado/);
    await user.clear(point);
    await user.type(point, "  Acceso de urgencias ");
    await user.selectOptions(substituteField(), "w2");
    await user.type(reasonField(), "Sustituye a Luis");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Asignación actualizada.")).toBeInTheDocument();

    // La página se revalida con los datos guardados (recortados por el servidor).
    rerender(<EditAssignmentForm {...props} assignedPoint="Acceso de urgencias" substituteId="w2" substituteName="[DEMO] Luis Hernández" />);
    expect(screen.getByLabelText(/Punto asignado/)).toHaveValue("Acceso de urgencias");
    expect(substituteField()).toHaveValue("w2");
    expect(reasonField()).toHaveValue("");
    expect(screen.getByText("Asignación actualizada.")).toBeInTheDocument();
  });
});
