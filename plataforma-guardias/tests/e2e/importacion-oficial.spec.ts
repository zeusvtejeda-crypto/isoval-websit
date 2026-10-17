import path from "node:path";
import { expect as baseExpect, test } from "@playwright/test";
import { loginAs, statValue } from "./helpers";

/**
 * Importación del catálogo oficial de Nayarit (CLUES DGIS + directorio IMSS):
 * datos-oficiales/instalaciones_nayarit_imss_plantilla.csv (396 unidades).
 * Es repetible: en una segunda ejecución las filas son actualizaciones sin
 * cambios (modo «crear y actualizar»), nunca duplicados ni errores.
 */

const expect = baseExpect.configure({ timeout: 30_000 });
test.use({ serviceWorkers: "block" });

const CSV = path.join(__dirname, "..", "..", "datos-oficiales", "instalaciones_nayarit_imss_plantilla.csv");
const TOTAL_ROWS = 396;

function toInt(text: string | null): number {
  return Number((text ?? "").replace(/[^\d]/g, ""));
}

test("Importación del catálogo oficial: valida 396 filas sin errores, importa y se encuentra en el directorio", async ({ page }) => {
  test.setTimeout(300_000);
  await loginAs(page, "admin@demo.local");

  await page.goto("/administracion/instalaciones/importar");
  await expect(page.getByRole("heading", { level: 1, name: "Importar instalaciones" })).toBeVisible();
  await page.locator("#archivo").setInputFiles(CSV);
  await expect(page.getByRole("radio", { name: /Crear y actualizar/i })).toBeChecked();
  await expect(page.getByLabel("Marcar como datos de demostración")).not.toBeChecked();

  // 1) Validar: vista previa sin guardar nada.
  await page.getByRole("button", { name: "Validar" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /Vista previa/ })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Validación lista (aún no se guardó nada)")).toBeVisible();
  const preview = page.locator('section[aria-labelledby="resultado-importacion"]');
  const nuevas = toInt(await statValue(preview, "Nuevas").textContent());
  const actualizaciones = toInt(await statValue(preview, "Actualizaciones").textContent());
  expect(nuevas + actualizaciones).toBe(TOTAL_ROWS);
  await expect(statValue(preview, "Duplicadas")).toHaveText("0");
  await expect(statValue(preview, "Con error")).toHaveText("0");

  // 2) Importar (solo si hay filas nuevas o con cambios; en una repetición todas quedan «sin cambios»).
  const importButton = page.getByRole("button", { name: "Importar", exact: true });
  if (await importButton.isEnabled()) {
    page.once("dialog", (dialog) => dialog.accept());
    await importButton.click();
    await expect(page.getByRole("heading", { level: 2, name: /Resultado de la importación/ })).toBeVisible({ timeout: 240_000 });
    await expect(page.getByText("Importación terminada", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Importación terminada: /)).toBeVisible();
    const creadas = toInt(await statValue(preview, "Creadas").textContent());
    const actualizadas = toInt(await statValue(preview, "Actualizadas").textContent());
    const sinCambios = toInt(await statValue(preview, "Sin cambios").textContent());
    expect(creadas + actualizadas + sinCambios).toBe(TOTAL_ROWS);
    await expect(statValue(preview, "No guardadas")).toHaveText("0");
  } else {
    await expect(statValue(preview, "Actualizaciones")).toHaveText(String(TOTAL_ROWS));
    await expect(preview.getByText(`${TOTAL_ROWS} sin cambios`, { exact: true })).toBeVisible();
    await expect(importButton).toBeDisabled();
  }

  // 3) Directorio público: dos unidades «LINDA VISTA» en Del Nayar con distinta CLUES.
  await page.context().clearCookies();
  await page.goto("/directorio");
  await page.getByLabel("Buscar", { exact: true }).fill("LINDA VISTA");
  const list = page.locator("#dir-panel-lista");
  const lindaVista = list.getByRole("listitem").filter({ has: page.getByRole("link", { name: "LINDA VISTA", exact: true }) });
  await expect(lindaVista).toHaveCount(2);
  await expect(lindaVista.filter({ hasText: "Clave de unidad: NTIMS000721" })).toHaveCount(1);
  await expect(lindaVista.filter({ hasText: "Clave de unidad: NTIMS001235" })).toHaveCount(1);
  for (const item of await lindaVista.all()) {
    await expect(item).toContainText("Del Nayar, Nayarit");
    await expect(item).toContainText("Otras unidades médicas");
  }

  // Ficha de una de ellas: fuente oficial y estado de verificación.
  await lindaVista.filter({ hasText: "NTIMS000721" }).getByRole("link", { name: "LINDA VISTA", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "LINDA VISTA" })).toBeVisible();
  await expect(page.getByText("NTIMS000721").first()).toBeVisible();
  await expect(page.getByText(/CLUES DGIS/).first()).toBeVisible();

  // Búsqueda por municipio y filtro de categoría.
  await page.goto("/directorio");
  await page.getByLabel("Buscar", { exact: true }).fill("Del Nayar");
  await expect(list.getByText(/instalaciones? encontradas?/)).toBeVisible();
  await page.getByLabel("Categoría", { exact: true }).selectOption({ label: "Hospitales" });
  await expect(list.getByRole("link", { name: "LINDA VISTA", exact: true })).toHaveCount(0);
});
