import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FacilityList } from "@/components/directory/facility-list";
import { DirectoryExplorer } from "@/components/directory/directory-explorer";
import { buildLookupMaps } from "@/lib/directory/search";
import { parseDirectoryParams } from "@/lib/directory/params";
import type { DirectoryFacility, DirectoryLookups } from "@/lib/directory/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// URL del enrutador de Next (useSearchParams). null = sin enrutador (se usan los
// parámetros que entrega el servidor).
const routerMock = vi.hoisted(() => ({ search: null as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => (routerMock.search === null ? null : new URLSearchParams(routerMock.search)),
}));

// El mapa real (Leaflet) nunca se carga en estas pruebas: next/dynamic devuelve
// un sustituto que puede fallar a voluntad para probar el límite de error.
const mapMock = vi.hoisted(() => ({ mode: "stub" as "stub" | "throw" }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicMapStub(props: { facilities: unknown[] }) {
      if (mapMock.mode === "throw") throw new Error("No se pudo descargar el módulo del mapa");
      return <div data-testid="mapa">{props.facilities.length} marcadores</div>;
    },
}));

const LOOKUPS: DirectoryLookups = {
  categories: [
    { id: 1, slug: "hospitales", name: "Hospitales", color: "#14532d", icon: "hospital", active: true },
    { id: 2, slug: "umf", name: "Unidades de Medicina Familiar", color: "#166534", icon: "stethoscope", active: true },
  ],
  states: [{ id: 18, name: "Nayarit", abbreviation: "NAY" }],
  municipalities: [
    { id: 117, stateId: 18, name: "Tepic", inegiCode: "017", label: "Tepic" },
    { id: 120, stateId: 18, name: "Bahía de Banderas", inegiCode: "020", label: "Bahía de Banderas" },
  ],
};

const FACILITIES: DirectoryFacility[] = [
  {
    id: "d0000000-0000-4000-8000-000000000001",
    internalCode: "INS-000001",
    name: "[DEMO] Hospital de demostración A",
    unitKey: "DEMO-H01",
    categoryId: 1,
    stateId: 18,
    municipalityId: 117,
    address: "Domicilio de demostración 100",
    latitude: 21.509,
    longitude: -104.889,
    verified: false,
    isDemo: true,
  },
  {
    id: "d0000000-0000-4000-8000-000000000002",
    internalCode: "INS-000002",
    name: "Unidad de Medicina Familiar Bahía",
    unitKey: "UMF-02",
    categoryId: 2,
    stateId: 18,
    municipalityId: 120,
    address: null,
    latitude: 20.8,
    longitude: -105.25,
    verified: true,
    isDemo: false,
  },
  {
    id: "d0000000-0000-4000-8000-000000000003",
    internalCode: "INS-000003",
    name: "Instalación sin coordenadas",
    unitKey: null,
    categoryId: 2,
    stateId: 18,
    municipalityId: 117,
    address: "Calle Sin Número, Tepic",
    latitude: null,
    longitude: null,
    verified: false,
    isDemo: false,
  },
];

const maps = buildLookupMaps(LOOKUPS);

beforeEach(() => {
  mapMock.mode = "stub";
  routerMock.search = null;
  window.history.replaceState(null, "", "/directorio");
});
afterEach(() => cleanup());

describe("FacilityList", () => {
  it("renderiza las instalaciones sin el mapa", () => {
    const { container } = render(<FacilityList facilities={FACILITIES} maps={maps} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);

    const first = within(items[0]);
    expect(first.getByRole("heading", { name: "[DEMO] Hospital de demostración A" })).toBeInTheDocument();
    expect(first.getByText("DEMO-H01")).toBeInTheDocument();
    expect(first.getByText("Tepic, Nayarit")).toBeInTheDocument();
    expect(first.getByText("Hospitales")).toBeInTheDocument();
    // La etiqueta de categoría lleva el ícono de la categoría.
    expect(items[0].querySelector('svg[data-icon="hospital"]')).not.toBeNull();
    expect(items[1].querySelector('svg[data-icon="stethoscope"]')).not.toBeNull();
    expect(first.getByText("Pendiente de verificación")).toBeInTheDocument();
    expect(first.getByText("Datos de demostración")).toBeInTheDocument();
    expect(first.getByRole("link", { name: "Ver ficha de [DEMO] Hospital de demostración A" })).toHaveAttribute(
      "href",
      "/directorio/d0000000-0000-4000-8000-000000000001",
    );
    expect(first.getByRole("link", { name: /Cómo llegar a \[DEMO\] Hospital/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=21.509,-104.889",
    );

    expect(within(items[1]).getByText("Verificado")).toBeInTheDocument();

    const third = within(items[2]);
    expect(third.getByText("Sin coordenadas")).toBeInTheDocument();
    expect(third.getByRole("link", { name: /Cómo llegar/ }).getAttribute("href")).toContain(
      encodeURIComponent("Calle Sin Número, Tepic, Nayarit, México"),
    );

    // Sin callback no hay botón «Ver en el mapa» y no existe ningún mapa.
    expect(screen.queryByRole("button", { name: /en el mapa/ })).not.toBeInTheDocument();
    expect(container.querySelector(".leaflet-container")).toBeNull();
  });

  it("nunca muestra trabajadores, teléfonos personales ni guardias", () => {
    render(<FacilityList facilities={FACILITIES} maps={maps} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/trabajador|guardia|tel[eé]fono/i);
  });
});

describe("DirectoryExplorer", () => {
  it("muestra la lista sin cargar el mapa en la vista de lista", () => {
    render(<DirectoryExplorer facilities={FACILITIES} lookups={LOOKUPS} initialParams={parseDirectoryParams({})} />);
    expect(screen.getByText("3 instalaciones en el directorio")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Instalaciones" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByTestId("mapa")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Lista/ })).toHaveAttribute("aria-selected", "true");
    // Hay filas de demostración visibles: se muestra la franja.
    expect(screen.getByText(/Modo de demostración/)).toBeInTheDocument();
  });

  it("aplica los filtros de la URL desde el servidor", () => {
    window.history.replaceState(null, "", "/directorio?q=bahia");
    render(
      <DirectoryExplorer facilities={FACILITIES} lookups={LOOKUPS} initialParams={parseDirectoryParams({ q: "bahia" })} />,
    );
    expect(screen.getByText("1 instalación encontrada")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unidad de Medicina Familiar Bahía" })).toBeInTheDocument();
    expect(screen.queryByText(/Modo de demostración/)).not.toBeInTheDocument();
  });

  it("filtra al instante y guarda los filtros en la URL", async () => {
    const user = userEvent.setup();
    render(<DirectoryExplorer facilities={FACILITIES} lookups={LOOKUPS} initialParams={parseDirectoryParams({})} />);

    await user.type(screen.getByRole("searchbox", { name: "Buscar" }), "demo-h01");
    expect(await screen.findByText("1 instalación encontrada")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "[DEMO] Hospital de demostración A" })).toBeInTheDocument();
    expect(window.location.search).toBe("?q=demo-h01");

    await user.clear(screen.getByRole("searchbox", { name: "Buscar" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Municipio" }), "117");
    expect(await screen.findByText("2 instalaciones encontradas")).toBeInTheDocument();
    // Al elegir municipio se fija su estado.
    expect(screen.getByRole("combobox", { name: "Estado" })).toHaveValue("18");
    expect(window.location.search).toBe("?estado=18&municipio=117");
    expect(screen.getByText("1 no tiene coordenadas y aparece solo en la lista.")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Buscar" }), "zzz");
    expect(await screen.findByText("No encontramos instalaciones")).toBeInTheDocument();
    await user.click(screen.getAllByRole("link", { name: "Quitar filtros" })[0]);
    expect(await screen.findByText("3 instalaciones en el directorio")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("muestra la leyenda del mapa con ícono y nombre de las categorías ubicables", () => {
    render(<DirectoryExplorer facilities={FACILITIES} lookups={LOOKUPS} initialParams={parseDirectoryParams({})} />);
    const legend = screen.getByRole("list", { name: /Leyenda del mapa/ });
    const items = within(legend).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Hospitales", "Unidades de Medicina Familiar"]);
    expect(items[0].querySelector('svg[data-icon="hospital"]')).not.toBeNull();
    expect(items[1].querySelector('svg[data-icon="stethoscope"]')).not.toBeNull();
  });

  it("una categoría inactiva que aún usa una instalación pública se puede elegir en el filtro", async () => {
    const user = userEvent.setup();
    // Así llegan de loadDirectoryData: activas más las inactivas en uso.
    const lookups: DirectoryLookups = {
      ...LOOKUPS,
      categories: [...LOOKUPS.categories, { id: 9, slug: "archivo-historico", name: "Archivo histórico", color: "#6b7280", icon: "building", active: false }],
    };
    const facilities = FACILITIES.map((f, i) => (i === 2 ? { ...f, categoryId: 9 } : f));
    render(<DirectoryExplorer facilities={facilities} lookups={lookups} initialParams={parseDirectoryParams({})} />);
    const select = screen.getByRole("combobox", { name: "Categoría" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todas las categorías",
      "Hospitales",
      "Unidades de Medicina Familiar",
      "Archivo histórico",
    ]);
    await user.selectOptions(select, "archivo-historico");
    expect(await screen.findByText("1 instalación encontrada")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Instalación sin coordenadas" })).toBeInTheDocument();
    expect(window.location.search).toBe("?categoria=archivo-historico");
  });

  it("distingue con la clave INEGI los municipios de nombre repetido en el filtro", () => {
    const lookups: DirectoryLookups = {
      ...LOOKUPS,
      states: [{ id: 20, name: "Oaxaca", abbreviation: "OAX" }],
      municipalities: [
        { id: 901, stateId: 20, name: "San Juan Mixtepec", inegiCode: "208", label: "San Juan Mixtepec (clave INEGI 208)" },
        { id: 902, stateId: 20, name: "San Juan Mixtepec", inegiCode: "209", label: "San Juan Mixtepec (clave INEGI 209)" },
      ],
    };
    const facilities = FACILITIES.slice(0, 2).map((f, i) => ({ ...f, stateId: 20, municipalityId: 901 + i }));
    render(<DirectoryExplorer facilities={facilities} lookups={lookups} initialParams={parseDirectoryParams({})} />);
    const select = screen.getByRole("combobox", { name: "Municipio" });
    expect(within(select).getByRole("option", { name: "San Juan Mixtepec (clave INEGI 208)" })).toHaveValue("901");
    expect(within(select).getByRole("option", { name: "San Juan Mixtepec (clave INEGI 209)" })).toHaveValue("902");
    expect(screen.getByText("San Juan Mixtepec (clave INEGI 209), Oaxaca")).toBeInTheDocument();
  });

  it("si el mapa falla muestra un aviso y la lista sigue funcionando", async () => {
    mapMock.mode = "throw";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    window.history.replaceState(null, "", "/directorio?vista=mapa");
    render(
      <DirectoryExplorer facilities={FACILITIES} lookups={LOOKUPS} initialParams={parseDirectoryParams({ vista: "mapa" })} />,
    );
    expect(await screen.findByText("No se pudo cargar el mapa")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Instalaciones" })).getAllByRole("listitem")).toHaveLength(3);

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Lista/ }));
    expect(screen.getByRole("tab", { name: /Lista/ })).toHaveAttribute("aria-selected", "true");
    // Con el mapa caído ya no se ofrece «Ver en el mapa».
    expect(screen.queryByRole("button", { name: /en el mapa/ })).not.toBeInTheDocument();

    // «Reintentar» vuelve a montar el mapa y, si carga, se ofrece de nuevo «Ver en el mapa».
    mapMock.mode = "stub";
    await user.click(screen.getByRole("tab", { name: "Mapa" }));
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("mapa")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Lista/ }));
    expect(screen.getAllByRole("button", { name: /^Ver en el mapa: / })).toHaveLength(2);
    spy.mockRestore();
  });

  it("toma los filtros de la URL del enrutador (p. ej. al volver con «Atrás»)", () => {
    // El servidor entregó la página sin filtros, pero la URL ya tiene los
    // filtros que el usuario escribió (history.replaceState) antes de salir.
    routerMock.search = "q=bahia&vista=mapa";
    render(<DirectoryExplorer facilities={FACILITIES} lookups={LOOKUPS} initialParams={parseDirectoryParams({})} />);
    expect(screen.getByRole("searchbox", { name: "Buscar" })).toHaveValue("bahia");
    expect(screen.getByText("1 instalación encontrada")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Mapa" })).toHaveAttribute("aria-selected", "true");
  });

  it("pestañas accesibles: foco itinerante y cambio con flechas", async () => {
    const user = userEvent.setup();
    render(<DirectoryExplorer facilities={FACILITIES} lookups={LOOKUPS} initialParams={parseDirectoryParams({})} />);
    const lista = screen.getByRole("tab", { name: /Lista/ });
    const mapa = screen.getByRole("tab", { name: "Mapa" });
    expect(lista).toHaveAttribute("tabindex", "0");
    expect(mapa).toHaveAttribute("tabindex", "-1");
    // Sin JavaScript las pestañas son enlaces que conservan los filtros.
    expect(mapa).toHaveAttribute("href", "/directorio?vista=mapa");

    lista.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Mapa" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Mapa" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Mapa" })).toHaveAttribute("tabindex", "0");
    expect(window.location.search).toBe("?vista=mapa");
  });

  it("«Ver en el mapa» abre la pestaña del mapa con los resultados", async () => {
    const user = userEvent.setup();
    render(<DirectoryExplorer facilities={FACILITIES} lookups={LOOKUPS} initialParams={parseDirectoryParams({})} />);
    await user.click(screen.getByRole("button", { name: "Ver en el mapa: Unidad de Medicina Familiar Bahía" }));
    expect(screen.getByRole("tab", { name: "Mapa" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("mapa")).toHaveTextContent("3 marcadores");
    expect(window.location.search).toBe("?vista=mapa");
  });
});
