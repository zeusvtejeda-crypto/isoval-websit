import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Guardias-2026!";

export async function login(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
