/**
 * «Motivo del cambio» en los formularios de administración (configuración,
 * categorías, cuentas y contraseñas) y auditoría sin trabajador vinculado.
 */
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActionResult } from "@/lib/actions";
import type { FacilityChoice, WorkerOption } from "@/lib/admin/accounts";
import { CreateAccountForm, EditAccountForm, type RoleOption } from "@/app/(app)/administracion/usuarios/_components/account-forms";
import { ResetPasswordForm } from "@/app/(app)/administracion/usuarios/_components/reset-password-form";
import { PrivacyNoticeForm } from "@/app/(app)/administracion/configuracion/_components/privacy-form";
import { AttendanceSettingsForm } from "@/app/(app)/administracion/configuracion/_components/attendance-form";
import { CategoryForm } from "@/app/(app)/administracion/categorias/_components/category-form";
import { CategoryActiveForm, CategoryDeleteForm } from "@/app/(app)/administracion/categorias/_components/category-actions";
import { auditTableLabel, auditTablesFor } from "@/lib/admin/audit-labels";
import { auditFieldChanges, auditSubject } from "@/lib/admin/audit-diff";

type Action = (prev: unknown, data: FormData) => Promise<ActionResult>;

// Server Actions simuladas (las reales requieren sesión y Supabase).
const actions = vi.hoisted(() => {
  const ok = (message: string) => vi.fn<Action>(async () => ({ ok: true, message }));
  return {
    updateAccount: ok("Cambios guardados."),
    createAccount: ok("Cuenta creada."),
    resetAccountPassword: ok("Contraseña temporal restablecida."),
    savePrivacyNotice: ok("Aviso guardado."),
    saveAttendanceSettings: ok("Configuración guardada."),
  };
});
vi.mock("@/app/(app)/administracion/usuarios/actions", () => ({
  updateAccount: actions.updateAccount,
  createAccount: actions.createAccount,
  resetAccountPassword: actions.resetAccountPassword,
  setAccountActive: vi.fn(),
}));
vi.mock("@/app/(app)/administracion/configuracion/actions", () => ({
  savePrivacyNotice: actions.savePrivacyNotice,
  saveAttendanceSettings: actions.saveAttendanceSettings,
  saveRetention: vi.fn(),
  previewRetention: vi.fn(),
  applyRetention: vi.fn(),
  purgeDemoData: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const lastCall = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.at(-1)?.[1] as FormData;

const roleOptions: RoleOption[] = [
  { value: "admin", label: "Administración" },
  { value: "coordinador", label: "Coordinación" },
  { value: "auditor", label: "Auditoría" },
  { value: "trabajador", label: "Trabajador" },
];
const W1 = "c0000000-0000-4000-8000-000000000001";
const workers: WorkerOption[] = [{ id: W1, fullName: "Ana Pérez", internalCode: "TRA-000001", facilityName: "UMF 1", active: true }];
const F1 = "d0000000-0000-4000-8000-000000000001";
const F2 = "d0000000-0000-4000-8000-000000000002";
const facilities: FacilityChoice[] = [
  { id: F1, name: "UMF 1", active: true, isDemo: false },
  { id: F2, name: "Hospital A", active: true, isDemo: false },
];

describe("EditAccountForm", () => {
  it("pide motivo al cambiar las sedes asignadas (no solo el rol) y lo vacía tras guardar", async () => {
    const user = userEvent.setup();
    const calls = actions.updateAccount.mock.calls.length;
    render(
      createElement(EditAccountForm, {
        userId: "a0000000-0000-4000-8000-000000000001",
        roleOptions,
        workerOptions: workers,
        facilityChoices: facilities,
        defaults: { display_name: "Luis", role: "coordinador", worker_id: null, facility_ids: [F1] },
      }),
    );
    const reason = screen.getByRole("textbox", { name: /Motivo del cambio/ });
    expect(reason).not.toBeRequired();
    // Cambiar solo el nombre no lo pide.
    await user.type(screen.getByRole("textbox", { name: /Nombre visible/ }), " M.");
    expect(reason).not.toBeRequired();

    await user.click(screen.getByRole("checkbox", { name: "Hospital A" }));
    expect(reason).toBeRequired();
    expect(screen.getByText(/Obligatorio: cambian los permisos de la cuenta/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(actions.updateAccount.mock.calls.length).toBe(calls);

    // Volver a la selección original deja de pedirlo.
    await user.click(screen.getByRole("checkbox", { name: "Hospital A" }));
    expect(reason).not.toBeRequired();
    await user.click(screen.getByRole("button", { name: "Quitar todas" }));
    expect(reason).toBeRequired();
    await user.click(screen.getByRole("checkbox", { name: "Hospital A" }));

    await user.type(reason, "Reasignación de sede por cobertura");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Cambios guardados.")).toBeInTheDocument();
    const sent = lastCall(actions.updateAccount);
    expect(sent.getAll("facility_ids")).toEqual([F2]);
    expect(sent.get("reason")).toBe("Reasignación de sede por cobertura");
    expect(screen.getByRole("textbox", { name: /Motivo del cambio/ })).toHaveValue("");
  });

  it("pide motivo al vincular o desvincular un trabajador", async () => {
    const user = userEvent.setup();
    render(
      createElement(EditAccountForm, {
        userId: "a0000000-0000-4000-8000-000000000002",
        roleOptions,
        workerOptions: workers,
        facilityChoices: facilities,
        defaults: { display_name: "Ana", role: "trabajador", worker_id: null, facility_ids: [] },
      }),
    );
    const reason = screen.getByRole("textbox", { name: /Motivo del cambio/ });
    await user.selectOptions(screen.getByRole("combobox", { name: /Trabajador vinculado/ }), W1);
    expect(reason).toBeRequired();
    await user.selectOptions(screen.getByRole("combobox", { name: /Trabajador vinculado/ }), "");
    expect(reason).not.toBeRequired();
  });

  it("auditoría: oculta el trabajador vinculado, avisa que se quitará y no lo envía", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      createElement(EditAccountForm, {
        userId: "a0000000-0000-4000-8000-000000000003",
        roleOptions,
        workerOptions: workers,
        facilityChoices: facilities,
        defaults: { display_name: "Ana", role: "trabajador", worker_id: W1, facility_ids: [] },
      }),
    );
    expect(screen.getByRole("combobox", { name: /Trabajador vinculado/ })).toBeEnabled();
    await user.selectOptions(screen.getByRole("combobox", { name: /^Rol/ }), "auditor");
    expect(screen.getByText(/La auditoría es de solo lectura: no se vincula a un trabajador/)).toHaveTextContent(
      "Al guardar se quitará el vínculo con el trabajador actual.",
    );
    expect(screen.queryByRole("combobox", { name: /Trabajador vinculado/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "UMF 1" }));
    await user.type(screen.getByRole("textbox", { name: /Motivo del cambio/ }), "Pasa a auditoría interna");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Cambios guardados.")).toBeInTheDocument();
    const sent = lastCall(actions.updateAccount);
    expect(sent.get("role")).toBe("auditor");
    expect(sent.has("worker_id")).toBe(false);

    // Al volver a un rol que admite trabajador, se conserva la elección.
    await user.selectOptions(screen.getByRole("combobox", { name: /^Rol/ }), "coordinador");
    expect(screen.getByRole("combobox", { name: /Trabajador vinculado/ })).toHaveValue(W1);
  });
});

describe("CreateAccountForm", () => {
  it("auditoría no ofrece vincular un trabajador", async () => {
    const user = userEvent.setup();
    render(
      createElement(CreateAccountForm, {
        roleOptions,
        workerOptions: workers,
        facilityChoices: facilities,
        defaults: { email: "", display_name: "", role: "trabajador", worker_id: W1 },
      }),
    );
    expect(screen.getByRole("combobox", { name: /Trabajador vinculado/ })).toHaveValue(W1);
    await user.selectOptions(screen.getByRole("combobox", { name: /^Rol/ }), "auditor");
    expect(screen.queryByRole("combobox", { name: /Trabajador vinculado/ })).not.toBeInTheDocument();
    expect(screen.getByText(/no registra asistencia ni solicita correcciones/)).not.toHaveTextContent("Al guardar se quitará");
  });
});

describe("ResetPasswordForm", () => {
  it("exige el motivo, lo envía y limpia el formulario tras restablecer", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const calls = actions.resetAccountPassword.mock.calls.length;
    render(createElement(ResetPasswordForm, { userId: "a0000000-0000-4000-8000-000000000004", email: "ana@ejemplo.mx" }));
    const button = screen.getByRole("button", { name: "Restablecer contraseña temporal" });
    await user.click(button);
    expect(actions.resetAccountPassword.mock.calls.length).toBe(calls);
    await user.type(screen.getByRole("textbox", { name: /Motivo del restablecimiento/ }), "La titular olvidó su contraseña");
    await user.click(button);
    expect(await screen.findByText("Contraseña temporal restablecida.")).toBeInTheDocument();
    const sent = lastCall(actions.resetAccountPassword);
    expect(sent.get("reason")).toBe("La titular olvidó su contraseña");
    expect(screen.getByRole("textbox", { name: /Motivo del restablecimiento/ })).toHaveValue("");
  });
});

describe("Configuración", () => {
  it("aviso de privacidad: envía el motivo y lo vacía tras guardar sin tocar el texto", async () => {
    const user = userEvent.setup();
    render(
      createElement(PrivacyNoticeForm, {
        notice: { title: "Aviso", body: "Texto del aviso con suficiente longitud.", responsible: null, contact: null, legal_review_status: "pendiente" },
      }),
    );
    const calls = actions.savePrivacyNotice.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Guardar aviso" }));
    expect(actions.savePrivacyNotice.mock.calls.length).toBe(calls);
    await user.type(screen.getByRole("textbox", { name: /Motivo del cambio/ }), "Ajuste de contacto");
    await user.click(screen.getByRole("button", { name: "Guardar aviso" }));
    expect(await screen.findByText("Aviso guardado.")).toBeInTheDocument();
    expect(lastCall(actions.savePrivacyNotice).get("reason")).toBe("Ajuste de contacto");
    expect(screen.getByRole("textbox", { name: /Motivo del cambio/ })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /Título/ })).toHaveValue("Aviso");
  });

  it("registro de asistencia: el motivo es obligatorio", async () => {
    const user = userEvent.setup();
    render(createElement(AttendanceSettingsForm, { settings: { checkin_window_before_minutes: 120, open_session_grace_minutes: 240 } }));
    const reason = screen.getByRole("textbox", { name: /Motivo del cambio/ });
    expect(reason).toBeRequired();
    expect(reason).toHaveAttribute("minlength", "5");
    await user.type(reason, "Turnos nocturnos");
    await user.click(screen.getByRole("button", { name: "Guardar configuración de registro" }));
    expect(await screen.findByText("Configuración guardada.")).toBeInTheDocument();
    expect(lastCall(actions.saveAttendanceSettings).get("reason")).toBe("Turnos nocturnos");
  });
});

describe("Categorías", () => {
  const defaults = { name: "Guarderías", slug: "guarderias", description: "", icon: "baby", color: "#166534", sort_order: "100", active: true };

  it("al editar el motivo es obligatorio; en un alta es opcional", async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async () => ({ ok: false, message: "Revisa los campos marcados." }));
    render(createElement(CategoryForm, { action, categoryId: 4, defaults }));
    const reason = screen.getByRole("textbox", { name: /Motivo del cambio/ });
    expect(reason).toBeRequired();
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(action).not.toHaveBeenCalled();
    await user.type(reason, "Cambio de nombre oficial");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(lastCall(action).get("reason")).toBe("Cambio de nombre oficial");
    cleanup();

    render(createElement(CategoryForm, { action: vi.fn<Action>(), defaults }));
    expect(screen.getByRole("textbox", { name: /Motivo del cambio/ })).not.toBeRequired();
    expect(screen.getByText("Si lo dejas vacío se registra «Alta de categoría».")).toBeInTheDocument();
  });

  it("activar/desactivar y eliminar envían el motivo", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const toggle = vi.fn<Action>(async () => ({ ok: true, message: "Categoría «Guarderías» desactivada." }));
    render(createElement(CategoryActiveForm, { action: toggle, categoryId: 4, active: true, inUse: 0 }));
    await user.click(screen.getByRole("button", { name: "Desactivar categoría" }));
    expect(toggle).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: /Motivo de la desactivación/ }), "Ya no se usa");
    await user.click(screen.getByRole("button", { name: "Desactivar categoría" }));
    expect(await screen.findByText(/desactivada/)).toBeInTheDocument();
    expect(lastCall(toggle).get("reason")).toBe("Ya no se usa");
    expect(screen.getByRole("textbox", { name: /Motivo de la desactivación/ })).toHaveValue("");
    cleanup();

    const remove = vi.fn<Action>(async () => ({ ok: false, message: "No tienes permiso para realizar esta acción." }));
    render(createElement(CategoryDeleteForm, { action: remove, categoryId: 4 }));
    await user.type(screen.getByRole("textbox", { name: /ELIMINAR/ }), "ELIMINAR");
    await user.click(screen.getByRole("button", { name: "Eliminar categoría" }));
    expect(remove).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: /Motivo de la eliminación/ }), "Creada por error");
    await user.click(screen.getByRole("button", { name: "Eliminar categoría" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso");
    expect(lastCall(remove).get("reason")).toBe("Creada por error");
  });
});

describe("Bitácora: restablecimiento de contraseña", () => {
  const U = "a0000000-0000-4000-8000-000000000009";
  // Como lo registra public.log_password_reset (nunca guarda la contraseña).
  const event = {
    table_name: "auth.users",
    record_id: U,
    action: "UPDATE",
    changed_fields: ["password"],
    old_data: { user_id: U, password: "Contraseña anterior (no se guarda)" },
    new_data: { user_id: U, password: "Contraseña temporal nueva (no se guarda)" },
  };

  it("se muestra con nombre legible, la cuenta afectada y solo para administración", () => {
    expect(auditTableLabel("auth.users")).toBe("Contraseñas de cuentas de acceso");
    expect(auditTablesFor(true)).toContain("auth.users");
    expect(auditTablesFor(false)).not.toContain("auth.users");
    expect(auditSubject(event, { refs: { profile: { [U]: "Luis Coordinación" } } })).toBe("Luis Coordinación");
    expect(auditFieldChanges(event)).toEqual([
      { field: "password", label: "Contraseña", before: "Contraseña anterior (no se guarda)", after: "Contraseña temporal nueva (no se guarda)" },
    ]);
  });
});
