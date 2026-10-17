import { describe, expect, it } from "vitest";
import {
  GENERATED_PASSWORD_LENGTH,
  PASSWORD_ALPHABET,
  TEMP_PASSWORD_MAX,
  TEMP_PASSWORD_MIN,
  generateTemporaryPassword,
  secureRandomInt,
  temporaryPasswordIssue,
  type RandomSource,
} from "@/lib/admin/password";

/** Fuente determinista para probar el muestreo (no segura; solo pruebas). */
function sequence(values: number[]): RandomSource {
  let i = 0;
  return (array) => {
    for (let k = 0; k < array.length; k++) array[k] = values[i++ % values.length];
    return array;
  };
}

describe("generateTemporaryPassword", () => {
  it("genera la longitud por omisión con las cuatro clases de caracteres", () => {
    for (let n = 0; n < 200; n++) {
      const pw = generateTemporaryPassword();
      expect(pw).toHaveLength(GENERATED_PASSWORD_LENGTH);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).toMatch(/[-_.!?#%+=@]/);
      for (const ch of pw) expect(PASSWORD_ALPHABET).toContain(ch);
      expect(temporaryPasswordIssue(pw)).toBeNull();
    }
  });

  it("no usa caracteres ambiguos", () => {
    const sample = Array.from({ length: 300 }, () => generateTemporaryPassword()).join("");
    expect(sample).not.toMatch(/[0O1lI]/);
  });

  it("no repite contraseñas (aleatoriedad suficiente)", () => {
    const set = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(set.size).toBe(500);
  });

  it("respeta los límites de longitud", () => {
    expect(generateTemporaryPassword(TEMP_PASSWORD_MIN)).toHaveLength(TEMP_PASSWORD_MIN);
    expect(generateTemporaryPassword(40)).toHaveLength(40);
    expect(() => generateTemporaryPassword(TEMP_PASSWORD_MIN - 1)).toThrow();
    expect(() => generateTemporaryPassword(TEMP_PASSWORD_MAX + 1)).toThrow();
  });

  it("usa la fuente aleatoria inyectada", () => {
    const a = generateTemporaryPassword(16, sequence([7, 3, 11, 5, 2]));
    const b = generateTemporaryPassword(16, sequence([7, 3, 11, 5, 2]));
    expect(a).toBe(b);
  });
});

describe("secureRandomInt", () => {
  it("devuelve valores dentro del intervalo", () => {
    for (let i = 0; i < 1000; i++) {
      const v = secureRandomInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it("descarta valores que producirían sesgo (muestreo por rechazo)", () => {
    // 2^32 - 1 está por encima del límite para max = 10 y se descarta.
    expect(secureRandomInt(10, sequence([0xffffffff, 23]))).toBe(3);
  });

  it("rechaza intervalos inválidos", () => {
    expect(() => secureRandomInt(0)).toThrow();
    expect(() => secureRandomInt(1.5)).toThrow();
  });
});

describe("temporaryPasswordIssue", () => {
  it("exige al menos 12 caracteres", () => {
    expect(temporaryPasswordIssue("corta")).toMatch(/al menos 12/);
    expect(temporaryPasswordIssue(undefined)).toMatch(/al menos 12/);
    expect(temporaryPasswordIssue("Abcdefgh-123")).toBeNull();
  });

  it("rechaza espacios en los extremos, repetitivas y demasiado largas", () => {
    expect(temporaryPasswordIssue(" Abcdefgh-123")).toMatch(/espacios/);
    expect(temporaryPasswordIssue("aaaaaaaaaaaaaa")).toMatch(/repetitiva/);
    expect(temporaryPasswordIssue("Ab3-".repeat(19))).toMatch(/72/);
  });
});
