import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountStatusForm } from "@/app/(app)/administracion/usuarios/_components/account-status-form";
import { WorkerPicker } from "@/app/(app)/administracion/usuarios/_components/worker-picker";
import { FacilityPicker } from "@/app/(app)/administracion/usuarios/_components/facility-picker";
import { OneTimePassword } from "@/app/(app)/administracion/usuarios/_components/one-time-password";
import { formDataWithSubmitter } from "@/lib/admin/use-action-form";
import type { FacilityChoice, WorkerOption } from "@/lib/admin/accounts";

// Server Actions simuladas (las reales requieren sesión y Supabase).
const actions = vi.hoisted(() => ({
  setAccountActive: vi.fn(async (_prev: unknown, data: FormData) =>
    data.get("active") === "0" ? { ok: true as const, message: "Cuenta desactivada. Ya no puede iniciar sesión." } : { ok: false as const, message: "Error" },
  ),
}));
vi.mock("@/app/(app)/administracion/usuarios/actions", () => ({
  setAccountActive: actions.setAccountActive,
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  resetAccountPassword: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const workers: WorkerOption[] = Array.from({ length: 10 }, (_, i) => ({
  id: `c0000000-0000-4000-8000-00000000000${i}`,
  fullName: i === 3 ? "José Núñez" : `Persona ${i}`,
  internalCode: `TRA-00000${i}`,
  facilityName: i % 2 ? "UMF 1" : "Hospital A",
  active: true,
}));

const facilities: FacilityChoice[] = Array.from({ length: 8 }, (_, i) => ({
  id: `d0000000-0000-4000-8000-00000000000${i}`,
  name: i === 5 ? "[DEMO] Hospital Ñ" : `Sede ${i}`,
  active: i !== 7,
  isDemo: i === 5,
}));

describe("WorkerPicker", () => {
  it("filtra por nombre sin acentos y conserva la opción elegida", async () => {
    const user = userEvent.setup();
    render(createElement(WorkerPicker, { id: "w", options: workers, defaultValue: workers[1].id }));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe(workers[1].id);
    await user.type(screen.getByRole("searchbox", { name: "Buscar trabajador" }), "nunez");
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("José Núñez · TRA-000003 · UMF 1");
    // La opción seleccionada sigue disponible aunque no coincida.
    expect(labels).toContain("Persona 1 · TRA-000001 · UMF 1");
    expect(labels).not.toContain("Persona 2 · TRA-000002 · Hospital A");
    expect(screen.getByText("1 coincidencia.")).toBeInTheDocument();
  });
});

describe("FacilityPicker", () => {
  it("la búsqueda no pierde sedes ya marcadas", async () => {
    const user = userEvent.setup();
    const { container } = render(createElement(FacilityPicker, { idPrefix: "t", choices: facilities, defaultSelected: [facilities[0].id] }));
    expect(screen.getByText("1 sede seleccionada")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Buscar sede" }), "hospital n");
    await user.click(screen.getByRole("checkbox", { name: /Hospital Ñ/ }));
    expect(screen.getByText("2 sedes seleccionadas")).toBeInTheDocument();
    expect(screen.getByText("Demostración")).toBeInTheDocument();
    const checked = Array.from(container.querySelectorAll<HTMLInputElement>('input[name="facility_ids"]:checked')).map((i) => i.value);
    expect(checked.sort()).toEqual([facilities[0].id, facilities[5].id].sort());
    expect(screen.getByText("Sede 7 (inactiva)", { exact: false })).toBeInTheDocument();
  });

  it("muestra el nombre de cada sede seleccionada y permite quitarla", async () => {
    const user = userEvent.setup();
    const { container } = render(
      createElement(FacilityPicker, { idPrefix: "t", choices: facilities, defaultSelected: [facilities[2].id, facilities[7].id] }),
    );
    const list = screen.getByRole("list", { name: "Sedes seleccionadas" });
    expect(Array.from(list.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["Sede 2×", "Sede 7 (inactiva)×"]);
    // La búsqueda oculta casillas, pero los nombres seleccionados siguen a la vista.
    await user.type(screen.getByRole("searchbox", { name: "Buscar sede" }), "hospital");
    expect(screen.getByRole("list", { name: "Sedes seleccionadas" })).toHaveTextContent("Sede 2");
    await user.click(screen.getByRole("button", { name: "Quitar Sede 2" }));
    expect(screen.getByText("1 sede seleccionada")).toBeInTheDocument();
    const checked = Array.from(container.querySelectorAll<HTMLInputElement>('input[name="facility_ids"]:checked')).map((i) => i.value);
    expect(checked).toEqual([facilities[7].id]);
    await user.click(screen.getByRole("button", { name: "Quitar Sede 7" }));
    expect(screen.queryByRole("list", { name: "Sedes seleccionadas" })).not.toBeInTheDocument();
  });

  it("indica cuando no hay instalaciones", () => {
    render(createElement(FacilityPicker, { idPrefix: "t", choices: [], defaultSelected: [], error: "Asigna al menos una sede." }));
    expect(screen.getByText(/No hay instalaciones activas/)).toBeInTheDocument();
    expect(screen.getByText("Asigna al menos una sede.")).toBeInTheDocument();
  });
});

describe("OneTimePassword", () => {
  it("se muestra una vez y al ocultarla no se puede recuperar", async () => {
    const user = userEvent.setup();
    render(createElement(OneTimePassword, { password: "Xy7-abcdefghjk", email: "ana@ejemplo.mx" }));
    expect(screen.getByText("Xy7-abcdefghjk")).toBeInTheDocument();
    expect(screen.getByText(/se muestra una sola vez/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ya la copié, ocultar" }));
    expect(screen.queryByText("Xy7-abcdefghjk")).not.toBeInTheDocument();
    expect(screen.getByText(/ya no puede volver a mostrarse/)).toBeInTheDocument();
  });
});

describe("formDataWithSubmitter", () => {
  it("incluye el valor del botón que envió el formulario", () => {
    const form = document.createElement("form");
    form.innerHTML = '<input name="reason" value="Motivo largo"><button type="submit" name="active" value="0">Desactivar</button>';
    document.body.appendChild(form);
    const button = form.querySelector("button");
    const data = formDataWithSubmitter(form, button);
    expect(data.get("active")).toBe("0");
    expect(data.get("reason")).toBe("Motivo largo");
    expect(formDataWithSubmitter(form, null).get("active")).toBeNull();
    form.remove();
  });
});

describe("AccountStatusForm", () => {
  const U = "a0000000-0000-4000-8000-000000000001";

  it("pide confirmación, envía el motivo y el estado, y vacía el motivo tras el cambio", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(createElement(AccountStatusForm, { userId: U, active: true, banned: false, isSelf: false }));
    const reason = screen.getByRole("textbox", { name: /Motivo/ }) as HTMLTextAreaElement;
    await user.type(reason, "Baja temporal por licencia");
    await user.click(screen.getByRole("button", { name: "Desactivar cuenta" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Cuenta desactivada. Ya no puede iniciar sesión.")).toBeInTheDocument();
    const sent = actions.setAccountActive.mock.calls.at(-1)?.[1] as FormData;
    expect(sent.get("active")).toBe("0");
    expect(sent.get("reason")).toBe("Baja temporal por licencia");
    expect(sent.get("user_id")).toBe(U);
    // El motivo no queda escrito para la siguiente acción.
    expect((screen.getByRole("textbox", { name: /Motivo/ }) as HTMLTextAreaElement).value).toBe("");
  });

  it("si se cancela la confirmación no se envía nada", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    actions.setAccountActive.mockClear();
    render(createElement(AccountStatusForm, { userId: U, active: true, banned: false, isSelf: false }));
    await user.type(screen.getByRole("textbox", { name: /Motivo/ }), "Motivo suficiente");
    await user.click(screen.getByRole("button", { name: "Desactivar cuenta" }));
    expect(actions.setAccountActive).not.toHaveBeenCalled();
  });

  it("no permite desactivar la propia cuenta", () => {
    render(createElement(AccountStatusForm, { userId: U, active: true, banned: false, isSelf: true }));
    expect(screen.queryByRole("button", { name: "Desactivar cuenta" })).not.toBeInTheDocument();
    expect(screen.getByText(/No puedes desactivar tu propia cuenta/)).toBeInTheDocument();
  });

  it("ofrece corregir el bloqueo cuando no coincide con el estado", () => {
    render(createElement(AccountStatusForm, { userId: U, active: false, banned: false, isSelf: false }));
    expect(screen.getByRole("button", { name: "Reactivar cuenta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bloquear inicio de sesión" })).toBeInTheDocument();
  });
});
