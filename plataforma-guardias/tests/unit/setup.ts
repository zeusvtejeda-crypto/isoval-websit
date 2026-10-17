import "@testing-library/jest-dom/vitest";
// "server-only" lanza error fuera de un Server Component; en pruebas se neutraliza.
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
