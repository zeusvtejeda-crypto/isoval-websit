/*
 * Service worker de «Guardias y Directorio de Instalaciones» (sin dependencias).
 * Plataforma independiente: no es una aplicación oficial del IMSS.
 *
 * Reglas (ver docs/ARQUITECTURA.md):
 *  - Solo guarda recursos estáticos: /_next/static/*, /icons/*, la página /offline
 *    (con su hoja de estilos) y el manifiesto.
 *  - Navegaciones: siempre a la red; si no hay red, responde la página /offline
 *    precargada. NUNCA guarda respuestas de navegación (pueden traer datos privados).
 *  - NUNCA intercepta métodos distintos de GET ni nada bajo /api/.
 *  - Ignora solicitudes de otros orígenes (teselas del mapa, Supabase, etc.).
 *  - Un registro de entrada o salida jamás se responde desde caché: sin conexión,
 *    la solicitud falla y la interfaz lo indica.
 *
 * Si cambias la lista de precarga o las estrategias, sube CACHE_VERSION: al
 * activarse la nueva versión se borran las cachés anteriores.
 * El registro está en src/components/layout/service-worker-registration.tsx
 * (solo en producción) y /sw.js se sirve con Cache-Control: no-cache.
 */

const CACHE_VERSION = "v1";
const CACHE_PREFIX = "guardias-";
const PRECACHE_NAME = CACHE_PREFIX + "precarga-" + CACHE_VERSION;
const RUNTIME_NAME = CACHE_PREFIX + "estaticos-" + CACHE_VERSION;
const CURRENT_CACHES = [PRECACHE_NAME, RUNTIME_NAME];

const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];

/** Rutas con contenido inmutable o versionado: se sirven primero desde caché. */
const CACHE_FIRST_PREFIXES = ["/_next/static/", "/icons/"];
/** Límite de entradas de la caché de recursos estáticos (se borran las más antiguas). */
const RUNTIME_MAX_ENTRIES = 200;
/**
 * Lo guardado se busca solo por URL. Next.js responde con «Vary: rsc, next-router-…»
 * y el navegador agrega encabezados (Accept, etc.) que no cambian un recurso estático;
 * sin esta opción, la copia guardada podría no encontrarse justo cuando no hay red.
 */
const MATCH_OPTIONS = { ignoreVary: true };

const OFFLINE_FALLBACK_HTML =
  '<!doctype html><html lang="es-MX"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  "<title>Sin conexión</title></head>" +
  '<body style="margin:0;font-family:system-ui,sans-serif;background:#ffffff;color:#111827">' +
  '<main style="max-width:28rem;margin:0 auto;padding:3rem 1rem">' +
  '<h1 style="color:#14532d">Sin conexión</h1>' +
  "<p>No hay conexión a internet. Mientras tanto <strong>no se puede registrar ni confirmar</strong> " +
  "ninguna entrada o salida. Cuando vuelva la conexión, recarga la página.</p>" +
  "</main></body></html>";

function absoluteUrl(path) {
  return new URL(path, self.location.origin).href;
}

/**
 * Decide qué hacer con una solicitud.
 * @returns {"navigation" | "cache-first" | "precache-fallback" | null} null = no interceptar.
 */
function strategyFor(request) {
  if (request.method !== "GET") return null;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.origin !== self.location.origin) return null;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;

  if (request.mode === "navigate") return "navigation";

  // Solicitudes de herramientas de desarrollo que el navegador no permite responder.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return null;

  if (CACHE_FIRST_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return "cache-first";
  if (url.pathname === "/manifest.webmanifest") return "precache-fallback";
  return null;
}

/** Solo respuestas completas, del mismo origen y sin «no-store». */
function isCacheable(response) {
  if (!response || response.status !== 200) return false;
  if (response.type !== "basic" && response.type !== "default") return false;
  const cacheControl = response.headers.get("Cache-Control") || "";
  if (/no-store/i.test(cacheControl)) return false;
  const vary = response.headers.get("Vary") || "";
  return vary.trim() !== "*";
}

/** Una respuesta que siguió redirecciones no puede responder una navegación; se reconstruye. */
async function withoutRedirect(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function matchOwnCaches(request) {
  for (const name of CURRENT_CACHES) {
    const cache = await caches.open(name);
    const hit = await cache.match(request, MATCH_OPTIONS);
    if (hit) return hit;
  }
  return undefined;
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(keys[i]);
  }
}

async function putInRuntimeCache(request, response) {
  try {
    const cache = await caches.open(RUNTIME_NAME);
    await cache.put(request, response);
    await trimCache(cache, RUNTIME_MAX_ENTRIES);
  } catch {
    // Cuota llena u otro error de almacenamiento: la respuesta ya se entregó.
  }
}

/**
 * Hojas de estilo de /offline: se precargan para que la página se vea bien sin red.
 * Van en la caché de precarga (no en la de estáticos) para que el límite de
 * RUNTIME_MAX_ENTRIES nunca las borre.
 */
function staticStylesheetsIn(html) {
  const found = new Set();
  const pattern = /(?:href|src)="(\/_next\/static\/[^"#]+?\.css(?:\?[^"#]*)?)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) found.add(match[1]);
  return [...found];
}

async function precacheOfflineAssets(html) {
  const cache = await caches.open(PRECACHE_NAME);
  await Promise.all(
    staticStylesheetsIn(html).map(async (path) => {
      try {
        const url = absoluteUrl(path);
        const response = await fetch(new Request(url, { credentials: "omit" }));
        if (isCacheable(response)) await cache.put(url, response);
      } catch {
        // Mejor esfuerzo: sin estilos, /offline sigue siendo legible.
      }
    }),
  );
}

async function precache() {
  const cache = await caches.open(PRECACHE_NAME);
  let offlineHtml = "";
  await Promise.all(
    PRECACHE_URLS.map(async (path) => {
      const url = absoluteUrl(path);
      // Sin cookies: lo precargado nunca depende de la sesión del usuario.
      const response = await fetch(new Request(url, { cache: "reload", credentials: "omit" }));
      if (!response.ok) {
        throw new Error("No se pudo precargar " + path + " (" + response.status + ")");
      }
      const clean = await withoutRedirect(response);
      if (path === OFFLINE_URL) offlineHtml = await clean.clone().text();
      await cache.put(url, clean);
    }),
  );
  await precacheOfflineAssets(offlineHtml);
}

async function deleteOldCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.includes(name))
      .map((name) => caches.delete(name)),
  );
}

/** Navegación: red; si falla, la página /offline precargada. Nunca se guarda. */
async function networkWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(PRECACHE_NAME);
    const offline = await cache.match(absoluteUrl(OFFLINE_URL), MATCH_OPTIONS);
    if (offline) return offline;
    return new Response(OFFLINE_FALLBACK_HTML, {
      status: 503,
      statusText: "Sin conexion",
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

/** Recursos estáticos: caché primero; si no está, red y se guarda una copia. */
async function cacheFirst(event) {
  const request = event.request;
  const cached = await matchOwnCaches(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    event.waitUntil(putInRuntimeCache(request, response.clone()));
  }
  return response;
}

/** Manifiesto: red; sin red, la copia precargada. */
async function precacheFallback(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cache = await caches.open(PRECACHE_NAME);
    const cached = await cache.match(request, MATCH_OPTIONS);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precache();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await deleteOldCaches();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const strategy = strategyFor(event.request);
  if (strategy === "navigation") {
    event.respondWith(networkWithOfflineFallback(event.request));
  } else if (strategy === "cache-first") {
    event.respondWith(cacheFirst(event));
  } else if (strategy === "precache-fallback") {
    event.respondWith(precacheFallback(event.request));
  }
  // Cualquier otra solicitud (POST, /api/*, otros orígenes, datos de página)
  // sigue su curso normal: el service worker no la toca ni la guarda.
});
