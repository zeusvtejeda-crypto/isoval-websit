import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  emailLimiter,
  ipLimiter,
  loginFailed,
  loginRetryAfter,
  loginSucceeded,
  pairLimiter,
  passwordChangeLimiter,
  type FailureLimiter,
  type LoginKeys,
} from "./rate-limit";

/**
 * Límite de intentos compartido entre instancias, guardado en Postgres
 * (app.rate_limits, solo accesible con la llave de servicio). Usa las mismas
 * reglas que los contadores en memoria, que se siguen alimentando como
 * respaldo: si la base no responde, cada instancia limita por su cuenta.
 * La base nunca recibe correos ni IP, solo una huella HMAC de cada clave.
 */
type Scope = "pair" | "ip" | "email" | "password";
type Item = { scope: Scope; key: string; limiter: FailureLimiter };
type Rpc = "rate_limit_retry_after" | "rate_limit_fail" | "rate_limit_clear";

function fingerprint(key: string): string | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHmac("sha256", secret).update(key).digest("hex");
}

async function callShared(fn: Rpc, items: Item[], withRules = false): Promise<number | null> {
  const payload = [];
  for (const i of items) {
    const key = fingerprint(i.key);
    if (!key) return null;
    payload.push(
      withRules
        ? { scope: i.scope, key, max: i.limiter.maxFailures, window_ms: i.limiter.windowMs, block_ms: i.limiter.blockMs }
        : { scope: i.scope, key },
    );
  }
  try {
    const { data, error } = await createAdminClient().rpc(fn, { p_items: payload });
    if (error) throw new Error(error.message);
    return typeof data === "number" ? data : 0;
  } catch (error) {
    // Sin almacén compartido se usa el límite en memoria de esta instancia.
    console.warn(`[límites] ${fn} no disponible; se usa el límite en memoria:`, error instanceof Error ? error.message : error);
    return null;
  }
}

function loginItems(keys: LoginKeys): Item[] {
  const items: Item[] = [{ scope: "email", key: keys.email, limiter: emailLimiter }];
  if (keys.pair) items.push({ scope: "pair", key: keys.pair, limiter: pairLimiter });
  if (keys.ip) items.push({ scope: "ip", key: keys.ip, limiter: ipLimiter });
  return items;
}

/** Milisegundos de espera antes de otro intento de inicio de sesión (0 = permitido). */
export async function loginWait(keys: LoginKeys): Promise<number> {
  const shared = await callShared("rate_limit_retry_after", loginItems(keys));
  return Math.max(shared ?? 0, loginRetryAfter(keys));
}

export async function recordLoginFailure(keys: LoginKeys): Promise<void> {
  loginFailed(keys);
  await callShared("rate_limit_fail", loginItems(keys), true);
}

/** Acertar limpia la combinación IP + correo y el correo, nunca la IP. */
export async function recordLoginSuccess(keys: LoginKeys): Promise<void> {
  loginSucceeded(keys);
  await callShared("rate_limit_clear", loginItems(keys).filter((i) => i.scope !== "ip"));
}

function passwordItem(userId: string): Item[] {
  return [{ scope: "password", key: `pwd:${userId}`, limiter: passwordChangeLimiter }];
}

/** Espera antes de otro intento con la contraseña actual al cambiarla (ms). */
export async function passwordChangeWait(userId: string): Promise<number> {
  const shared = await callShared("rate_limit_retry_after", passwordItem(userId));
  return Math.max(shared ?? 0, passwordChangeLimiter.retryAfter(`pwd:${userId}`));
}

export async function recordPasswordChangeFailure(userId: string): Promise<void> {
  passwordChangeLimiter.fail(`pwd:${userId}`);
  await callShared("rate_limit_fail", passwordItem(userId), true);
}

export async function recordPasswordChangeSuccess(userId: string): Promise<void> {
  passwordChangeLimiter.succeed(`pwd:${userId}`);
  await callShared("rate_limit_clear", passwordItem(userId));
}
