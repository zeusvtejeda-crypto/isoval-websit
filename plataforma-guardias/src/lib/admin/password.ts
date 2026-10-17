/**
 * Contraseñas temporales (lógica pura).
 * Se generan con `crypto.getRandomValues` (Web Crypto, disponible en Node y en
 * el navegador) y muestreo por rechazo para no introducir sesgo.
 */

export const TEMP_PASSWORD_MIN = 12;
/** bcrypt (Supabase Auth) solo considera los primeros 72 bytes. */
export const TEMP_PASSWORD_MAX = 72;
export const GENERATED_PASSWORD_LENGTH = 16;

// Sin caracteres que se confunden al dictarlos o copiarlos (0/O, 1/l/I).
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "-_.!?#%+=@";
export const PASSWORD_ALPHABET = LOWER + UPPER + DIGITS + SYMBOLS;
const GROUPS = [LOWER, UPPER, DIGITS, SYMBOLS] as const;

/** Llena el arreglo con valores aleatorios criptográficamente seguros. */
export type RandomSource = (array: Uint32Array) => Uint32Array;

const defaultSource: RandomSource = (array) => {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("No hay un generador aleatorio seguro disponible.");
  }
  return c.getRandomValues(array);
};

/** Entero uniforme en [0, max) sin sesgo de módulo. */
export function secureRandomInt(max: number, source: RandomSource = defaultSource): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new Error("Intervalo inválido.");
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  // Muestreo por rechazo (en la práctica casi nunca repite).
  for (let i = 0; i < 1000; i++) {
    source(buf);
    const v = buf[0];
    if (v < limit) return v % max;
  }
  throw new Error("El generador aleatorio no produjo valores válidos.");
}

/**
 * Genera una contraseña temporal con al menos una minúscula, una mayúscula,
 * un dígito y un símbolo.
 */
export function generateTemporaryPassword(length = GENERATED_PASSWORD_LENGTH, source: RandomSource = defaultSource): string {
  if (!Number.isInteger(length) || length < TEMP_PASSWORD_MIN || length > TEMP_PASSWORD_MAX) {
    throw new Error(`La longitud debe estar entre ${TEMP_PASSWORD_MIN} y ${TEMP_PASSWORD_MAX}.`);
  }
  const chars: string[] = GROUPS.map((g) => g[secureRandomInt(g.length, source)]);
  while (chars.length < length) chars.push(PASSWORD_ALPHABET[secureRandomInt(PASSWORD_ALPHABET.length, source)]);
  // Fisher–Yates con el mismo generador seguro.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1, source);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Problemas de una contraseña temporal capturada a mano (vacío = válida). */
export function temporaryPasswordIssue(password: string | null | undefined): string | null {
  const value = password ?? "";
  if (value.length < TEMP_PASSWORD_MIN) return `La contraseña temporal debe tener al menos ${TEMP_PASSWORD_MIN} caracteres.`;
  if (new TextEncoder().encode(value).length > TEMP_PASSWORD_MAX) return `La contraseña temporal no puede superar ${TEMP_PASSWORD_MAX} caracteres.`;
  if (value.trim() !== value) return "La contraseña no debe empezar ni terminar con espacios.";
  if (new Set(value).size < 4) return "La contraseña es demasiado repetitiva; usa más caracteres distintos.";
  // Política de Supabase Auth del proyecto (config.toml / panel): minúsculas, mayúsculas y dígitos.
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    return "La contraseña temporal debe incluir minúsculas, mayúsculas y al menos un número.";
  }
  return null;
}
