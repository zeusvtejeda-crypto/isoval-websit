import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  emailLimiter,
  ipLimiter,
  loginAttempt,
  loginFailed,
  loginRefund,
  loginSucceeded,
  pairLimiter,
  passwordChangeLimiter,
  type FailureLimiter,
  type LoginKeys,
} from "./rate-limit";

/**
 * Límite de intentos compartido entre instancias, guardado en Postgres
 * (app.rate_limits, solo accesible con la llave de servicio). Usa las mismas
 * reglas que los contadores en memoria, que se alimentan siempre pero solo se
 * consultan si la base no responde (entonces cada instancia limita por su cuenta).
 * Cada intento se reserva antes de verificar la contraseña (atómico en la base).
 * La base nunca recibe correos ni IP, solo una huella HMAC de cada clave.
 */
type Scope = "pair" | "ip" | "email" | "password";
type Item = { scope: Scope; key: string; limiter: FailureLimiter; reserve?: boolean };
type Rpc = "rate_limit_attempt" | "rate_limit_fail" | "rate_limit_refund" | "rate_limit_clear";

function fingerprint(key: string): string | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHmac("sha256", secret).update(key).digest("hex");
}

/** Llama al almacén compartido; null si no está disponible. */
async function callShared(fn: Rpc, items: Item[]): Promise<number | null> {
  if (items.length === 0) return 0;
  const payload = [];
  for (const i of items) {
    const key = fingerprint(i.key);
    if (!key) return null;
    payload.push(
      fn === "rate_limit_clear"
        ? { scope: i.scope, key }
        : { scope: i.scope, key, max: i.limiter.maxFailures, window_ms: i.limiter.windowMs, block_ms: i.limiter.blockMs, reserve: i.reserve ?? false },
    );
  }
  try {
    const { data, error } = await createAdminClient().rpc(fn, { p_items: payload });
    if (error) throw new Error(error.message);
    const n = Number(data ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch (error) {
    console.warn(`[límites] ${fn} no disponible; se usa el límite en memoria:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Combinación y correo se reservan; la IP sola solo se consulta (se cuenta tras un fallo). */
function loginItems(keys: LoginKeys): Item[] {
  const items: Item[] = [{ scope: "email", key: keys.email, limiter: emailLimiter, reserve: true }];
  if (keys.pair) items.push({ scope: "pair", key: keys.pair, limiter: pairLimiter, reserve: true });
  if (keys.ip) items.push({ scope: "ip", key: keys.ip, limiter: ipLimiter });
  return items;
}

const reserved = (items: Item[]) => items.filter((i) => i.reserve);

/**
 * Reserva un intento de inicio de sesión. Devuelve la espera en ms si está
 * bloqueado (sin contar nada) o 0 si puede verificar la contraseña.
 */
export async function reserveLoginAttempt(keys: LoginKeys): Promise<number> {
  const memory = loginAttempt(keys);
  const shared = await callShared("rate_limit_attempt", loginItems(keys));
  return shared ?? memory;
}

/** Contraseña incorrecta: cuenta el fallo de la IP (lo demás ya se reservó). */
export async function recordLoginFailure(keys: LoginKeys): Promise<void> {
  loginFailed(keys);
  await callShared(
    "rate_limit_fail",
    loginItems(keys).filter((i) => i.scope === "ip"),
  );
}

/** Error del servicio de acceso (429, 5xx o sin conexión): devuelve la reserva. */
export async function refundLoginAttempt(keys: LoginKeys): Promise<void> {
  loginRefund(keys);
  await callShared("rate_limit_refund", reserved(loginItems(keys)));
}

/** Acertar limpia la combinación IP + correo y el correo, nunca la IP. */
export async function recordLoginSuccess(keys: LoginKeys): Promise<void> {
  loginSucceeded(keys);
  await callShared("rate_limit_clear", reserved(loginItems(keys)));
}

function passwordItems(userId: string): Item[] {
  return [{ scope: "password", key: `pwd:${userId}`, limiter: passwordChangeLimiter, reserve: true }];
}

/** Reserva un intento con la contraseña actual al cambiarla (ms de espera o 0). */
export async function reservePasswordChange(userId: string): Promise<number> {
  const memory = passwordChangeLimiter.attempt(`pwd:${userId}`);
  const shared = await callShared("rate_limit_attempt", passwordItems(userId));
  return shared ?? memory;
}

export async function refundPasswordChange(userId: string): Promise<void> {
  passwordChangeLimiter.refund(`pwd:${userId}`);
  await callShared("rate_limit_refund", passwordItems(userId));
}

export async function recordPasswordChangeSuccess(userId: string): Promise<void> {
  passwordChangeLimiter.succeed(`pwd:${userId}`);
  await callShared("rate_limit_clear", passwordItems(userId));
}

/** ¿El error de Auth es del servicio (no de credenciales)? Entonces no cuenta como intento. */
export function isAuthServiceError(error: { status?: number } | null | undefined): boolean {
  if (!error) return false;
  const status = error.status ?? 0;
  return status === 0 || status === 429 || status >= 500;
}
