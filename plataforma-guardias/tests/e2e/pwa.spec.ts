import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * PWA instalable: manifiesto, íconos y service worker.
 * Se ejecuta contra `next build` + `next start` (el service worker solo se
 * registra en producción).
 */

type ManifestIcon = { src: string; sizes?: string; type?: string; purpose?: string };
type WebManifest = {
  name?: string;
  short_name?: string;
  description?: string;
  lang?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  background_color?: string;
  theme_color?: string;
  icons?: ManifestIcon[];
  shortcuts?: { name: string; url: string; icons?: ManifestIcon[] }[];
};

/** Atributos de cada <link> del HTML, sin depender del orden en que Next.js los escribe. */
function linkTags(html: string): Record<string, string>[] {
  return [...html.matchAll(/<link\b([^>]*)>/gi)].map(([, attrs]) =>
    Object.fromEntries([...attrs.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(([, key, value]) => [key.toLowerCase(), value])),
  );
}

async function fetchManifest(request: APIRequestContext): Promise<WebManifest> {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  return (await response.json()) as WebManifest;
}

test.describe("PWA instalable", () => {
  test("/manifest.webmanifest responde con los campos requeridos", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/manifest+json");

    const manifest = (await response.json()) as WebManifest;
    expect(manifest).toMatchObject({
      name: "Guardias y Directorio de Instalaciones",
      short_name: "Guardias",
      lang: "es-MX",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#14532d",
    });
    expect(manifest.description).toMatch(/no es una aplicación oficial del IMSS/i);
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "maskable" }),
      ]),
    );
    expect((manifest.shortcuts ?? []).map((s) => s.url)).toEqual(expect.arrayContaining(["/registro", "/directorio"]));
  });

  test("los íconos del manifiesto y de los accesos directos responden 200 como PNG", async ({ request }) => {
    const manifest = await fetchManifest(request);
    const sources = new Set<string>([
      ...(manifest.icons ?? []).map((icon) => icon.src),
      ...(manifest.shortcuts ?? []).flatMap((shortcut) => (shortcut.icons ?? []).map((icon) => icon.src)),
    ]);
    expect(sources.size).toBeGreaterThanOrEqual(3);

    for (const src of sources) {
      const response = await request.get(src);
      expect(response.status(), src).toBe(200);
      expect(response.headers()["content-type"], src).toContain("image/png");
    }
  });

  test("el HTML enlaza el manifiesto, el ícono y el ícono de Apple", async ({ request }) => {
    // /offline es pública y estática: no depende de la sesión ni de Supabase.
    const response = await request.get("/offline", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const links = linkTags(await response.text());
    expect(links).toContainEqual(expect.objectContaining({ rel: "manifest", href: "/manifest.webmanifest" }));
    expect(links.some((link) => link.rel === "icon" && /^\/icon\.png(\?|$)/.test(link.href ?? ""))).toBe(true);
    expect(links.some((link) => link.rel === "apple-touch-icon" && /^\/apple-icon\.png(\?|$)/.test(link.href ?? ""))).toBe(true);
  });

  test("/sw.js responde con Cache-Control no-cache", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-cache");
    expect(response.headers()["content-type"]).toMatch(/javascript/);
  });

  test("la página /offline está disponible sin sesión (el service worker la precarga)", async ({ request }) => {
    const response = await request.get("/offline", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Sin conexión");
  });

  test("el service worker se instala, controla la página y nunca guarda navegaciones", async ({ page }) => {
    test.skip(
      Boolean(process.env.E2E_DEV) && process.env.NEXT_PUBLIC_ENABLE_SW !== "true",
      "Con next dev el service worker no se registra (solo en producción).",
    );
    await page.goto("/login");

    // Si la precarga falla (p. ej. un ícono 404), la instalación no termina y esto vence.
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(new URL("/", page.url()).href);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    // Navegación ya controlada por el service worker.
    await page.reload();
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const paths: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
      }
      return { names, paths };
    });

    expect(cached.names.some((name) => /^guardias-precarga-v\d+$/.test(name))).toBe(true);
    expect(cached.paths).toEqual(expect.arrayContaining(["/offline", "/manifest.webmanifest", "/icons/icon-192.png"]));
    expect(cached.paths).not.toContain("/login");
    expect(cached.paths.some((path) => path.startsWith("/api/"))).toBe(false);

    // Solo recursos estáticos: la precarga, /_next/static/* e /icons/*. Nunca una navegación.
    const manifest = await fetchManifest(page.request);
    const precached = new Set(["/offline", "/manifest.webmanifest", ...(manifest.icons ?? []).map((icon) => icon.src)]);
    for (const path of cached.paths) {
      expect(precached.has(path) || path.startsWith("/_next/static/") || path.startsWith("/icons/"), path).toBe(true);
    }
  });
});
