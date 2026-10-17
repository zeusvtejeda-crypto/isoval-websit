import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FacilityDetailData } from "@/lib/directory/queries";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  unstable_rethrow: () => {},
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicMapStub() {
      return <div data-testid="mapa" />;
    },
}));
const data = vi.hoisted(() => ({ current: null as FacilityDetailData | null }));
vi.mock("@/lib/directory/queries", () => ({ loadFacilityDetail: async () => data.current }));
// Sesión: null = visitante; "error" = la consulta de sesión falla.
const session = vi.hoisted(() => ({ current: null as null | "error" | { role: string; isAdmin: boolean } }));
vi.mock("@/lib/auth", () => ({
  getSessionUser: async () => {
    if (session.current === "error") throw new Error("Sin conexión con Auth");
    return session.current;
  },
}));

import FichaInstalacionPage from "@/app/directorio/[id]/page";

afterEach(() => {
  cleanup();
  session.current = null;
});

const ID = "d0000000-0000-4000-8000-000000000001";

function detail(overrides: Partial<FacilityDetailData["facility"]> = {}): FacilityDetailData {
  return {
    facility: {
      id: ID,
      internalCode: "INS-000001",
      name: "[DEMO] Hospital de demostración A",
      unitKey: "DEMO-H01",
      categoryId: 1,
      description: "Instalación ficticia",
      stateId: 18,
      municipalityId: 17,
      address: "Domicilio de demostración 100",
      latitude: 21.509,
      longitude: -104.889,
      phone: "311 000 0000",
      schedule: "Abierto 24 horas",
      services: [],
      servicesVerified: false,
      source: "Datos de demostración",
      sourceUrl: "https://example.org/fuente",
      lastVerifiedAt: null,
      verificationStatus: "pendiente",
      notes: "Sin observaciones reales",
      timezone: "America/Mazatlan",
      isDemo: true,
      updatedAt: "2026-10-17T05:00:00Z",
      ...overrides,
    },
    category: { id: 1, slug: "hospitales", name: "Hospitales", color: "#14532d", icon: "hospital", active: true },
    state: { id: 18, name: "Nayarit", abbreviation: "NAY" },
    municipality: { id: 17, stateId: 18, name: "Tepic", inegiCode: "017", label: "Tepic" },
  };
}

async function renderFicha() {
  const ui = await FichaInstalacionPage({ params: Promise.resolve({ id: ID }) });
  return render(ui);
}

describe("Ficha pública de instalación", () => {
  it("muestra todos los datos públicos, procedencia y «Cómo llegar»", async () => {
    data.current = detail();
    await renderFicha();

    expect(screen.getByRole("heading", { level: 1, name: "[DEMO] Hospital de demostración A" })).toBeInTheDocument();
    expect(screen.getByText(/Modo de demostración/)).toBeInTheDocument();
    expect(screen.getAllByText("Datos de demostración").length).toBeGreaterThan(0);
    expect(screen.getByText("INS-000001")).toBeInTheDocument();
    expect(screen.getByText("DEMO-H01")).toBeInTheDocument();
    expect(screen.getByText("21.509, -104.889")).toBeInTheDocument();
    expect(screen.getByText("Servicios no verificados")).toBeInTheDocument();
    expect(screen.getAllByText("Pendiente de verificación").length).toBeGreaterThan(0);
    expect(screen.getByText("Sin verificar")).toBeInTheDocument();
    // 2026-10-17T05:00Z en la zona de la sede (Mazatlán, UTC−7).
    expect(screen.getByText("16/10/2026 22:00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "311 000 0000" })).toHaveAttribute("href", "tel:3110000000");
    expect(screen.getByRole("link", { name: /Consultar fuente/ })).toHaveAttribute("href", "https://example.org/fuente");

    const directions = within(screen.getByRole("heading", { name: "Cómo llegar" }).closest("section")!);
    expect(directions.getByRole("link", { name: "Cómo llegar (Google Maps)" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=21.509,-104.889",
    );
    expect(directions.getByRole("link", { name: /app de mapas/ }).getAttribute("href")).toMatch(/^geo:21\.509,-104\.889/);
    expect(directions.getByRole("link", { name: "Ruta en OpenStreetMap" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/directions?to=21.509,-104.889",
    );
    expect(screen.getByTestId("mapa")).toBeInTheDocument();
  });

  it("servicios verificados, fecha de verificación y sin coordenadas", async () => {
    data.current = detail({
      services: ["Urgencias", "Consulta externa"],
      servicesVerified: true,
      verificationStatus: "verificado",
      lastVerifiedAt: "2026-10-01",
      latitude: null,
      longitude: null,
      isDemo: false,
      sourceUrl: "javascript:alert(1)",
    });
    await renderFicha();

    expect(screen.getByText("Urgencias")).toBeInTheDocument();
    expect(screen.getByText("Consulta externa")).toBeInTheDocument();
    expect(screen.queryByText("Servicios no verificados")).not.toBeInTheDocument();
    expect(screen.getAllByText("Verificado").length).toBeGreaterThan(0);
    expect(screen.getByText("1 de octubre de 2026")).toBeInTheDocument();
    expect(screen.getByText("Sin coordenadas (no aparece en el mapa)")).toBeInTheDocument();
    expect(screen.queryByText(/Modo de demostración/)).not.toBeInTheDocument();
    // Una URL no http(s) se muestra como texto, nunca como enlace.
    expect(screen.queryByRole("link", { name: /Consultar fuente/ })).not.toBeInTheDocument();
    // Sin coordenadas: indicaciones por dirección y sin mapa.
    expect(screen.getByRole("link", { name: "Cómo llegar (Google Maps)" }).getAttribute("href")).toContain(
      encodeURIComponent("Domicilio de demostración 100, Tepic, Nayarit, México"),
    );
    expect(screen.queryByTestId("mapa")).not.toBeInTheDocument();
  });

  it("muestra el ícono de la categoría en la etiqueta", async () => {
    data.current = detail();
    await renderFicha();
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(header.querySelector('svg[data-icon="hospital"]')).not.toBeNull();
    expect(within(header).getByText("Hospitales")).toBeInTheDocument();
  });

  it("distingue con la clave INEGI un municipio de nombre repetido", async () => {
    data.current = {
      ...detail(),
      state: { id: 20, name: "Oaxaca", abbreviation: "OAX" },
      municipality: { id: 900, stateId: 20, name: "San Juan Mixtepec", inegiCode: "208", label: "San Juan Mixtepec (clave INEGI 208)" },
    };
    await renderFicha();
    expect(screen.getByText("San Juan Mixtepec (clave INEGI 208)")).toBeInTheDocument();
  });

  it("muestra «Editar instalación» solo con sesión de administración", async () => {
    data.current = detail();
    session.current = { role: "admin", isAdmin: true };
    await renderFicha();
    expect(screen.getByRole("link", { name: "Editar instalación" })).toHaveAttribute(
      "href",
      `/administracion/instalaciones/${ID}/editar`,
    );
    cleanup();

    for (const value of [null, { role: "coordinador", isAdmin: false }, { role: "auditor", isAdmin: false }, "error"] as const) {
      session.current = value;
      await renderFicha();
      expect(screen.queryByRole("link", { name: "Editar instalación" })).not.toBeInTheDocument();
      // La ficha pública se muestra igual aunque falle la consulta de sesión.
      expect(screen.getByRole("heading", { level: 1, name: "[DEMO] Hospital de demostración A" })).toBeInTheDocument();
      cleanup();
    }
  });

  it("responde «no encontrado» si la instalación no es pública", async () => {
    data.current = null;
    await expect(FichaInstalacionPage({ params: Promise.resolve({ id: ID }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("Varias URLs de fuente", () => {
  it("separa «url1 | url2» en enlaces individuales y descarta las inválidas", async () => {
    const { safeExternalUrls } = await import("@/lib/directory/format");
    expect(safeExternalUrls("https://a.gob.mx/x.xlsx | https://www.imss.gob.mx/directorio?x=1 | javascript:alert(1)")).toEqual([
      "https://a.gob.mx/x.xlsx",
      "https://www.imss.gob.mx/directorio?x=1",
    ]);
  });
});
