import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CATEGORY_ICONS } from "@/lib/validation/facility";
import {
  CATEGORY_ICON_NAMES,
  CATEGORY_ICON_PATHS,
  DEFAULT_CATEGORY_ICON,
  INK_DARK,
  INK_LIGHT,
  categoryIconMarkup,
  categoryIconPaths,
  contrastInk,
  isCategoryIconName,
  relativeLuminance,
  resolveCategoryIcon,
} from "@/lib/directory/icons";
import { markerSvg } from "@/lib/directory/format";
import { buildMunicipalityOptions, municipalityLabel, repeatedMunicipalityNames } from "@/lib/directory/municipalities";
import { facilityEditHref } from "@/lib/directory/params";
import { mapLegend } from "@/lib/directory/search";
import type { CategoryOption } from "@/lib/directory/types";
import { CategoryIcon } from "@/components/directory/category-icon";
import { CategoryTag } from "@/components/directory/facility-badges";

const PATH_SYNTAX = /^M[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;

describe("mapa de íconos de categoría", () => {
  it("dibuja exactamente los valores de la lista fija de administración", () => {
    const adminValues = CATEGORY_ICONS.map((i) => i.value).sort();
    expect([...CATEGORY_ICON_NAMES].sort()).toEqual(adminValues);
    expect(isCategoryIconName(DEFAULT_CATEGORY_ICON)).toBe(true);
    // El valor por omisión coincide con el de la columna facility_categories.icon.
    expect(DEFAULT_CATEGORY_ICON).toBe("building");
  });

  it("cada ícono tiene trazos SVG válidos y simples", () => {
    for (const name of CATEGORY_ICON_NAMES) {
      const paths = CATEGORY_ICON_PATHS[name];
      expect(paths.length, name).toBeGreaterThan(0);
      for (const d of paths) expect(d, name).toMatch(PATH_SYNTAX);
    }
  });

  it("«cross» no se dibuja como cruz médica (corazón con pulso, con curvas)", () => {
    const paths = CATEGORY_ICON_PATHS.cross;
    // Una cruz serían solo segmentos rectos horizontales y verticales.
    expect(paths.some((d) => /[CcAa]/.test(d))).toBe(true);
    expect(paths.every((d) => !/^M[\d.]+ [\d.]+[hv]-?[\d.]+M[\d.]+ [\d.]+[hv]-?[\d.]+$/.test(d))).toBe(true);
  });

  it("usa el ícono por omisión con valores vacíos, desconocidos o heredados del prototipo", () => {
    expect(resolveCategoryIcon("hospital")).toBe("hospital");
    expect(resolveCategoryIcon(" map-pin ")).toBe("map-pin");
    for (const v of [null, undefined, "", "   ", "Hospital", "logo-imss", "toString", "__proto__", "constructor"]) {
      expect(resolveCategoryIcon(v)).toBe(DEFAULT_CATEGORY_ICON);
    }
    expect(categoryIconPaths("desconocido")).toBe(CATEGORY_ICON_PATHS.building);
  });

  it("genera el marcado de <path> solo con datos constantes", () => {
    const markup = categoryIconMarkup("pill");
    expect(markup).toBe(CATEGORY_ICON_PATHS.pill.map((d) => `<path d="${d}"/>`).join(""));
    expect(categoryIconMarkup('"><script>alert(1)</script>')).toBe(categoryIconMarkup(DEFAULT_CATEGORY_ICON));
  });

  it("elige una tinta que contrasta con el color de la categoría", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("verde")).toBeNull();
    for (const dark of ["#14532d", "#166534", "#15803d", "#365314", "#4b5563", "#000000"]) expect(contrastInk(dark)).toBe(INK_LIGHT);
    for (const light of ["#ffffff", "#ffff00", "#bbf7d0", "#fde68a"]) expect(contrastInk(light)).toBe(INK_DARK);
    expect(contrastInk("no-es-color")).toBe(INK_LIGHT);
  });
});

describe("marcador del mapa con ícono", () => {
  it("incluye el ícono de la categoría además del color", () => {
    const svg = markerSvg("#14532d", "Hospital A (Hospitales)", "hospital");
    expect(svg).toContain('fill="#14532d"');
    expect(svg).toContain('data-icon="hospital"');
    expect(svg).toContain(`stroke="${INK_LIGHT}"`);
    for (const d of CATEGORY_ICON_PATHS.hospital) expect(svg).toContain(`<path d="${d}"/>`);
    expect(svg).toContain("<title>Hospital A (Hospitales)</title>");
  });

  it("usa el ícono por omisión y tinta oscura sobre colores claros", () => {
    const svg = markerSvg("#ffff00", "Unidad", "icono-inexistente");
    expect(svg).toContain('data-icon="building"');
    expect(svg).toContain(`stroke="${INK_DARK}"`);
    expect(markerSvg(null, "Sin categoría")).toContain('data-icon="building"');
  });

  it("escapa el texto y no deja inyectar marcado por el ícono", () => {
    const svg = markerSvg('red" onload="x', "Clínica <script>", '"><script>x</script>');
    expect(svg).not.toContain("<script>");
    expect(svg).toContain('data-icon="building"');
    expect(svg).toContain('fill="#166534"');
  });
});

describe("CategoryIcon y CategoryTag", () => {
  it("CategoryIcon es decorativo y dibuja los trazos del ícono", () => {
    const { container } = render(<CategoryIcon icon="flask" className="size-4" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-icon", "flask");
    expect(svg.querySelectorAll("path")).toHaveLength(CATEGORY_ICON_PATHS.flask.length);
  });

  it("CategoryTag muestra ícono, color y siempre el nombre", () => {
    const { container } = render(<CategoryTag name="Laboratorios" color="#15803d" icon="flask" />);
    expect(screen.getByText("Laboratorios")).toBeInTheDocument();
    const swatch = container.querySelector("span[aria-hidden='true']") as HTMLElement;
    expect(swatch.style.backgroundColor).toBe("rgb(21, 128, 61)");
    expect(swatch.style.color).toBe("rgb(255, 255, 255)");
    expect(swatch.querySelector('svg[data-icon="flask"]')).not.toBeNull();
  });

  it("CategoryTag sin categoría usa el ícono y color por omisión", () => {
    const { container } = render(<CategoryTag name={null} color="javascript:alert(1)" icon={null} />);
    expect(screen.getByText("Sin categoría")).toBeInTheDocument();
    const swatch = container.querySelector("span[aria-hidden='true']") as HTMLElement;
    expect(swatch.style.backgroundColor).toBe("rgb(22, 101, 52)");
    expect(swatch.querySelector('svg[data-icon="building"]')).not.toBeNull();
  });
});

describe("municipios con nombre repetido (clave INEGI)", () => {
  const catalog = [
    { id: 1, state_id: 20, name: "San Juan Mixtepec", inegi_code: "208" },
    { id: 2, state_id: 20, name: "San Juan Mixtepec", inegi_code: "209" },
    { id: 3, state_id: 20, name: "Abejones", inegi_code: "001" },
    { id: 4, state_id: 18, name: "Tepic", inegi_code: "017" },
    { id: 5, state_id: 7, name: "Abejones", inegi_code: "050" },
  ];

  it("detecta nombres repetidos solo dentro del mismo estado", () => {
    expect([...repeatedMunicipalityNames(catalog)]).toEqual(["20|San Juan Mixtepec"]);
  });

  it("agrega la clave INEGI solo cuando el nombre se repite", () => {
    expect(municipalityLabel("San Juan Mixtepec", "208", true)).toBe("San Juan Mixtepec (clave INEGI 208)");
    expect(municipalityLabel("Tepic", "017", false)).toBe("Tepic");
    expect(municipalityLabel("Sin clave", null, true)).toBe("Sin clave");
  });

  it("marca el repetido aunque solo uno tenga instalaciones y ordena por nombre y clave", () => {
    const options = buildMunicipalityOptions(catalog, new Set([2, 3, 4]));
    expect(options.map((m) => m.label)).toEqual(["Abejones", "San Juan Mixtepec (clave INEGI 209)", "Tepic"]);
    expect(options[1]).toEqual({ id: 2, stateId: 20, name: "San Juan Mixtepec", inegiCode: "209", label: "San Juan Mixtepec (clave INEGI 209)" });
    expect(buildMunicipalityOptions(catalog).map((m) => m.id)).toEqual([3, 5, 1, 2, 4]);
  });
});

describe("leyenda del mapa", () => {
  const categories = new Map<number, CategoryOption>([
    [1, { id: 1, slug: "hospitales", name: "Hospitales", color: "#14532d", icon: "hospital", active: true }],
    [2, { id: 2, slug: "umf", name: "UMF", color: "#166534", icon: "stethoscope", active: true }],
    [3, { id: 3, slug: "otras", name: "Otras", color: "#4b5563", icon: "building", active: true }],
  ]);

  it("solo incluye categorías con instalaciones ubicables, en el orden del catálogo", () => {
    const legend = mapLegend(
      [
        { categoryId: 2, latitude: 21, longitude: -104 },
        { categoryId: 1, latitude: 21.1, longitude: -104.1 },
        { categoryId: 3, latitude: null, longitude: null },
      ],
      categories,
    );
    expect(legend.categories.map((c) => c.id)).toEqual([1, 2]);
    expect(legend.uncategorized).toBe(false);
  });

  it("indica si hay instalaciones ubicables sin categoría conocida", () => {
    expect(mapLegend([{ categoryId: 99, latitude: 21, longitude: -104 }], categories)).toEqual({ categories: [], uncategorized: true });
    expect(mapLegend([{ categoryId: null, latitude: null, longitude: null }], categories)).toEqual({ categories: [], uncategorized: false });
  });
});

describe("enlace de edición para administración", () => {
  it("apunta al formulario de edición de la instalación", () => {
    expect(facilityEditHref("d0000000-0000-4000-8000-000000000001")).toBe(
      "/administracion/instalaciones/d0000000-0000-4000-8000-000000000001/editar",
    );
  });
});
