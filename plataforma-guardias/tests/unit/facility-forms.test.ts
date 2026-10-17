import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActionResult } from "@/lib/actions";
import { EMPTY_CATEGORY_FORM, OFFICIAL_SOURCES_NOTICE } from "@/lib/validation/facility";
import { FacilityForm, type FacilityFormDefaults } from "@/app/(app)/administracion/instalaciones/_components/facility-form";
import { CategoryForm } from "@/app/(app)/administracion/categorias/_components/category-form";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

afterEach(() => cleanup());

const defaults: FacilityFormDefaults = {
  official_name: "",
  unit_key: "",
  category_id: "",
  description: "",
  state_id: "18",
  municipality_id: "",
  address: "",
  latitude: "",
  longitude: "",
  phone: "",
  schedule: "",
  services: "",
  services_verified: false,
  source: "",
  source_url: "",
  last_verified_at: "",
  verification_status: "pendiente",
  notes: "",
  timezone: "America/Mazatlan",
  arrival_tolerance_minutes: "10",
  is_public: true,
  active: true,
  is_demo: false,
};

const states = [
  { id: 14, name: "Jalisco", enabled: false, default_timezone: "America/Mexico_City" },
  { id: 18, name: "Nayarit", enabled: true, default_timezone: "America/Mazatlan" },
];
const municipalities = [
  { id: 17, state_id: 18, name: "Tepic", timezone: null },
  { id: 20, state_id: 18, name: "Bahía de Banderas", timezone: "America/Bahia_Banderas" },
  { id: 100, state_id: 14, name: "Guadalajara", timezone: null },
];
const categories = [
  { id: 1, name: "Hospitales", active: true },
  { id: 9, name: "Archivo", active: false },
];

function renderFacilityForm(overrides: Partial<FacilityFormDefaults> = {}) {
  const action = vi.fn(async (): Promise<ActionResult<{ id: string }>> => ({ ok: true }));
  render(
    createElement(FacilityForm, {
      action,
      defaults: { ...defaults, ...overrides },
      categories,
      states,
      municipalities,
      today: "2026-10-17",
      cancelHref: "/administracion/instalaciones",
    }),
  );
  return action;
}

describe("FacilityForm", () => {
  it("muestra el aviso de fuentes oficiales y crea sin marca de demostración", () => {
    renderFacilityForm();
    expect(screen.getByText(OFFICIAL_SOURCES_NOTICE)).toBeInTheDocument();
    expect(screen.getByLabelText("Marcar como datos de demostración")).not.toBeChecked();
    expect(screen.getByLabelText("Visible en el directorio público")).toBeChecked();
    expect(screen.getByRole("option", { name: "Archivo (inactiva)" })).toBeDisabled();
  });

  it("la zona horaria sigue al municipio y al estado", async () => {
    const user = userEvent.setup();
    renderFacilityForm();
    const tz = screen.getByLabelText(/Zona horaria/) as HTMLSelectElement;
    const municipality = screen.getByLabelText(/Municipio/);
    expect(tz.value).toBe("America/Mazatlan");

    await user.selectOptions(municipality, "20");
    expect(tz.value).toBe("America/Bahia_Banderas");
    await user.selectOptions(municipality, "17");
    expect(tz.value).toBe("America/Mazatlan");
    await user.selectOptions(screen.getByLabelText(/Estado \(entidad federativa\)/), "14");
    expect(tz.value).toBe("America/Mexico_City");
  });

  it("una zona elegida a mano ya no cambia sola y se puede restablecer", async () => {
    const user = userEvent.setup();
    renderFacilityForm();
    const tz = screen.getByLabelText(/Zona horaria/) as HTMLSelectElement;
    await user.selectOptions(tz, "America/Mexico_City");
    await user.selectOptions(screen.getByLabelText(/Municipio/), "20");
    expect(tz.value).toBe("America/Mexico_City");
    await user.click(screen.getByRole("button", { name: /Usar la zona de la ubicación/ }));
    expect(tz.value).toBe("America/Bahia_Banderas");
  });

  it("verificada exige fecha y las coordenadas fuera de México se señalan", async () => {
    const user = userEvent.setup();
    renderFacilityForm();
    const date = screen.getByLabelText(/Fecha de última verificación/);
    expect(date).not.toBeRequired();
    await user.selectOptions(screen.getByLabelText(/Estado de verificación/), "verificado");
    expect(date).toBeRequired();
    expect(date).toHaveAttribute("max", "2026-10-17");

    await user.type(screen.getByLabelText(/^Latitud/), "45");
    await user.type(screen.getByLabelText(/^Longitud/), "-100");
    expect(screen.getByText(/La latitud debe estar dentro de México/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Latitud/));
    await user.type(screen.getByLabelText(/^Latitud/), "21.5");
    expect(screen.getByRole("link", { name: /Revisar el punto en OpenStreetMap/ })).toHaveAttribute("href", expect.stringContaining("mlat=21.500000"));
  });

  it("al editar exige el motivo del cambio", () => {
    const action = vi.fn(async (): Promise<ActionResult<{ id: string }>> => ({ ok: true }));
    render(
      createElement(FacilityForm, {
        action,
        facilityId: "f0000000-0000-4000-8000-00000000000a",
        defaults: { ...defaults, official_name: "Hospital", category_id: "9", source: "Portal" },
        categories,
        states,
        municipalities,
        today: "2026-10-17",
        cancelHref: "/administracion/instalaciones",
      }),
    );
    expect(screen.getByLabelText(/Motivo del cambio/)).toBeRequired();
    // La categoría inactiva actual sigue disponible al editar.
    expect(screen.getByRole("option", { name: "Archivo (inactiva)" })).not.toBeDisabled();
  });
});

describe("CategoryForm", () => {
  it("sugiere el identificador a partir del nombre y muestra la vista previa", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));
    render(createElement(CategoryForm, { action, defaults: EMPTY_CATEGORY_FORM }));
    await user.type(screen.getByLabelText(/^Nombre/), "Guarderías infantiles");
    expect(screen.getByText(/Si lo dejas vacío se usará «guarderias-infantiles»/)).toBeInTheDocument();
    expect(screen.getAllByText("Guarderías infantiles").length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^Color/)).toHaveAttribute("type", "color");
  });
});
