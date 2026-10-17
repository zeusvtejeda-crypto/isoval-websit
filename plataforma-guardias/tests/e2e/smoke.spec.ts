import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("inicio de sesión de administración lleva a /inicio", async ({ page }) => {
  await login(page, "admin@demo.local");
  await expect(page).toHaveURL(/\/inicio/);
});

test("credenciales incorrectas muestran error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@demo.local");
  await page.getByLabel("Contraseña").fill("incorrecta");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
});

test("ruta privada sin sesión redirige a login", async ({ page }) => {
  await page.goto("/guardias");
  await expect(page).toHaveURL(/\/login\?next=%2Fguardias/);
});
