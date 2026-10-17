/**
 * Valida el destino interno tras iniciar sesión (?next=). Evita redirecciones
 * abiertas: rechaza caracteres de control (el navegador elimina \t \r \n y
 * convertiría "/\t/evil.com" en "//evil.com"), barras invertidas y cualquier
 * valor cuyo origen resuelto no sea el propio.
 */
export function safeNextPath(next: unknown): string | null {
  const value = typeof next === "string" ? next : "";
  if (!value.startsWith("/") || value.length > 512) return null;
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return null;
  try {
    const base = new URL("http://app.invalid");
    const url = new URL(value, base);
    if (url.origin !== base.origin) return null;
    if (url.pathname.startsWith("//")) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
