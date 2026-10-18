import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { buildContentSecurityPolicy, createNonce } from "@/lib/csp";
import { AUTH_COOKIE_OPTIONS, asBrowserSessionCookie } from "@/lib/supabase/cookies";

/**
 * Renueva la sesión de Supabase en cada solicitud, fija la CSP con nonce y
 * redirige a /login las rutas privadas sin sesión. La autorización real ocurre
 * en el servidor (DAL) y en la base de datos (RLS); esto solo mejora la experiencia.
 */
const PUBLIC_PREFIXES = [
  "/",
  "/directorio",
  "/login",
  "/aviso-de-privacidad",
  "/offline",
];

/**
 * Páginas públicas sin sesión ni datos: la página sin conexión (la guarda el
 * service worker) y la de sin acceso. No se renueva la sesión en ellas (nunca
 * llevan Set-Cookie) y usan la CSP sin nonce, que también sirve si se
 * prerenderizan (su HTML no puede llevar nonce). Si una empieza a leer la
 * sesión, quítala de aquí.
 */
const STATIC_ROUTES = ["/offline", "/sin-acceso"];

function isPublic(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => p !== "/" && (pathname === p || pathname.startsWith(p + "/")));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (STATIC_ROUTES.includes(pathname)) {
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", buildContentSecurityPolicy(null));
    return response;
  }

  // Next lee el nonce del encabezado CSP de la solicitud y lo pone en sus scripts.
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce);
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    const next = NextResponse.next({ request: { headers } });
    next.headers.set("Content-Security-Policy", csp);
    return next;
  };

  let response = forward();
  // Encabezados anticaché que @supabase/ssr pide junto con las cookies de sesión.
  let cookieHeaders: Record<string, string> = {};

  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // request.cookies actualiza el encabezado Cookie que reciben las páginas.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = forward();
        for (const cookie of cookiesToSet) {
          const { name, value, options } = asBrowserSessionCookie(cookie);
          response.cookies.set(name, value, options);
        }
        cookieHeaders = { ...cookieHeaders, ...headers };
        for (const [key, value] of Object.entries(cookieHeaders)) response.headers.set(key, value);
      },
    },
  });

  // getClaims valida el JWT; no confiar en getSession() del lado servidor.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);

  if (!isAuthenticated && !isPublic(pathname) && !pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Conserva la consulta (p. ej. el código QR de /registro/qr?c=…).
    url.search = "";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(url);
    // La redirección lleva las cookies renovadas o borradas (p. ej. una sesión
    // vencida) y los encabezados anticaché que las acompañan.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    for (const [key, value] of Object.entries(cookieHeaders)) redirect.headers.set(key, value);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    // Excluye estáticos, imágenes, manifest, service worker e íconos.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|leaflet/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
