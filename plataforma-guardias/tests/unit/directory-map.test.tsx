import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import FacilityMap from "@/components/directory/facility-map";
import type { CategoryOption, DirectoryFacility } from "@/lib/directory/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

afterEach(() => cleanup());

// jsdom no calcula tamaños: se simula un contenedor de 800×600 para Leaflet.
const sizes = { clientWidth: 800, clientHeight: 600 };
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
  for (const [key, value] of Object.entries(sizes)) {
    originals.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  }
});
afterAll(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
});

const categories: CategoryOption[] = [{ id: 1, slug: "hospitales", name: "Hospitales", color: "#14532d", active: true }];

function facility(id: string, name: string, lat: number | null, lng: number | null): DirectoryFacility {
  return {
    id,
    internalCode: "INS-1",
    name,
    unitKey: null,
    categoryId: 1,
    stateId: 18,
    municipalityId: 117,
    address: null,
    latitude: lat,
    longitude: lng,
    verified: false,
    isDemo: false,
  };
}

describe("FacilityMap (Leaflet)", () => {
  it("crea el mapa con atribución de OpenStreetMap y marcadores con título accesible", async () => {
    const onReady = vi.fn();
    const { container } = render(
      <FacilityMap
        facilities={[
          facility("d0000000-0000-4000-8000-000000000001", "Hospital <A>", 21.5, -104.9),
          facility("d0000000-0000-4000-8000-000000000002", "Sin coordenadas", null, null),
        ]}
        categories={categories}
        label="Mapa de prueba"
        onReady={onReady}
      />,
    );
    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(container.querySelector(".leaflet-container")).not.toBeNull();
    expect(container.querySelector(".leaflet-control-attribution")?.textContent).toMatch(/OpenStreetMap/);
    await waitFor(() => expect(container.querySelector(".dir-marker")).not.toBeNull());
    const marker = container.querySelector(".dir-marker");
    expect(marker).toHaveAttribute("title", "Hospital <A> (Hospitales)");
    expect(marker).toHaveAttribute("role", "button");
    expect(marker?.querySelector("svg title")?.textContent).toBe("Hospital <A> (Hospitales)");
    expect(container.querySelectorAll(".dir-marker")).toHaveLength(1);
    // Controles de Leaflet en español.
    expect(container.querySelector(".leaflet-control-zoom-in")).toHaveAttribute("aria-label", "Acercar");
    expect(container.querySelector(".leaflet-control-zoom-out")).toHaveAttribute("aria-label", "Alejar");
    expect(container.textContent).not.toMatch(/Zoom in|Zoom out/);
  });

  it("abre una ventana emergente con ficha y «Cómo llegar»", async () => {
    push.mockClear();
    const { container } = render(
      <FacilityMap
        facilities={[facility("d0000000-0000-4000-8000-000000000001", "Hospital A", 21.5, -104.9)]}
        categories={categories}
        label="Mapa"
      />,
    );
    await waitFor(() => expect(container.querySelector(".dir-marker")).not.toBeNull());
    fireEvent.click(container.querySelector(".dir-marker")!);
    await waitFor(() => expect(container.querySelector(".dir-popup")).not.toBeNull());
    const popup = container.querySelector(".dir-popup")!;
    expect(container.querySelector(".leaflet-popup-close-button")).toHaveAttribute("aria-label", "Cerrar ventana");
    expect(popup.querySelector(".dir-popup-title")?.textContent).toBe("Hospital A");
    expect(popup.textContent).toContain("Hospitales");
    const directions = Array.from(popup.querySelectorAll("a")).find((a) => a.textContent === "Cómo llegar");
    expect(directions?.getAttribute("href")).toBe("https://www.google.com/maps/dir/?api=1&destination=21.5,-104.9");
    expect(directions?.getAttribute("rel")).toBe("noopener noreferrer");
    const detail = Array.from(popup.querySelectorAll("a")).find((a) => a.textContent === "Ver ficha")!;
    expect(detail.getAttribute("href")).toBe("/directorio/d0000000-0000-4000-8000-000000000001");
    fireEvent.click(detail);
    expect(push).toHaveBeenCalledWith("/directorio/d0000000-0000-4000-8000-000000000001");
  });

  it("agrupa marcadores cercanos", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      facility(`d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `Unidad ${i}`, 21.5 + i * 0.0001, -104.9),
    );
    const far = facility("d0000000-0000-4000-8000-999999999999", "Lejana", 22.5, -105.5);
    const { container } = render(<FacilityMap facilities={[...many, far]} categories={categories} label="Mapa" maxFitZoom={8} />);
    await waitFor(() => expect(container.querySelector(".dir-cluster")).not.toBeNull());
    expect(container.querySelector(".dir-cluster")?.textContent).toContain("30");
  });

  it("avisa si las teselas no cargan y lo retira cuando vuelven", async () => {
    const { container, findByText, queryByText } = render(
      <FacilityMap facilities={[facility("a", "Hospital A", 21.5, -104.9)]} categories={categories} label="Mapa" />,
    );
    await waitFor(() => expect(container.querySelectorAll("img.leaflet-tile").length).toBeGreaterThanOrEqual(4));
    const tiles = Array.from(container.querySelectorAll("img.leaflet-tile"));
    tiles.slice(0, 4).forEach((img) => fireEvent.error(img));
    expect(await findByText(/No se pudieron cargar las imágenes del mapa/)).toBeInTheDocument();
    fireEvent.load(tiles[4] ?? tiles[0]);
    await waitFor(() => expect(queryByText(/No se pudieron cargar las imágenes del mapa/)).not.toBeInTheDocument());
  });

  it("avisa cuando ningún resultado tiene coordenadas", () => {
    const { getByText } = render(
      <FacilityMap facilities={[facility("x", "Sin coordenadas", null, null)]} categories={categories} label="Mapa" />,
    );
    expect(getByText(/Ninguna de las instalaciones encontradas tiene coordenadas/)).toBeInTheDocument();
  });
});
