import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { DEMO_PASSWORD, displayDateTime, loginAs } from "./helpers";

/**
 * Registro con código QR (opcional): coordinación muestra un código temporal
 * de la guardia y la persona asignada lo abre con su cuenta. Usa los datos de
 * demostración: «[DEMO] Guardia matutina» (en curso tras `npm run db:reset`)
 * con Luis (trabajador2@demo.local) asignado. Luis puede tener ya una entrada
 * abierta por corridas anteriores: en ese caso la prueba registra la salida.
 */

const expect = baseExpect.configure({ timeout: 20_000 });

test.describe.configure({ mode: "serial" });
test.use({ serviceWorkers: "block" });

const SHIFT = "d2000000-0000-4000-8000-000000000001";
const SHIFT_TITLE = "[DEMO] Guardia matutina";
const LUIS = { email: "trabajador2@demo.local", name: "[DEMO] Luis Hernández Soto" };
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const NOTICE_RE = /^Este código solo facilita el registro: no prueba presencia física\. Caduca en \d+ s\.$/;

function qrBox(page: Page): Locator {
  return page.getByTestId("qr-code");
}

/** Abre la pantalla del código desde el detalle de la guardia y devuelve el código vigente. */
async function openQrScreen(page: Page): Promise<string> {
  await page.goto(`/guardias/${SHIFT}`);
  const link = page.getByRole("link", { name: "Mostrar código QR de registro" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/pantalla-qr/${SHIFT}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Código QR de registro" })).toBeVisible();
  const box = qrBox(page);
  await expect(box.getByRole("img", { name: /Código QR para registrar/ })).toBeVisible();
  await expect(box).toHaveAttribute("data-token", TOKEN_RE);
  const token = await box.getAttribute("data-token");
  if (!token) throw new Error("La pantalla del código no expuso data-token");
  return token;
}

test.describe("Registro con código QR", () => {
  test("coordinación muestra un código grande, vigente y renovable, sin datos privados", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, "coordinacion@demo.local");
    const first = await openQrScreen(page);
    const box = qrBox(page);

    await expect(box).toHaveAttribute("data-url", new RegExp(`/registro/qr\\?c=${first}$`));
    expect(await box.getByRole("img").getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,/);
    await expect(page.getByText(NOTICE_RE)).toBeVisible();
    await expect(page.getByText(SHIFT_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText("[DEMO] Hospital de demostración A", { exact: true })).toBeVisible();
    // Pantalla pública en el punto de reunión: sin nombres de trabajadores.
    await expect(page.getByText(LUIS.name)).toHaveCount(0);

    // El QR ocupa buena parte del ancho del teléfono (legible a distancia).
    const size = await box.getByRole("img").boundingBox();
    const viewport = page.viewportSize();
    expect(size && viewport ? size.width / viewport.width : 0).toBeGreaterThan(0.6);

    await page.getByRole("button", { name: "Renovar ahora" }).click();
    await expect.poll(() => box.getAttribute("data-token"), { timeout: 20_000 }).not.toBe(first);
    await expect(box).toHaveAttribute("data-token", TOKEN_RE);
  });

  test("Luis escanea el código, inicia sesión y registra con método «Código QR»", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAs(page, "coordinacion@demo.local");
    const token = await openQrScreen(page);

    // Escanear sin sesión: el inicio de sesión conserva el código y regresa a la página.
    await page.context().clearCookies();
    await page.goto(`/registro/qr?c=${token}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(`/registro/qr?c=${token}`);
    await page.getByLabel("Correo electrónico").fill(LUIS.email);
    await page.getByLabel("Contraseña").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    // Tras cargar, la página quita el código de la barra de direcciones.
    await expect(page).toHaveURL(new RegExp(`/registro/qr(\\?c=${token})?$`));

    await expect(page.getByRole("heading", { level: 1, name: "Registro con código QR" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: SHIFT_TITLE })).toBeVisible();
    await expect(page.getByText("[DEMO] Hospital de demostración A")).toBeVisible();
    await expect(page.getByText("Entrada registrada no equivale a presencia física verificada.")).toBeVisible();
    await expect(page.getByText("El código QR no prueba presencia física.")).toBeVisible();

    const entrada = page.getByRole("button", { name: "Registrar entrada con código QR" });
    const salida = page.getByRole("button", { name: "Registrar salida con código QR" });
    await expect(entrada.or(salida)).toBeVisible();
    const action: "entrada" | "salida" = (await salida.isVisible()) ? "salida" : "entrada";
    const word = action === "entrada" ? "Entrada" : "Salida";
    await (action === "entrada" ? entrada : salida).click();

    const confirmation = page.getByTestId("qr-confirmation");
    await expect(confirmation).toHaveAttribute("data-result", "created");
    await expect(page.getByText(new RegExp(`^${word} registrada a las \\d{2}:\\d{2} \\(hora del servidor\\)$`))).toBeVisible();
    await expect(page.getByText("Método: Código QR.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Registrar (entrada|salida) con código QR/ })).toHaveCount(0);
    const at = await confirmation.getAttribute("data-registered-at");
    if (!at) throw new Error("La confirmación no trae la hora del servidor");
    const when = displayDateTime(new Date(at));

    // Mi historial (Luis): el registro aparece con método «Código QR».
    await page.goto("/mi-historial");
    const mine = page.locator("li").filter({ hasText: `${word}: ${when}` }).filter({ hasText: "Código QR" });
    await expect(mine.first()).toBeVisible();

    // Detalle de la guardia (coordinación): la columna de la acción indica «Código QR».
    await loginAs(page, "coordinacion@demo.local");
    await page.goto(`/guardias/${SHIFT}`);
    const card = page.locator("article").filter({ has: page.getByRole("heading", { level: 3, name: LUIS.name, exact: true }) });
    await expect(card).toHaveCount(1);
    const column = card
      .locator('section[aria-label^="Registros de"] > ul > li')
      .locator("dl > div")
      .filter({ has: page.locator("dt", { hasText: new RegExp(`^${word}$`) }) })
      .filter({ hasText: when });
    await expect(column.first()).toBeVisible();
    await expect(column.first()).toContainText("Código QR");
  });

  test("un código inventado, mal formado o ausente muestra un mensaje claro", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, LUIS.email);

    await page.goto("/registro/qr?c=codigoInventado1234567890abcdef");
    await expect(page.getByText("El código QR caducó o no es válido")).toBeVisible();
    await expect(page.getByText("Pide que muestren el código vigente y vuelve a escanearlo.")).toBeVisible();
    await expect(page.getByRole("button", { name: /con código QR/ })).toHaveCount(0);

    await page.goto("/registro/qr?c=abc");
    await expect(page.getByText("El enlace no contiene un código válido")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cómo registrar con código QR" })).toBeVisible();

    await page.goto("/registro/qr");
    await expect(page.getByRole("heading", { name: "Cómo registrar con código QR" })).toBeVisible();
    await expect(page.getByText("El enlace no contiene un código válido")).toHaveCount(0);

    // Aviso en «Registrar entrada o salida».
    await page.goto("/registro");
    await expect(page.getByText("¿Te mostraron un código QR? Escanéalo con la cámara de tu teléfono")).toBeVisible();
    await page.getByRole("link", { name: "Cómo funciona" }).click();
    await expect(page).toHaveURL(/\/registro\/qr$/);
  });

  test("consulta y trabajadores no pueden mostrar el código", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, "auditoria@demo.local");
    await page.goto(`/guardias/${SHIFT}`);
    await expect(page.getByRole("heading", { level: 1, name: SHIFT_TITLE })).toBeVisible();
    await expect(page.getByRole("link", { name: "Mostrar código QR de registro" })).toHaveCount(0);
    await page.goto(`/pantalla-qr/${SHIFT}`);
    await expect(page).toHaveURL(/\/sin-acceso/);

    await loginAs(page, LUIS.email);
    await page.goto(`/pantalla-qr/${SHIFT}`);
    await expect(page).toHaveURL(/\/sin-acceso/);
  });
});
