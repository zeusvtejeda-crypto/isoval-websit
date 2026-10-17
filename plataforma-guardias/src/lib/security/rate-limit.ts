/**
 * Límite simple de intentos fallidos en memoria (por instancia del servidor).
 * Complementa el límite de Supabase Auth, que ve a todas las personas con la IP
 * del servidor porque el inicio de sesión ocurre en una Server Action.
 * En despliegues con varias instancias conviene un almacén compartido (p. ej. Redis).
 */
type Entry = { failures: number[]; blockedUntil: number };

export class FailureLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly blockMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Milisegundos restantes de bloqueo (0 si puede intentar). */
  retryAfter(key: string, now = Date.now()): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    return e.blockedUntil > now ? e.blockedUntil - now : 0;
  }

  fail(key: string, now = Date.now()): void {
    if (this.entries.size >= this.maxKeys && !this.entries.has(key)) {
      // Evita crecer sin límite: descarta la entrada más antigua.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const e = this.entries.get(key) ?? { failures: [], blockedUntil: 0 };
    e.failures = e.failures.filter((t) => now - t < this.windowMs);
    e.failures.push(now);
    if (e.failures.length >= this.maxFailures) {
      e.blockedUntil = now + this.blockMs;
      e.failures = [];
    }
    this.entries.set(key, e);
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }
}

/** 8 fallos en 15 minutos bloquean 15 minutos. */
export const loginLimiter = new FailureLimiter(8, 15 * 60_000, 15 * 60_000);

/** IP del cliente desde cabeceras del proxy (primer valor de x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "desconocida";
}
