import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StateCoverageSwitch, StateTimezoneForm } from "@/app/(app)/administracion/catalogos/_components/state-forms";
import { MunicipalityTimezoneEditor, NewMunicipalityForm } from "@/app/(app)/administracion/catalogos/_components/municipality-forms";

type Result = { ok: true; message: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

// Server Actions simuladas (las reales requieren sesión y Supabase).
const actions = vi.hoisted(() => {
  const ok = (message: string) => vi.fn<(prev: unknown, data: FormData) => Promise<Result>>(async () => ({ ok: true, message }));
  return {
    setStateCoverage: ok("Cobertura activa en Oaxaca."),
    saveStateTimezone: ok("Zona guardada."),
    saveMunicipalityTimezone: ok("Abejones (clave 001) usará la zona horaria de la entidad."),
    createMunicipality: ok("Municipio agregado."),
  };
});
vi.mock("@/app/(app)/administracion/catalogos/actions", () => actions);

describe("StateCoverageSwitch", () => {
  it("pide el motivo antes de enviar el valor contrario", async () => {
    const user = userEvent.setup();
    const calls = actions.setStateCoverage.mock.calls.length;
    render(createElement(StateCoverageSwitch, { stateId: 20, stateName: "Oaxaca", enabled: false }));
    const toggle = screen.getByRole("button", { name: /Cobertura en Oaxaca: inactiva/ });
    expect(toggle).toHaveTextContent("Inactiva");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Sin motivo, el navegador no envía el formulario.
    await user.click(screen.getByRole("button", { name: "Activar cobertura" }));
    expect(actions.setStateCoverage.mock.calls.length).toBe(calls);
    await user.type(screen.getByRole("textbox", { name: /Motivo del cambio/ }), "Convenio con la delegación");
    await user.click(screen.getByRole("button", { name: "Activar cobertura" }));
    expect(await screen.findByText("Cobertura activa en Oaxaca.")).toBeInTheDocument();
    const sent = actions.setStateCoverage.mock.calls.at(-1)?.[1] as FormData;
    expect(sent.get("state_id")).toBe("20");
    expect(sent.get("enabled")).toBe("1");
    expect(sent.get("reason")).toBe("Convenio con la delegación");
    // Tras guardar, la confirmación se cierra.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("muestra el error de la base tal cual", async () => {
    const user = userEvent.setup();
    actions.setStateCoverage.mockResolvedValueOnce({ ok: false, message: "No tienes permiso para realizar esta acción." });
    render(createElement(StateCoverageSwitch, { stateId: 18, stateName: "Nayarit", enabled: true }));
    await user.click(screen.getByRole("button", { name: /Cobertura en Nayarit: activa/ }));
    await user.type(screen.getByRole("textbox", { name: /Motivo del cambio/ }), "Fin del convenio");
    await user.click(screen.getByRole("button", { name: "Desactivar cobertura" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para realizar esta acción.");
    expect((actions.setStateCoverage.mock.calls.at(-1)?.[1] as FormData).get("enabled")).toBe("0");
  });
});

describe("StateTimezoneForm", () => {
  it("solo permite guardar cuando cambia la zona y envía la elegida", async () => {
    const user = userEvent.setup();
    render(createElement(StateTimezoneForm, { stateId: 2, stateName: "Baja California", value: "America/Tijuana" }));
    const button = screen.getByRole("button", { name: "Guardar zona" });
    expect(button).toBeDisabled();
    // El motivo solo aparece cuando hay un cambio por guardar.
    expect(screen.queryByRole("textbox", { name: /Motivo del cambio/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Zona horaria por omisión de Baja California"), "America/Hermosillo");
    expect(button).toBeEnabled();
    await user.type(screen.getByRole("textbox", { name: /Motivo del cambio/ }), "Horario oficial del estado");
    await user.click(button);
    expect(await screen.findByText("Zona guardada.")).toBeInTheDocument();
    const sent = actions.saveStateTimezone.mock.calls.at(-1)?.[1] as FormData;
    expect(sent.get("default_timezone")).toBe("America/Hermosillo");
    expect(sent.get("state_id")).toBe("2");
    expect(sent.get("reason")).toBe("Horario oficial del estado");
  });
});

describe("MunicipalityTimezoneEditor", () => {
  const municipality = { id: 5, name: "Abejones", inegiCode: "001", timezone: "America/Merida" };

  it("muestra la zona efectiva y al guardar vacía vuelve a la de la entidad", async () => {
    const user = userEvent.setup();
    render(createElement(MunicipalityTimezoneEditor, { stateId: 20, stateTimezone: "America/Mexico_City", municipality }));
    expect(screen.getByText("America/Merida")).toBeInTheDocument();
    expect(screen.getByText("(propia)")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cambiar zona horaria de Abejones (clave 001)" }));
    await user.selectOptions(screen.getByRole("combobox"), "");
    await user.type(screen.getByRole("textbox", { name: /Motivo del cambio/ }), "Usa el horario de la entidad");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Abejones (clave 001) usará la zona horaria de la entidad.")).toBeInTheDocument();
    const sent = actions.saveMunicipalityTimezone.mock.calls.at(-1)?.[1] as FormData;
    expect(sent.get("timezone")).toBe("");
    expect(sent.get("reason")).toBe("Usa el horario de la entidad");
    expect(sent.get("municipality_id")).toBe("5");
    expect(sent.get("state_id")).toBe("20");
    // Tras guardar, el formulario se cierra.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("NewMunicipalityForm", () => {
  it("pide confirmar un nombre repetido y envía la confirmación", async () => {
    const user = userEvent.setup();
    actions.createMunicipality.mockResolvedValueOnce({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: {
        name: "Ya existe «San Juan Mixtepec» (clave 208) en Oaxaca.",
        allow_duplicate_name: "Si es un municipio distinto con el mismo nombre oficial, marca la casilla para confirmarlo.",
      },
    });
    render(createElement(NewMunicipalityForm, { stateId: 20, stateName: "Oaxaca", stateTimezone: "America/Mexico_City" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Clave INEGI/ }), "209");
    await user.type(screen.getByRole("textbox", { name: /Nombre oficial/ }), "San Juan Mixtepec");
    await user.type(screen.getByRole("textbox", { name: /Motivo del alta/ }), "Publicación del INEGI");
    await user.click(screen.getByRole("button", { name: "Agregar municipio" }));
    expect(await screen.findByText("Ya existe «San Juan Mixtepec» (clave 208) en Oaxaca.")).toBeInTheDocument();
    // Lo capturado se conserva y aparece la casilla de confirmación.
    expect(screen.getByRole("textbox", { name: /Clave INEGI/ })).toHaveValue("209");
    const confirm = screen.getByRole("checkbox", { name: /municipio distinto con el mismo nombre/ });
    await user.click(confirm);
    await user.click(screen.getByRole("button", { name: "Agregar municipio" }));
    expect(await screen.findByText("Municipio agregado.")).toBeInTheDocument();
    const sent = actions.createMunicipality.mock.calls.at(-1)?.[1] as FormData;
    expect(sent.get("allow_duplicate_name")).toBe("on");
    expect(sent.get("inegi_code")).toBe("209");
    expect(sent.get("state_id")).toBe("20");
    expect(sent.get("reason")).toBe("Publicación del INEGI");
    // Tras agregar, el formulario se limpia (también el motivo).
    expect(screen.getByRole("textbox", { name: /Clave INEGI/ })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /Motivo del alta/ })).toHaveValue("");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
