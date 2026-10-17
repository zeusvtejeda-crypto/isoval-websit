import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActionResult } from "@/lib/actions";
import { ShiftForm, type ShiftFormDefaults } from "@/components/shifts/shift-form";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => cleanup());

const defaults: ShiftFormDefaults = {
  title: "",
  meeting_point: "Acceso principal",
  date: "2026-10-17",
  start_time: "08:00",
  end_time: "14:00",
  responsible_worker_id: "",
  min_staff: "1",
  max_staff: "",
  instructions: "",
};

const facility = { id: "d0000000-0000-4000-8000-000000000001", official_name: "[DEMO] Hospital A", timezone: "America/Mazatlan" };

describe("ShiftForm", () => {
  it("avisa «Termina al día siguiente» cuando el término es menor o igual al inicio", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<ActionResult<{ id: string }>> => ({ ok: true }));
    render(<ShiftForm action={action} facility={facility} workers={[]} defaults={defaults} cancelHref="/guardias" />);

    expect(screen.queryByText("Termina al día siguiente")).not.toBeInTheDocument();
    expect(screen.getByText(/Duración: 6 h/)).toBeInTheDocument();

    const end = screen.getByLabelText(/Hora de término/);
    await user.clear(end);
    await user.type(end, "06:00");
    expect(screen.getByText("Termina al día siguiente")).toBeInTheDocument();
    expect(screen.getByText(/domingo 18 de octubre a las 06:00/)).toBeInTheDocument();
    expect(screen.getByText(/Duración: 22 h/)).toBeInTheDocument();

    await user.clear(end);
    await user.type(end, "08:00");
    expect(screen.getByText(/dura 24 horas/)).toBeInTheDocument();
  });

  it("muestra los errores por campo que devuelve la acción y conserva lo capturado", async () => {
    const user = userEvent.setup();
    const action = vi.fn(
      async (): Promise<ActionResult<{ id: string }>> => ({
        ok: false,
        message: "Revisa los campos marcados.",
        fieldErrors: { max_staff: "El cupo máximo debe ser mayor o igual al mínimo." },
      }),
    );
    render(<ShiftForm action={action} shiftId="d2000000-0000-4000-8000-000000000001" facility={facility} workers={[]} defaults={defaults} cancelHref="/guardias" />);

    expect(screen.getByLabelText(/Motivo del cambio/)).toBeInTheDocument();
    const point = screen.getByLabelText(/Punto de reunión o acceso/);
    await user.clear(point);
    await user.type(point, "Puerta norte");
    await user.type(screen.getByLabelText(/Motivo del cambio/), "Cambio de acceso");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("El cupo máximo debe ser mayor o igual al mínimo.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Revisa los campos marcados.");
    expect(action).toHaveBeenCalledTimes(1);
    expect(point).toHaveValue("Puerta norte");
  });
});
