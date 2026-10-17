import { expect, type Locator, type Page } from "@playwright/test";

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Guardias-2026!";

/** Zona horaria de las sedes de demostración (y la zona por omisión de la plataforma). */
export const SEDE_TZ = "America/Mazatlan";

/** Identificadores fijos del seed de demostración (supabase/seeds/demo.sql). */
export const DEMO = {
  hospitalA: "d0000000-0000-4000-8000-000000000001",
  umf1: "d0000000-0000-4000-8000-000000000002",
  umf2Xalisco: "d0000000-0000-4000-8000-000000000003",
  ana: "d1000000-0000-4000-8000-000000000001",
  luis: "d1000000-0000-4000-8000-000000000002",
  maria: "d1000000-0000-4000-8000-000000000003",
  patricia: "d1000000-0000-4000-8000-000000000007",
  guardiaAyer: "d2000000-0000-4000-8000-000000000003",
  guardiaXalisco: "d2000000-0000-4000-8000-000000000004",
} as const;

export async function login(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Cierra la sesión actual (borra cookies) e inicia con otra cuenta en la misma página. */
export async function loginAs(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.context().clearCookies();
  await login(page, email, password);
}

type LocalParts = { date: string; time: string };

/** Fecha (yyyy-MM-dd) y hora (HH:mm) de un instante en la zona indicada. */
export function localParts(value: Date, timeZone = SEDE_TZ): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Valor para <input type="datetime-local"> en la zona de la sede. */
export function localInput(value: Date, timeZone = SEDE_TZ): string {
  const p = localParts(value, timeZone);
  return `${p.date}T${p.time}`;
}

/** «dd/MM/yyyy HH:mm», como lo muestra la interfaz (formatDateTime). */
export function displayDateTime(value: Date, timeZone = SEDE_TZ): string {
  const p = localParts(value, timeZone);
  const [y, m, d] = p.date.split("-");
  return `${d}/${m}/${y} ${p.time}`;
}

/** Instante truncado al minuto, desplazado `minutes` minutos. */
export function minutesFromNow(minutes: number, now = new Date()): Date {
  const base = Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(base + minutes * 60_000);
}

export function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

/** Escapa un texto para usarlo dentro de una expresión regular. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Valor (<dd>) de una métrica <dt>/<dd> con la etiqueta exacta dentro de `scope`. */
export function metric(scope: Locator, label: string): Locator {
  return scope
    .locator("div")
    .filter({ has: scope.page().locator("dt", { hasText: new RegExp(`^${escapeRegExp(label)}$`) }) })
    .last()
    .locator("dd")
    .first();
}

/** Valor de un <Stat> (etiqueta y valor en párrafos hermanos) dentro de `scope`. */
export function statValue(scope: Locator | Page, label: string): Locator {
  return scope.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
}

/** PNG transparente de 1×1 para responder teselas sin salir a internet. */
export const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Las pruebas no dependen del proveedor de teselas (puede no haber salida a
 * internet y la política de OpenStreetMap no admite tráfico automatizado):
 * se responde con una imagen vacía. Se verifican marcadores y ventanas emergentes.
 */
export async function stubMapTiles(page: Page) {
  await page.route(/^https:\/\/([a-c]\.)?tile\.openstreetmap\.org\//, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
}
