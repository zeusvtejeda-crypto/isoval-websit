import { describe, expect, it } from "vitest";
import {
  dayRangeUtc,
  formatDuration,
  formatShiftRange,
  formatTime,
  localInputToUtc,
  utcToLocalInput,
} from "@/lib/time";

describe("zonas horarias", () => {
  it("convierte hora local de Mazatlán a UTC y de regreso", () => {
    const utc = localInputToUtc("2026-10-17T22:00", "America/Mazatlan");
    expect(utc.toISOString()).toBe("2026-10-18T05:00:00.000Z");
    expect(utcToLocalInput(utc, "America/Mazatlan")).toBe("2026-10-17T22:00");
  });

  it("muestra la misma hora UTC distinta según la sede (Bahía de Banderas usa hora del centro)", () => {
    const t = "2026-10-18T05:00:00Z";
    expect(formatTime(t, "America/Mazatlan")).toBe("22:00");
    expect(formatTime(t, "America/Bahia_Banderas")).toBe("23:00");
  });

  it("indica cuando la guardia termina al día siguiente", () => {
    const range = formatShiftRange("2026-10-18T05:00:00Z", "2026-10-18T13:00:00Z", "America/Mazatlan");
    expect(range).toContain("22:00 – 06:00");
    expect(range).toContain("+1 día");
  });

  it("calcula el rango UTC de un día local", () => {
    const { start, end } = dayRangeUtc("2026-10-17", "America/Mazatlan");
    expect(start.toISOString()).toBe("2026-10-17T07:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-18T07:00:00.000Z");
  });

  it("rechaza formatos inválidos", () => {
    expect(() => localInputToUtc("17/10/2026 22:00", "America/Mazatlan")).toThrow();
  });
});

describe("formatDuration", () => {
  it("formatea minutos", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(205)).toBe("3 h 25 min");
    expect(formatDuration(-30)).toBe("−30 min");
    expect(formatDuration(null)).toBe("—");
  });
});
