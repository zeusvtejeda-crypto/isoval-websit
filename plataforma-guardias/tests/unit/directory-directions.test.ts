import { describe, expect, it } from "vitest";
import { buildDirectionsLinks, directionsQuery, formatCoordinate, formatCoordinates } from "@/lib/directory/directions";
import { escapeHtml, formatDateOnly, markerSvg, safeExternalUrl, safeHexColor, telHref } from "@/lib/directory/format";
import { isUuid, toDirectoryFacility, toPublicFacilityDetail } from "@/lib/directory/mappers";
import { OSM_ATTRIBUTION, ensureOsmAttribution, mapViewConfig } from "@/lib/directory/map-config";

describe("buildDirectionsLinks", () => {
  it("usa coordenadas cuando existen", () => {
    const links = buildDirectionsLinks({ latitude: 21.509, longitude: -104.889, name: "Hospital A", address: "Calle 1" });
    expect(links).not.toBeNull();
    expect(links!.byCoordinates).toBe(true);
    expect(links!.google).toBe("https://www.google.com/maps/dir/?api=1&destination=21.509,-104.889");
    expect(links!.geo.startsWith("geo:21.509,-104.889")).toBe(true);
    expect(links!.geo).toBe("geo:21.509,-104.889?q=21.509,-104.889(Hospital%20A)");
    expect(links!.openStreetMap).toBe("https://www.openstreetmap.org/directions?to=21.509,-104.889");
  });

  it("recorta a 6 decimales sin ceros sobrantes", () => {
    const links = buildDirectionsLinks({ latitude: 21.50900049, longitude: -104.8, name: null });
    expect(links!.google).toBe("https://www.google.com/maps/dir/?api=1&destination=21.509,-104.8");
    expect(links!.geo).toBe("geo:21.509,-104.8");
    expect(formatCoordinate(20.1234567)).toBe("20.123457");
    expect(formatCoordinates(21.5, -105)).toBe("21.5, -105");
  });

  it("sin coordenadas busca por dirección, municipio y estado", () => {
    const links = buildDirectionsLinks({
      latitude: null,
      longitude: null,
      name: "Unidad 1",
      address: "Av. México #10",
      municipality: "Tepic",
      state: "Nayarit",
    });
    const q = encodeURIComponent("Av. México #10, Tepic, Nayarit, México");
    expect(links).toEqual({
      byCoordinates: false,
      google: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
      geo: `geo:0,0?q=${q}`,
      openStreetMap: `https://www.openstreetmap.org/search?query=${q}`,
    });
  });

  it("sin dirección usa el nombre; sin datos devuelve null", () => {
    expect(directionsQuery({ latitude: null, longitude: null, name: "Clínica Norte", municipality: "Tepic" })).toBe(
      "Clínica Norte, Tepic, México",
    );
    // No repite el municipio si ya viene en la dirección.
    expect(directionsQuery({ latitude: null, longitude: null, address: "Centro, Tepic", municipality: "Tepic", state: "Nayarit" })).toBe(
      "Centro, Tepic, Nayarit, México",
    );
    expect(buildDirectionsLinks({ latitude: null, longitude: null, name: "  " })).toBeNull();
  });

  it("ignora coordenadas fuera de rango", () => {
    const links = buildDirectionsLinks({ latitude: 200, longitude: -104.9, address: "Calle 5" });
    expect(links!.byCoordinates).toBe(false);
    expect(links!.google).toContain(encodeURIComponent("Calle 5"));
  });
});

describe("formatos y seguridad", () => {
  it("formatea fechas sin hora sin recorrer el día", () => {
    expect(formatDateOnly("2026-10-17")).toBe("17 de octubre de 2026");
    expect(formatDateOnly("2026-01-01")).toBe("1 de enero de 2026");
    expect(formatDateOnly("17/10/2026")).toBeNull();
    expect(formatDateOnly(null)).toBeNull();
  });

  it("solo acepta enlaces http(s)", () => {
    expect(safeExternalUrl("https://datos.gob.mx/x?y=1")).toBe("https://datos.gob.mx/x?y=1");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,hola")).toBeNull();
    expect(safeExternalUrl("no es url")).toBeNull();
  });

  it("arma enlaces tel: solo con dígitos", () => {
    expect(telHref("(311) 123-4567")).toBe("tel:3111234567");
    expect(telHref("+52 311 123 4567")).toBe("tel:+523111234567");
    expect(telHref("ext. 12")).toBeNull();
  });

  it("escapa texto y color del marcador", () => {
    expect(escapeHtml(`<b>"A" & 'B'</b>`)).toBe("&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;");
    const svg = markerSvg('red" onload="x', "Clínica <script>");
    expect(svg).toContain('fill="#166534"');
    expect(svg).toContain("<title>Clínica &lt;script&gt;</title>");
    expect(svg).not.toContain("<script>");
    expect(markerSvg("#14532D", "A")).toContain('fill="#14532D"');
    expect(safeHexColor("#abc")).toBe("#166534");
  });
});

describe("conversión de filas de public_facilities", () => {
  const base = {
    id: "d0000000-0000-4000-8000-000000000001",
    internal_code: "INS-000001",
    official_name: " [DEMO] Hospital A ",
    unit_key: "",
    latitude: 21.5,
    longitude: -104.9,
    services: ["Urgencias"],
    services_verified: false,
    source: "Fuente",
    verification_status: "pendiente" as const,
    is_demo: true,
  };

  it("oculta servicios no verificados y limpia textos", () => {
    const d = toPublicFacilityDetail(base)!;
    expect(d.name).toBe("[DEMO] Hospital A");
    expect(d.unitKey).toBeNull();
    expect(d.services).toEqual([]);
    expect(d.servicesVerified).toBe(false);
    expect(d.isDemo).toBe(true);
    expect(toPublicFacilityDetail({ ...base, services_verified: true })!.services).toEqual(["Urgencias"]);
  });

  it("exige latitud y longitud juntas y descarta filas incompletas", () => {
    expect(toPublicFacilityDetail({ ...base, longitude: null })!.latitude).toBeNull();
    expect(toPublicFacilityDetail({ ...base, id: null })).toBeNull();
    expect(toPublicFacilityDetail({ ...base, official_name: "  " })).toBeNull();
    expect(toDirectoryFacility({ ...base, verification_status: "verificado" })).toMatchObject({ verified: true, latitude: 21.5 });
  });

  it("valida identificadores", () => {
    expect(isUuid(base.id)).toBe(true);
    expect(isUuid("1 or 1=1")).toBe(false);
  });
});

describe("configuración del mapa", () => {
  it("siempre conserva la atribución de OpenStreetMap", () => {
    expect(ensureOsmAttribution(undefined)).toBe(OSM_ATTRIBUTION);
    expect(ensureOsmAttribution("  ")).toBe(OSM_ATTRIBUTION);
    expect(ensureOsmAttribution("© Colaboradores de OpenStreetMap, © Proveedor")).toBe("© Colaboradores de OpenStreetMap, © Proveedor");
    expect(ensureOsmAttribution("© Proveedor de teselas")).toBe(`© Proveedor de teselas | ${OSM_ATTRIBUTION}`);
  });

  it("usa valores seguros si el centro o el zoom son inválidos", () => {
    const cfg = mapViewConfig({ tileUrl: "", attribution: "", centerLat: Number.NaN, centerLng: 500, zoom: 40 });
    expect(cfg).toEqual({
      tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: OSM_ATTRIBUTION,
      center: [23.6, -102.5],
      zoom: 5,
    });
    expect(mapViewConfig({ tileUrl: "https://t/{z}/{x}/{y}.png", attribution: "OSM OpenStreetMap", centerLat: 21.75, centerLng: -104.85, zoom: 8 })).toMatchObject({
      center: [21.75, -104.85],
      zoom: 8,
    });
  });
});
