import { describe, expect, it } from "vitest";
import { isValidTimezone } from "@/lib/time";
import {
  MEXICO_TIMEZONES,
  buildSearchPattern,
  categoryActiveSchema,
  categoryDeleteSchema,
  categoryFormSchema,
  changedFields,
  checkCoordinates,
  compatibleUnitKeys,
  defaultTimezoneFor,
  facilitiesHref,
  facilityFormSchema,
  isHttpUrl,
  matchMexicoTimezone,
  needsReasonReset,
  normalizeText,
  pageRange,
  parseDateText,
  parseDecimalText,
  parseFacilityFilters,
  parseServices,
  readCategoryForm,
  readFacilityForm,
  slugify,
  totalPages,
  unitKeyKey,
} from "@/lib/validation/facility";

describe("normalización", () => {
  it("normalizeText refleja app.normalize_text", () => {
    expect(normalizeText("  Clínica   MÉDICA  Ñandú ")).toBe("clinica medica nandu");
    expect(normalizeText(null)).toBe("");
  });
  it("clave de unidad y slug", () => {
    expect(unitKeyKey("  nay-01 ")).toBe("NAY-01");
    expect(unitKeyKey("   ")).toBeNull();
    expect(slugify("Unidades de Medicina Familiar (Nivel 1)")).toBe("unidades-de-medicina-familiar-nivel-1");
    expect(slugify("Oficinas Ádministrativas")).toBe("oficinas-administrativas");
  });
  it("mismo nombre y lugar: solo es la misma unidad si alguna no tiene clave o coinciden", () => {
    expect(compatibleUnitKeys("NTIMS000721", "NTIMS001235")).toBe(false);
    expect(compatibleUnitKeys(" ntims000721 ", "NTIMS000721")).toBe(true);
    expect(compatibleUnitKeys(null, "NTIMS001235")).toBe(true);
    expect(compatibleUnitKeys("NTIMS000721", "  ")).toBe(true);
    expect(compatibleUnitKeys(undefined, null)).toBe(true);
  });
  it("servicios: uno por línea, sin vacíos ni repetidos", () => {
    expect(parseServices("Urgencias\n\n - Farmacia\r\nurgencias\n  Laboratorio  ")).toEqual(["Urgencias", "Farmacia", "Laboratorio"]);
    expect(parseServices("A; B | C", { allowInlineSeparators: true })).toEqual(["A", "B", "C"]);
    expect(parseServices("A; B")).toEqual(["A; B"]);
  });
  it("decimales con coma o signo menos tipográfico", () => {
    expect(parseDecimalText("21,5")).toBe(21.5);
    expect(parseDecimalText("−104.9")).toBe(-104.9);
    expect(parseDecimalText("1e3")).toBeNull();
    expect(parseDecimalText("")).toBeNull();
  });
});

describe("coordenadas, fechas y URL", () => {
  it("dentro de México y en pareja", () => {
    expect(checkCoordinates(null, null)).toEqual({ ok: true, latitude: null, longitude: null });
    expect(checkCoordinates(21.5, -104.9)).toEqual({ ok: true, latitude: 21.5, longitude: -104.9 });
    expect(checkCoordinates(14, -86).ok).toBe(true);
    expect(checkCoordinates(33, -119).ok).toBe(true);
    expect(checkCoordinates(13.9, -100)).toMatchObject({ ok: false, field: "latitude" });
    expect(checkCoordinates(20, -85.9)).toMatchObject({ ok: false, field: "longitude" });
    expect(checkCoordinates(20, null)).toMatchObject({ ok: false, field: "longitude" });
    expect(checkCoordinates(-104.9, 21.5)).toMatchObject({ ok: false, message: expect.stringMatching(/invertidas/) });
  });
  it("fechas en varios formatos", () => {
    expect(parseDateText("2026-10-05")).toBe("2026-10-05");
    expect(parseDateText("5/10/2026")).toBe("2026-10-05");
    expect(parseDateText("2026-10-05T00:00:00.000Z")).toBe("2026-10-05");
    expect(parseDateText("2026-02-30")).toBeNull();
    expect(parseDateText("ayer")).toBeNull();
  });
  it("solo URL http(s)", () => {
    expect(isHttpUrl("https://www.gob.mx/fuente")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("www.gob.mx")).toBe(false);
  });
});

describe("zonas horarias", () => {
  it("todas las zonas de la lista son válidas", () => {
    for (const t of MEXICO_TIMEZONES) expect(isValidTimezone(t.value)).toBe(true);
  });
  it("por omisión: municipio, luego estado, luego respaldo", () => {
    expect(defaultTimezoneFor("America/Mazatlan", "America/Bahia_Banderas")).toBe("America/Bahia_Banderas");
    expect(defaultTimezoneFor("America/Monterrey", null)).toBe("America/Monterrey");
    expect(defaultTimezoneFor("Europe/Madrid")).toBe("America/Mazatlan");
  });
  it("coincidencia sin distinguir mayúsculas", () => {
    expect(matchMexicoTimezone(" america/mexico city ")).toBe("America/Mexico_City");
    expect(matchMexicoTimezone("America/Bogota")).toBeNull();
  });
});

function facilityFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const values: Record<string, string> = {
    official_name: "Hospital General de Prueba",
    category_id: "1",
    state_id: "18",
    municipality_id: "17",
    source: "Portal oficial",
    verification_status: "pendiente",
    timezone: "America/Mazatlan",
    arrival_tolerance_minutes: "10",
    services: "Urgencias\nFarmacia",
    is_public: "1",
    active: "1",
    ...overrides,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

describe("formulario de instalación", () => {
  const schema = facilityFormSchema("2026-10-17");

  it("acepta un alta válida y normaliza", () => {
    const r = schema.safeParse(readFacilityForm(facilityFormData({ latitude: "21,5", longitude: "-104.9", unit_key: "  NAY  01 " })));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({
      official_name: "Hospital General de Prueba",
      unit_key: "NAY 01",
      latitude: 21.5,
      longitude: -104.9,
      services: ["Urgencias", "Farmacia"],
      is_public: true,
      active: true,
      is_demo: false,
      services_verified: false,
    });
  });

  it("exige la fuente, coordenadas en pareja y dentro de México", () => {
    const errorsOf = (fd: FormData) => {
      const r = schema.safeParse(readFacilityForm(fd));
      return r.success ? [] : r.error.issues.map((i) => String(i.path[0]));
    };
    expect(errorsOf(facilityFormData({ source: "" }))).toContain("source");
    expect(errorsOf(facilityFormData({ latitude: "21.5" }))).toContain("longitude");
    expect(errorsOf(facilityFormData({ latitude: "45", longitude: "-100" }))).toContain("latitude");
    expect(errorsOf(facilityFormData({ latitude: "abc", longitude: "-100" }))).toContain("latitude");
  });

  it("exige el municipio", () => {
    const fd = facilityFormData();
    fd.delete("municipality_id");
    const missing = schema.safeParse(readFacilityForm(fd));
    expect(missing.success).toBe(false);
    expect(missing.error?.issues).toEqual([expect.objectContaining({ path: ["municipality_id"], message: "Elige el municipio." })]);
    expect(schema.safeParse(readFacilityForm(facilityFormData({ municipality_id: "abc" }))).success).toBe(false);
  });

  it("verificada exige fecha y no admite fechas futuras", () => {
    const missing = schema.safeParse(readFacilityForm(facilityFormData({ verification_status: "verificado" })));
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.some((i) => i.path[0] === "last_verified_at")).toBe(true);
    const future = schema.safeParse(readFacilityForm(facilityFormData({ verification_status: "verificado", last_verified_at: "2026-10-18" })));
    expect(future.success).toBe(false);
    const ok = schema.safeParse(readFacilityForm(facilityFormData({ verification_status: "verificado", last_verified_at: "2026-10-17" })));
    expect(ok.success).toBe(true);
  });

  it("zona horaria de México, tolerancia 0–240 y motivo obligatorio al editar", () => {
    expect(schema.safeParse(readFacilityForm(facilityFormData({ timezone: "Europe/Madrid" }))).success).toBe(false);
    expect(schema.safeParse(readFacilityForm(facilityFormData({ arrival_tolerance_minutes: "241" }))).success).toBe(false);
    expect(schema.safeParse(readFacilityForm(facilityFormData({ arrival_tolerance_minutes: "-1" }))).success).toBe(false);
    const id = "f0000000-0000-4000-8000-00000000000a";
    const noReason = schema.safeParse(readFacilityForm(facilityFormData({ id })));
    expect(noReason.success).toBe(false);
    expect(noReason.error?.issues[0].path[0]).toBe("change_reason");
    expect(schema.safeParse(readFacilityForm(facilityFormData({ id, change_reason: "Actualización de horario" }))).success).toBe(true);
  });

  it("servicios verificados requieren al menos un servicio", () => {
    const r = schema.safeParse(readFacilityForm(facilityFormData({ services: "", services_verified: "1" })));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path[0]).toBe("services");
  });
});

describe("cambios y motivo para la bitácora", () => {
  it("detecta solo los campos que cambian (servicios por elemento, null = undefined)", () => {
    const current = { official_name: "Hospital", latitude: 21.5, services: ["A", "B"], notes: null, phone: undefined, extra: "no se compara" };
    expect(changedFields(current, { official_name: "Hospital", latitude: 21.5, services: ["A", "B"], notes: null, phone: null })).toEqual([]);
    expect(changedFields(current, { official_name: "Hospital", latitude: 21.6, services: ["B", "A"], notes: "Nota", phone: null })).toEqual([
      "latitude",
      "services",
      "notes",
    ]);
  });

  it("un motivo repetido exige limpiar el guardado (app.touch_row lo borraría)", () => {
    expect(needsReasonReset("Importación: instalaciones.csv", "Importación: instalaciones.csv")).toBe(true);
    expect(needsReasonReset("Alta de instalación", "Corrección de horario")).toBe(false);
    expect(needsReasonReset(null, "Corrección de horario")).toBe(false);
    expect(needsReasonReset(null, null)).toBe(false);
  });
});

describe("formulario de categoría", () => {
  it("activar/desactivar solo acepta 1 o 0, con motivo", () => {
    const reason = "Categoría duplicada";
    expect(categoryActiveSchema.safeParse({ category_id: "3", active: "0", reason }).success).toBe(true);
    expect(categoryActiveSchema.safeParse({ category_id: "3", active: "si", reason }).success).toBe(false);
    expect(categoryActiveSchema.safeParse({ category_id: "x", active: "1", reason }).success).toBe(false);
    const noReason = categoryActiveSchema.safeParse({ category_id: "3", active: "0" });
    expect(noReason.success).toBe(false);
    if (!noReason.success) expect(noReason.error.issues[0].path).toEqual(["reason"]);
  });

  it("eliminar exige confirmación y motivo", () => {
    expect(categoryDeleteSchema.safeParse({ category_id: "3", confirm: "ELIMINAR", reason: "Creada por error" }).success).toBe(true);
    const r = categoryDeleteSchema.safeParse({ category_id: "3", confirm: "ELIMINAR", reason: "abc" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["reason"]);
  });

  function fd(values: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.set(k, v);
    return f;
  }
  it("genera el slug del nombre y normaliza el color", () => {
    const r = categoryFormSchema.safeParse(readCategoryForm(fd({ name: "Guarderías", icon: "baby", color: "#14532D", active: "1" })));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({ name: "Guarderías", slug: "guarderias", color: "#14532d", sort_order: 100, active: true });
    // En un alta sin motivo se registra uno por omisión.
    expect(r.data.reason).toBe("Alta de categoría");
  });
  it("al editar exige el motivo del cambio", () => {
    const base = { id: "4", name: "Guarderías", icon: "baby", color: "#14532D", active: "1" };
    const missing = categoryFormSchema.safeParse(readCategoryForm(fd(base)));
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues.map((i) => i.path[0])).toEqual(["reason"]);
    const ok = categoryFormSchema.safeParse(readCategoryForm(fd({ ...base, reason: "Cambio de nombre oficial" })));
    expect(ok.success && ok.data.reason).toBe("Cambio de nombre oficial");
  });
  it("rechaza slug inválido, icono fuera de la lista y color inválido", () => {
    const r = categoryFormSchema.safeParse(readCategoryForm(fd({ name: "X1", slug: "Con Espacios", icon: "rocket", color: "verde" })));
    expect(r.success).toBe(false);
    const paths = r.error?.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["slug", "icon", "color"]));
  });
});

describe("filtros de la lista", () => {
  it("lee la URL, ignora valores inválidos y reconstruye el enlace", () => {
    const f = parseFacilityFilters({ q: "  umf  tepic ", categoria: "2", estado: "18", municipio: "17", verificacion: "x", datos: "demo", activa: "todas", pagina: "3" });
    expect(f).toEqual({ q: "umf tepic", categoryId: 2, stateId: 18, municipalityId: 17, verification: "", dataKind: "demo", active: "todas", page: 3 });
    expect(facilitiesHref(f, { page: 1 })).toBe("/administracion/instalaciones?q=umf+tepic&categoria=2&estado=18&municipio=17&datos=demo&activa=todas");
    expect(parseFacilityFilters({ municipio: "17" }).municipalityId).toBeNull();
    expect(facilitiesHref(parseFacilityFilters({}))).toBe("/administracion/instalaciones");
  });
  it("patrón de búsqueda seguro y paginación", () => {
    expect(buildSearchPattern("Clínica (Tepic), INS-0001")).toBe("%clinica%tepic%ins-0001%");
    expect(buildSearchPattern("***")).toBeNull();
    expect(pageRange(2)).toEqual({ from: 25, to: 49 });
    expect(totalPages(0)).toBe(1);
    expect(totalPages(51)).toBe(3);
  });
});

describe("fecha de hoy", () => {
  it("usa la fecha más avanzada de México (Quintana Roo)", async () => {
    const { todayYmd } = await import("@/lib/validation/facility");
    // 05:30 UTC: en Cancún ya es 17/10; en la Ciudad de México aún es 16/10.
    const now = new Date("2026-10-17T05:30:00Z");
    expect(todayYmd(now)).toBe("2026-10-17");
    expect(todayYmd(now, "America/Mexico_City")).toBe("2026-10-16");
  });
});
