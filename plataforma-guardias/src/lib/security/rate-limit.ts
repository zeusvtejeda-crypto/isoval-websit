/**
 * Límites de intentos fallidos en memoria (por instancia del servidor).
 * Complementan el límite de Supabase Auth, que ve a todas las personas con la IP
 * del servidor porque el inicio de sesión ocurre en una Server Action.
 * El almacén compartido entre instancias (Postgres) está en ./shared-limits.ts;
 * estos contadores en memoria son su respaldo si la base no responde.
 *
 * Diseño (para no permitir bloqueos dirigidos ni evasión):
 * - Cada intento se reserva (cuenta) ANTES de verificar la contraseña, así varias
 *   solicitudes simultáneas no pasan todas; acertar lo devuelve y un error del
 *   servicio de acceso lo reembolsa.
 * - Bloqueo estricto solo por la combinación IP + correo.
 * - Umbrales altos por IP (red compartida) y por correo (ataque distribuido).
 * - Acertar limpia la combinación y el correo, nunca la IP.
 * - La IP solo se toma de proxies de confianza (TRUSTED_PROXY_HOPS); una IPv6 se
 *   agrupa por su prefijo /64 (una conexión doméstica o de nube tiene millones).
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

  /**
   * Reserva un intento: si la clave está bloqueada devuelve la espera (ms) sin
   * contar nada; si no, lo cuenta (bloquea al llegar al máximo) y devuelve 0.
   */
  attempt(key: string, now = Date.now()): number {
    const wait = this.retryAfter(key, now);
    if (wait > 0) return wait;
    let e = this.entries.get(key);
    if (!e) {
      if (!this.makeRoom(now)) return 0;
      e = { failures: [], blockedUntil: 0 };
    }
    if (e.blockedUntil > 0) e = { failures: [], blockedUntil: 0 }; // bloqueo vencido: cuenta nueva
    e.failures = e.failures.filter((t) => now - t < this.windowMs);
    e.failures.push(now);
    if (e.failures.length >= this.maxFailures) e.blockedUntil = now + this.blockMs;
    this.entries.set(key, e);
    return 0;
  }

  /** Devuelve la última reserva (el intento no llegó a verificar la contraseña). */
  refund(key: string, now = Date.now()): void {
    const e = this.entries.get(key);
    if (!e || e.failures.length === 0) return;
    e.failures.pop();
    if (e.blockedUntil > now && e.failures.length < this.maxFailures) e.blockedUntil = 0;
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

/**
 * Sujeto de la IP para los límites: IPv4 tal cual (también la IPv4 dentro de una
 * IPv6 «::ffff:a.b.c.d») e IPv6 agrupada por su prefijo /64.
 */
export function ipSubject(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = raw.match(/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/) ?? raw.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  if (!raw.includes(":")) return raw;
  const [head, tail = ""] = raw.split("::");
  const left = head ? head.split(":") : [];
  const right = raw.includes("::") ? (tail ? tail.split(":") : []) : [];
  // Una IPv4 al final ocupa dos grupos; para el /64 solo importan los cuatro primeros.
  const rightGroups = right.flatMap((g) => (g.includes(".") ? ["0", "0"] : [g]));
  const groups = raw.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - rightGroups.length)).fill("0"), ...rightGroups] : left;
  if (groups.length < 4 || groups.slice(0, 4).some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return raw;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

export type LoginKeys = ReturnType<typeof loginKeys>;

/** Claves de un intento de inicio de sesión. */
export function loginKeys(ip: string | null, email: string) {
  const subject = ip ? ipSubject(ip) : null;
  return {
    pair: subject ? `pair:${subject}|${email}` : null,
    ip: subject ? `ip:${subject}` : null,
    email: `email:${email}`,
  };
}

/**
 * Reserva un intento de inicio de sesión (combinación y correo). Devuelve la
 * espera en ms si alguna clave (también la IP) está bloqueada; 0 = permitido.
 */
export function loginAttempt(keys: LoginKeys, now = Date.now()): number {
  const wait = Math.max(
    keys.pair ? pairLimiter.retryAfter(keys.pair, now) : 0,
    keys.ip ? ipLimiter.retryAfter(keys.ip, now) : 0,
    emailLimiter.retryAfter(keys.email, now),
  );
  if (wait > 0) return wait;
  if (keys.pair) pairLimiter.attempt(keys.pair, now);
  emailLimiter.attempt(keys.email, now);
  return 0;
}

/** Contraseña incorrecta: la IP se cuenta después (la combinación y el correo ya se reservaron). */
export function loginFailed(keys: LoginKeys, now = Date.now()): void {
  if (keys.ip) ipLimiter.fail(keys.ip, now);
}

/** Error del servicio de acceso (no de credenciales): se devuelve la reserva. */
export function loginRefund(keys: LoginKeys, now = Date.now()): void {
  if (keys.pair) pairLimiter.refund(keys.pair, now);
  emailLimiter.refund(keys.email, now);
}

export function loginSucceeded(keys: LoginKeys): void {
  if (keys.pair) pairLimiter.succeed(keys.pair);
  emailLimiter.succeed(keys.email);
  // La IP no se limpia: acertar con una cuenta propia no habilita más intentos contra otras.
}
