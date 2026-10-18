/**
 * Límites de intentos fallidos en memoria (por instancia del servidor).
 * Complementan el límite de Supabase Auth, que ve a todas las personas con la IP
 * del servidor porque el inicio de sesión ocurre en una Server Action.
 * El almacén compartido entre instancias (Postgres) está en ./shared-limits.ts;
 * estos contadores en memoria son su respaldo si la base no responde.
 *
 * Diseño (para no permitir bloqueos dirigidos ni evasión):
 * - Bloqueo estricto solo por la combinación IP + correo.
 * - Umbrales altos por IP (red compartida) y por correo (ataque distribuido).
 * - Acertar limpia la combinación y el correo, nunca la IP.
 * - La IP solo se toma de proxies de confianza (TRUSTED_PROXY_HOPS).
 */
type Entry = { failures: number[]; blockedUntil: number };

export class FailureLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    readonly maxFailures: number,
    readonly windowMs: number,
    readonly blockMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** Milisegundos restantes de bloqueo (0 si puede intentar). */
  retryAfter(key: string, now = Date.now()): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    return e.blockedUntil > now ? e.blockedUntil - now : 0;
  }

  /** Libera espacio sin soltar nunca un bloqueo vigente. Devuelve false si no hay lugar. */
  private makeRoom(now: number): boolean {
    if (this.entries.size < this.maxKeys) return true;
    // 1) entradas vencidas (sin bloqueo vigente ni fallos recientes)
    for (const [k, e] of this.entries) {
      if (e.blockedUntil <= now && e.failures.every((t) => now - t >= this.windowMs)) this.entries.delete(k);
    }
    if (this.entries.size < this.maxKeys) return true;
    // 2) la más antigua sin bloqueo vigente
    for (const [k, e] of this.entries) {
      if (e.blockedUntil <= now) {
        this.entries.delete(k);
        return true;
      }
    }
    return false; // todo son bloqueos vigentes: no se rastrea la clave nueva
  }

  fail(key: string, now = Date.now()): void {
    let e = this.entries.get(key);
    if (!e) {
      if (!this.makeRoom(now)) return;
      e = { failures: [], blockedUntil: 0 };
    }
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

const MIN = 60_000;
/** IP + correo: 8 fallos en 15 min bloquean 15 min. */
export const pairLimiter = new FailureLimiter(8, 15 * MIN, 15 * MIN);
/** IP (puede ser una red compartida): 60 fallos en 15 min. */
export const ipLimiter = new FailureLimiter(60, 15 * MIN, 15 * MIN);
/** Correo (ataque distribuido contra una cuenta): 30 fallos en 15 min. */
export const emailLimiter = new FailureLimiter(30, 15 * MIN, 15 * MIN);
/** Verificación de la contraseña actual al cambiarla: 5 fallos en 15 min por cuenta. */
export const passwordChangeLimiter = new FailureLimiter(5, 15 * MIN, 15 * MIN);

/**
 * IP del cliente. Solo se confía en x-forwarded-for si TRUSTED_PROXY_HOPS > 0
 * (número de proxies propios delante de la app): se toma la entrada que agregó
 * el proxy de confianza más externo. Si no, x-real-ip (la fija la plataforma).
 * Devuelve null si no hay un dato confiable.
 */
export function clientIp(headers: Headers, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)): string | null {
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (Number.isInteger(hops) && hops > 0 && chain.length >= hops) return chain[chain.length - hops];
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}

export type LoginKeys = ReturnType<typeof loginKeys>;

/** Claves de un intento de inicio de sesión. */
export function loginKeys(ip: string | null, email: string) {
  return {
    pair: ip ? `pair:${ip}|${email}` : null,
    ip: ip ? `ip:${ip}` : null,
    email: `email:${email}`,
  };
}

/** Milisegundos de espera antes de permitir otro intento (0 = permitido). */
export function loginRetryAfter(keys: ReturnType<typeof loginKeys>, now = Date.now()): number {
  return Math.max(
    keys.pair ? pairLimiter.retryAfter(keys.pair, now) : 0,
    keys.ip ? ipLimiter.retryAfter(keys.ip, now) : 0,
    emailLimiter.retryAfter(keys.email, now),
  );
}

export function loginFailed(keys: ReturnType<typeof loginKeys>, now = Date.now()): void {
  if (keys.pair) pairLimiter.fail(keys.pair, now);
  if (keys.ip) ipLimiter.fail(keys.ip, now);
  emailLimiter.fail(keys.email, now);
}

export function loginSucceeded(keys: ReturnType<typeof loginKeys>): void {
  if (keys.pair) pairLimiter.succeed(keys.pair);
  emailLimiter.succeed(keys.email);
  // La IP no se limpia: acertar con una cuenta propia no habilita más intentos contra otras.
}
