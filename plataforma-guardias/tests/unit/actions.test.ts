import { describe, expect, it } from "vitest";
import { friendlyDbError } from "@/lib/actions";

describe("friendlyDbError", () => {
  it("oculta mensajes nativos de Postgres", () => {
    expect(friendlyDbError({ code: "42501", message: 'new row violates row-level security policy for table "workers"' })).toBe(
      "No tienes permiso para realizar esta acción.",
    );
    expect(friendlyDbError({ code: "23505", message: 'duplicate key value violates unique constraint "x"' })).toBe("El registro ya existe (duplicado).");
  });

  it("respeta mensajes propios aunque no lleven acentos", () => {
    expect(friendlyDbError({ code: "23514", message: "Debe existir al menos un administrador activo" })).toBe(
      "Debe existir al menos un administrador activo",
    );
    expect(friendlyDbError({ code: "23505", message: "Ya existe una solicitud pendiente para ese registro" })).toBe(
      "Ya existe una solicitud pendiente para ese registro",
    );
    expect(friendlyDbError({ code: "42501", message: "No tienes permiso para registrar esta asistencia" })).toBe(
      "No tienes permiso para registrar esta asistencia",
    );
  });

  it("traduce restricciones conocidas", () => {
    expect(friendlyDbError({ code: "23505", message: 'duplicate key value violates unique constraint "facility_categories_slug_key"' })).toMatch(/identificador/);
    expect(friendlyDbError({ code: "23514", message: 'new row for relation "shifts" violates check constraint "shifts_time_order"' })).toBe(
      "El término debe ser posterior al inicio.",
    );
    expect(friendlyDbError({ code: "23P01", message: "conflicting key value violates exclusion constraint" })).toMatch(/traslapa/);
  });

  it("usa el mensaje por omisión ante errores desconocidos", () => {
    expect(friendlyDbError({ code: "XX000", message: "could not serialize access" })).toBe("No se pudo completar la operación.");
    expect(friendlyDbError(null, "Falla")).toBe("Falla");
  });
});
