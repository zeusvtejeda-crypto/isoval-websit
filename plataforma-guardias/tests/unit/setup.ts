import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// "server-only" lanza error fuera de un Server Component; en pruebas se neutraliza.
vi.mock("server-only", () => ({}));

// Vitest corre sin globals: Testing Library no limpia el DOM por sí sola.
afterEach(() => {
  cleanup();
});
