// @vitest-environment node
/**
 * Pruebas del service worker propio (public/sw.js).
 *
 * El archivo se ejecuta tal cual dentro de un contexto `vm` con un `self`
 * simulado (eventos, caches, fetch y clients falsos). Así se verifica el
 * comportamiento real del archivo que se publica, sin navegador.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";

const ORIGIN = "https://guardias.example.mx";
const SW_SOURCE = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");

const OFFLINE_HTML =
  '<!doctype html><html lang="es-MX"><head>' +
  '<link rel="stylesheet" href="/_next/static/chunks/offline-app.css" data-precedence="next">' +
  "</head><body><h1>Sin conexión</h1></body></html>";

/* ------------------------------------------------------------------ */
/* Dobles de prueba                                                   */
/* ------------------------------------------------------------------ */

type RequestLike = { url: string; method?: string; credentials?: RequestCredentials; headers?: Headers };

/** Solicitud tal como la recibe el evento fetch (mode "navigate" no se puede construir con Request). */
type FakeRequest = {
  url: string;
  method: string;
  mode: RequestMode;
  cache: RequestCache;
  credentials: RequestCredentials;
  destination: string;
  headers: Headers;
};

function makeRequest(
  pathOrUrl: string,
  init: Partial<Omit<FakeRequest, "url" | "headers">> & { headers?: Record<string, string> } = {},
): FakeRequest {
  return {
    url: new URL(pathOrUrl, ORIGIN).href,
    method: init.method ?? "GET",
    mode: init.mode ?? "cors",
    cache: init.cache ?? "default",
    credentials: init.credentials ?? "same-origin",
    destination: init.destination ?? "",
    headers: new Headers(init.headers ?? {}),
  };
}

function navigation(path: string, method = "GET"): FakeRequest {
  return makeRequest(path, { mode: "navigate", method, destination: "document", credentials: "include" });
}

function keyOf(request: RequestLike | string): string {
  return typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
}

function headersOf(request: RequestLike | string): Headers {
  return typeof request === "string" ? new Headers() : new Headers(request.headers ?? {});
}

type CacheEntry = { requestHeaders: Headers; response: Response };

/**
 * Regla Vary de la Cache API: cada encabezado listado en Vary debe valer lo mismo
 * en la solicitud guardada y en la consultada; «Vary: *» nunca coincide.
 */
function varyMatches(entry: CacheEntry, query: Headers): boolean {
  const names = (entry.response.headers.get("Vary") ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return names.every((name) => name !== "*" && entry.requestHeaders.get(name) === query.get(name));
}

class FakeCache {
  readonly store = new Map<string, CacheEntry>();

  async match(request: RequestLike | string, options: { ignoreVary?: boolean } = {}): Promise<Response | undefined> {
    const entry = this.store.get(keyOf(request));
    if (!entry) return undefined;
    if (!options.ignoreVary && !varyMatches(entry, headersOf(request))) return undefined;
    return entry.response.clone();
  }

  async put(request: RequestLike | string, response: Response): Promise<void> {
    this.store.set(keyOf(request), { requestHeaders: headersOf(request), response });
  }

  async keys(): Promise<Request[]> {
    return [...this.store.keys()].map((url) => new Request(url));
  }

  async delete(request: RequestLike | string): Promise<boolean> {
    return this.store.delete(keyOf(request));
  }
}

class FakeCacheStorage {
  readonly byName = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    let cache = this.byName.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.byName.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.byName.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.byName.delete(name);
  }

  async match(request: RequestLike | string): Promise<Response | undefined> {
    for (const cache of this.byName.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  }

  /** Todas las URL guardadas en cualquier caché. */
  allUrls(): string[] {
    return [...this.byName.values()].flatMap((cache) => [...cache.store.keys()]);
  }
}

class FakeExtendableEvent {
  readonly pending: Promise<unknown>[] = [];
  waitUntil(promise: Promise<unknown>) {
    this.pending.push(promise);
  }
  async settled() {
    await Promise.all(this.pending);
  }
}

class FakeFetchEvent extends FakeExtendableEvent {
  response: Promise<Response> | null = null;
  constructor(readonly request: FakeRequest) {
    super();
  }
  respondWith(response: Response | Promise<Response>) {
    if (this.response) throw new Error("respondWith se llamó dos veces");
    this.response = Promise.resolve(response);
  }
}

type Route = () => Response;

/** Red simulada: rutas por pathname (o pathname + query) y modo sin conexión. */
function createNetwork() {
  let online = true;
  const routes = new Map<string, Route>();
  const handler = vi.fn(async (input: RequestLike) => {
    if (!online) throw new TypeError("Failed to fetch");
    const url = new URL(input.url);
    const route = routes.get(url.pathname + url.search) ?? routes.get(url.pathname);
    return route ? route() : new Response("No encontrado", { status: 404 });
  });
  return {
    handler,
    route(path: string, route: Route) {
      routes.set(path, route);
    },
    setOnline(value: boolean) {
      online = value;
    },
  };
}

type Network = ReturnType<typeof createNetwork>;
type Listener = (event: unknown) => void;

function loadServiceWorker(network: Network) {
  const listeners = new Map<string, Listener[]>();
  const caches = new FakeCacheStorage();
  const skipWaiting = vi.fn(async () => undefined);
  const claim = vi.fn(async () => undefined);

  const sandbox: Record<string, unknown> = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
    registration: { scope: `${ORIGIN}/` },
    clients: { claim },
    skipWaiting,
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    caches,
    fetch: network.handler,
    Request,
    Response,
    Headers,
    Blob,
    URL,
    console,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox, { filename: "public/sw.js" });

  function emit(type: string, event: unknown) {
    for (const listener of listeners.get(type) ?? []) listener(event);
  }

  return {
    caches,
    skipWaiting,
    claim,
    listeners,
    async install() {
      const event = new FakeExtendableEvent();
      emit("install", event);
      await event.settled();
    },
    async activate() {
      const event = new FakeExtendableEvent();
      emit("activate", event);
      await event.settled();
    },
    /** Despacha un evento fetch; devuelve el evento (response = null si no se interceptó). */
    async fetch(request: FakeRequest) {
      const event = new FakeFetchEvent(request);
      emit("fetch", event);
      if (event.response) await event.response.catch(() => undefined);
      await event.settled();
      return event;
    },
  };
}

type Worker = ReturnType<typeof loadServiceWorker>;

const MANIFEST_ICONS = (manifest().icons ?? []).map((icon) => icon.src);

/** Encabezado Vary que Next.js agrega a las páginas y rutas de la App. */
const NEXT_VARY = "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch";

function seedNetwork(network: Network) {
  network.route(
    "/offline",
    () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", Vary: NEXT_VARY } }),
  );
  network.route(
    "/manifest.webmanifest",
    () =>
      new Response(JSON.stringify(manifest()), {
        headers: { "Content-Type": "application/manifest+json", Vary: NEXT_VARY },
      }),
  );
  for (const src of MANIFEST_ICONS) {
    network.route(src, () => new Response(`png:${src}`, { headers: { "Content-Type": "image/png" } }));
  }
  network.route("/_next/static/chunks/offline-app.css", () => new Response("body{}", { headers: { "Content-Type": "text/css" } }));
}

/* ------------------------------------------------------------------ */
/* Pruebas                                                            */
/* ------------------------------------------------------------------ */

describe("service worker: instalación y activación", () => {
  let network: Network;
  let sw: Worker;

  beforeEach(() => {
    network = createNetwork();
    seedNetwork(network);
    sw = loadServiceWorker(network);
  });

  it("registra los eventos install, activate y fetch", () => {
    expect([...sw.listeners.keys()].sort()).toEqual(["activate", "fetch", "install"]);
  });

  it("precarga /offline, el manifiesto y todos los íconos del manifiesto, sin cookies, y llama skipWaiting", async () => {
    await sw.install();

    const names = await sw.caches.keys();
    const precacheName = names.find((name) => name.includes("precarga"));
    expect(precacheName).toMatch(/^guardias-precarga-v\d+$/);

    const precache = await sw.caches.open(precacheName!);
    const urls = [...precache.store.keys()];
    expect(urls).toContain(`${ORIGIN}/offline`);
    expect(urls).toContain(`${ORIGIN}/manifest.webmanifest`);
    expect(MANIFEST_ICONS.length).toBeGreaterThanOrEqual(3);
    for (const src of MANIFEST_ICONS) expect(urls).toContain(`${ORIGIN}${src}`);

    const precacheCalls = network.handler.mock.calls.map(([request]) => request);
    for (const request of precacheCalls) expect(request.credentials).toBe("omit");

    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("precarga también la hoja de estilos de /offline para que se vea bien sin red", async () => {
    await sw.install();
    expect(sw.caches.allUrls()).toContain(`${ORIGIN}/_next/static/chunks/offline-app.css`);
  });

  it("la instalación falla si falta un recurso de precarga (no deja una versión incompleta)", async () => {
    network.route("/icons/icon-512.png", () => new Response("No encontrado", { status: 404 }));
    await expect(sw.install()).rejects.toThrow(/icon-512/);
    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });

  it("al activarse borra solo las cachés viejas propias y toma el control de las pestañas", async () => {
    await sw.caches.open("guardias-precarga-v0");
    await sw.caches.open("guardias-estaticos-v0");
    await sw.caches.open("otra-aplicacion");

    await sw.install();
    // Un recurso estático guardado antes de activar crea la caché de estáticos vigente.
    network.route("/_next/static/chunks/a.js", () => new Response("a", { headers: { "Content-Type": "text/javascript" } }));
    await sw.fetch(makeRequest("/_next/static/chunks/a.js", { destination: "script" }));
    await sw.activate();

    const names = (await sw.caches.keys()).sort();
    expect(names).not.toContain("guardias-precarga-v0");
    expect(names).not.toContain("guardias-estaticos-v0");
    expect(names).toContain("otra-aplicacion");

    const own = names.filter((name) => name.startsWith("guardias-"));
    expect(own).toHaveLength(2);
    const version = own.find((name) => name.startsWith("guardias-precarga-"))!.slice("guardias-precarga-".length);
    expect(version).not.toBe("v0");
    expect(own).toEqual([`guardias-estaticos-${version}`, `guardias-precarga-${version}`]);
    expect(sw.caches.allUrls()).toContain(`${ORIGIN}/_next/static/chunks/a.js`);
    expect(sw.claim).toHaveBeenCalledTimes(1);
  });
});

describe("service worker: solicitudes que nunca se interceptan", () => {
  let network: Network;
  let sw: Worker;

  beforeEach(async () => {
    network = createNetwork();
    seedNetwork(network);
    sw = loadServiceWorker(network);
    await sw.install();
    await sw.activate();
    network.handler.mockClear();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("no intercepta %s (registros de asistencia, Server Actions)", async (method) => {
    const api = await sw.fetch(makeRequest("/api/asistencia", { method }));
    const action = await sw.fetch(makeRequest("/registro", { method, headers: { "Next-Action": "abc" } }));
    const staticPath = await sw.fetch(makeRequest("/_next/static/chunks/main-abc123.js", { method }));
    expect(api.response).toBeNull();
    expect(action.response).toBeNull();
    expect(staticPath.response).toBeNull();
    expect(network.handler).not.toHaveBeenCalled();
  });

  it("no intercepta un formulario enviado por POST aunque sea una navegación", async () => {
    const event = await sw.fetch(navigation("/login", "POST"));
    expect(event.response).toBeNull();
  });

  it("no intercepta ni guarda nada bajo /api/ (ni GET ni descargas por navegación)", async () => {
    const get = await sw.fetch(makeRequest("/api/asistencia?id=1"));
    const download = await sw.fetch(navigation("/api/exportar?formato=csv"));
    const bare = await sw.fetch(makeRequest("/api"));
    expect(get.response).toBeNull();
    expect(download.response).toBeNull();
    expect(bare.response).toBeNull();
    expect(network.handler).not.toHaveBeenCalled();
    expect(sw.caches.allUrls().some((url) => new URL(url).pathname.startsWith("/api"))).toBe(false);
  });

  it("ignora otros orígenes: teselas del mapa y Supabase", async () => {
    const tile = await sw.fetch(makeRequest("https://tile.openstreetmap.org/12/800/1700.png", { mode: "no-cors", destination: "image" }));
    const supabase = await sw.fetch(makeRequest("https://proyecto.supabase.co/rest/v1/public_facilities?select=*"));
    expect(tile.response).toBeNull();
    expect(supabase.response).toBeNull();
    expect(sw.caches.allUrls().some((url) => !url.startsWith(ORIGIN))).toBe(false);
  });

  it("no intercepta datos de página (RSC) ni rutas que no son estáticas", async () => {
    const rsc = await sw.fetch(makeRequest("/inicio?_rsc=1x2y", { headers: { RSC: "1" } }));
    const image = await sw.fetch(makeRequest("/_next/image?url=%2Ffoto.png&w=640&q=75", { destination: "image" }));
    expect(rsc.response).toBeNull();
    expect(image.response).toBeNull();
  });
});

describe("service worker: navegaciones", () => {
  let network: Network;
  let sw: Worker;

  beforeEach(() => {
    network = createNetwork();
    seedNetwork(network);
    network.route("/inicio", () => new Response("<h1>Datos privados de Ana</h1>", { headers: { "Content-Type": "text/html" } }));
    sw = loadServiceWorker(network);
  });

  it("sin red responde la página /offline precargada", async () => {
    await sw.install();
    network.setOnline(false);

    const event = await sw.fetch(navigation("/inicio"));
    expect(event.response).not.toBeNull();
    const response = await event.response!;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(OFFLINE_HTML);
  });

  it("sin red y sin precarga responde un aviso de «Sin conexión» con estado 503", async () => {
    network.setOnline(false);
    const response = await (await sw.fetch(navigation("/mi-guardia"))).response!;
    expect(response.status).toBe(503);
    const html = await response.text();
    expect(html).toContain("Sin conexión");
    expect(html).toContain("no se puede registrar ni confirmar");
  });

  it("en línea va a la red y nunca guarda la respuesta en caché", async () => {
    await sw.install();
    await sw.activate();
    network.handler.mockClear();

    const event = await sw.fetch(navigation("/inicio"));
    const response = await event.response!;
    expect(await response.text()).toContain("Datos privados de Ana");
    expect(network.handler).toHaveBeenCalledTimes(1);
    expect(sw.caches.allUrls()).not.toContain(`${ORIGIN}/inicio`);

    // Después, sin red, NO se devuelve la página privada sino /offline.
    network.setOnline(false);
    const offline = await (await sw.fetch(navigation("/inicio"))).response!;
    expect(await offline.text()).toBe(OFFLINE_HTML);
  });

  it("ninguna navegación agrega entradas a la caché, aunque apunte a una ruta de recursos estáticos", async () => {
    await sw.install();
    await sw.activate();
    const before = sw.caches.allUrls().sort();
    network.route("/_next/static/chunks/pagina.js", () => new Response("x", { headers: { "Content-Type": "text/javascript" } }));

    for (const path of ["/inicio", "/_next/static/chunks/pagina.js", "/icons/otro.png", "/directorio", "/offline"]) {
      const event = await sw.fetch(navigation(path));
      expect(event.response, path).not.toBeNull();
      await event.response;
    }
    expect(sw.caches.allUrls().sort()).toEqual(before);
  });

  it("navegar a /offline en línea no reemplaza la copia precargada", async () => {
    await sw.install();
    network.route("/offline", () => new Response("versión nueva con sesión", { headers: { "Content-Type": "text/html" } }));

    const response = await (await sw.fetch(navigation("/offline"))).response!;
    expect(await response.text()).toBe("versión nueva con sesión");

    const cached = await sw.caches.match(`${ORIGIN}/offline`);
    expect(await cached!.text()).toBe(OFFLINE_HTML);
  });
});

describe("service worker: recursos estáticos", () => {
  let network: Network;
  let sw: Worker;

  beforeEach(async () => {
    network = createNetwork();
    seedNetwork(network);
    network.route("/_next/static/chunks/main-abc123.js", () => new Response("console.log(1)", { headers: { "Content-Type": "text/javascript" } }));
    sw = loadServiceWorker(network);
    await sw.install();
    await sw.activate();
    network.handler.mockClear();
  });

  it("/_next/static/* usa caché primero: la segunda vez no va a la red y funciona sin conexión", async () => {
    const request = () => makeRequest("/_next/static/chunks/main-abc123.js", { destination: "script" });

    const first = await sw.fetch(request());
    expect(await (await first.response!).text()).toBe("console.log(1)");
    expect(network.handler).toHaveBeenCalledTimes(1);
    expect(sw.caches.allUrls()).toContain(`${ORIGIN}/_next/static/chunks/main-abc123.js`);

    const second = await sw.fetch(request());
    expect(await (await second.response!).text()).toBe("console.log(1)");
    expect(network.handler).toHaveBeenCalledTimes(1);

    network.setOnline(false);
    const offline = await sw.fetch(request());
    expect(await (await offline.response!).text()).toBe("console.log(1)");
  });

  it("/icons/* se sirve desde la precarga sin ir a la red", async () => {
    network.setOnline(false);
    const event = await sw.fetch(makeRequest("/icons/icon-192.png", { destination: "image" }));
    const response = await event.response!;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("png:/icons/icon-192.png");
    expect(network.handler).not.toHaveBeenCalled();
  });

  it("no guarda respuestas de error ni con Cache-Control: no-store", async () => {
    network.route("/_next/static/chunks/privado.js", () => new Response("x", { headers: { "Cache-Control": "no-store" } }));

    const missing = await sw.fetch(makeRequest("/_next/static/chunks/no-existe.js"));
    expect((await missing.response!).status).toBe(404);
    await sw.fetch(makeRequest("/_next/static/chunks/privado.js"));

    const urls = sw.caches.allUrls();
    expect(urls).not.toContain(`${ORIGIN}/_next/static/chunks/no-existe.js`);
    expect(urls).not.toContain(`${ORIGIN}/_next/static/chunks/privado.js`);
  });

  it("limita el tamaño de la caché de estáticos (borra las entradas más antiguas)", async () => {
    for (let i = 0; i < 210; i += 1) {
      network.route(`/_next/static/chunks/c${i}.js`, () => new Response(`c${i}`));
      await sw.fetch(makeRequest(`/_next/static/chunks/c${i}.js`));
    }
    const runtimeName = (await sw.caches.keys()).find((name) => name.includes("estaticos"))!;
    const runtime = await sw.caches.open(runtimeName);
    expect(runtime.store.size).toBeLessThanOrEqual(200);
    expect(runtime.store.has(`${ORIGIN}/_next/static/chunks/c209.js`)).toBe(true);
    expect(runtime.store.has(`${ORIGIN}/_next/static/chunks/c0.js`)).toBe(false);

    // La hoja de estilos de /offline sigue disponible sin red aunque se llene la caché.
    network.setOnline(false);
    const css = await (await sw.fetch(makeRequest("/_next/static/chunks/offline-app.css", { destination: "style" }))).response!;
    expect(await css.text()).toBe("body{}");
  });

  it("encuentra las copias guardadas aunque la respuesta traiga Vary y la solicitud otros encabezados", async () => {
    network.route(
      "/icons/icon-192.png",
      () => new Response("png-vary", { headers: { "Content-Type": "image/png", Vary: "Accept" } }),
    );
    // Reinstala para que la precarga guarde la versión con «Vary: Accept».
    await sw.install();
    network.setOnline(false);

    const icon = await sw.fetch(
      makeRequest("/icons/icon-192.png", { destination: "image", headers: { Accept: "image/avif,image/webp,*/*" } }),
    );
    expect(await (await icon.response!).text()).toBe("png-vary");

    const manifestEvent = await sw.fetch(
      makeRequest("/manifest.webmanifest", { destination: "manifest", headers: { Accept: "*/*", RSC: "1" } }),
    );
    expect((await manifestEvent.response!).status).toBe(200);

    const page = await (await sw.fetch({ ...navigation("/inicio"), headers: new Headers({ RSC: "1" }) })).response!;
    expect(await page.text()).toBe(OFFLINE_HTML);
  });

  it("el manifiesto sin red usa la copia precargada", async () => {
    network.setOnline(false);
    const response = await (await sw.fetch(makeRequest("/manifest.webmanifest", { destination: "manifest" }))).response!;
    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toMatchObject({ short_name: "Guardias" });
  });
});
