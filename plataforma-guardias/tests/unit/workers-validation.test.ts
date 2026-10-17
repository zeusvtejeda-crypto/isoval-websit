import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKER_FILTERS,
  NO_FACILITY,
  buildSearchPattern,
  canSeeWorkerAccount,
  employeeNumberKey,
  employeeNumberPattern,
  escapeLike,
  hasActiveFilters,
  matchUsualShift,
  normalizeText,
  pageRange,
  parseWorkerFilters,
  readWorkerForm,
  totalPages,
  workerActiveSchema,
  workerDeleteSchema,
  workerFormSchema,
  workersHref,
} from "@/lib/validation/worker";

const FAC = "d0000000-0000-4000-8000-000000000001";
const FAC2 = "d0000000-0000-4000-8000-000000000002";
const WORKER = "c0000000-0000-4000-8000-000000000001";

describe("normalización", () => {
  it("replica app.normalize_text", () => {
    expect(normalizeText("  ÁNA   María  Ñúñez ")).toBe("ana maria nunez");
    expect(normalizeText(null)).toBe("");
    expect(employeeNumberKey("  ab-12 ")).toBe("AB-12");
    expect(employeeNumberKey("   ")).toBeNull();
  });

  it("reconoce el turno habitual", () => {
    expect(matchUsualShift("MATUTINO")).toBe("Matutino");
    expect(matchUsualShift("jornada  acumulada")).toBe("Jornada acumulada");
    expect(matchUsualShift("noche")).toBe("Nocturno");
    expect(matchUsualShift("")).toBeNull();
    expect(matchUsualShift("rotativo")).toBeNull();
  });
});

describe("formulario de trabajador", () => {
  const base = { full_name: "  María   López ", state_id: "18", active: true };

  it("acepta un alta mínima y normaliza espacios", () => {
    const r = workerFormSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.full_name).toBe("María López");
      expect(r.data.state_id).toBe(18);
      expect(r.data.municipality_id).toBeUndefined();
    }
  });

  it("valida nombre, estado, teléfono, turno e instalación", () => {
    const r = workerFormSchema.safeParse({
      full_name: "Al",
      state_id: undefined,
      phone: "teléfono",
      usual_shift: "Madrugada",
      facility_id: "no-uuid",
      active: true,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(expect.arrayContaining(["full_name", "state_id", "phone", "usual_shift", "facility_id"]));
    }
  });

  it("en edición exige motivo del cambio", () => {
    expect(workerFormSchema.safeParse({ ...base, id: WORKER }).success).toBe(false);
    expect(workerFormSchema.safeParse({ ...base, id: WORKER, change_reason: "Cambio de área" }).success).toBe(true);
  });

  it("lee el FormData (casilla de activo incluida)", () => {
    const fd = new FormData();
    fd.set("full_name", " Ana ");
    fd.set("state_id", "18");
    fd.set("municipality_id", "");
    fd.set("phone", " 311 000 0000 ");
    const unchecked = readWorkerForm(fd);
    expect(unchecked).toMatchObject({ full_name: "Ana", state_id: "18", municipality_id: undefined, phone: "311 000 0000", active: false });
    fd.set("active", "1");
    expect(readWorkerForm(fd).active).toBe(true);
  });

  it("desactivar y eliminar requieren motivo; eliminar requiere confirmación", () => {
    expect(workerActiveSchema.safeParse({ worker_id: WORKER, active: "0", reason: "Baja" }).success).toBe(false);
    expect(workerActiveSchema.safeParse({ worker_id: WORKER, active: "0", reason: "Ya no participa" }).success).toBe(true);
    expect(workerDeleteSchema.safeParse({ worker_id: WORKER, reason: "Registro duplicado", confirm: "eliminar" }).success).toBe(false);
    expect(workerDeleteSchema.safeParse({ worker_id: WORKER, reason: "Registro duplicado", confirm: "ELIMINAR" }).success).toBe(true);
  });
});

describe("filtros de la lista", () => {
  it("usa valores por omisión e ignora valores inválidos", () => {
    expect(parseWorkerFilters({}, { facilityIds: null, allowNoFacility: true })).toEqual(DEFAULT_WORKER_FILTERS);
    const f = parseWorkerFilters(
      { estado: "abc", municipio: "17", sede: "x", activo: "raro", cuenta: "quiza", pagina: "-2" },
      { facilityIds: null, allowNoFacility: true },
    );
    expect(f).toEqual(DEFAULT_WORKER_FILTERS);
  });

  it("lee todos los filtros válidos", () => {
    const f = parseWorkerFilters(
      { q: "  ana   ruiz ", estado: "18", municipio: "17", sede: FAC, area: " Enfermería ", activo: "todos", cuenta: "sin", pagina: "3" },
      { facilityIds: [FAC], allowNoFacility: false },
    );
    expect(f).toEqual({
      q: "ana ruiz",
      stateId: 18,
      municipalityId: 17,
      facility: FAC,
      area: "Enfermería",
      status: "todos",
      account: "sin",
      page: 3,
    });
    expect(hasActiveFilters(f)).toBe(true);
  });

  it("limita la sede al alcance y «sin instalación» a administración", () => {
    expect(parseWorkerFilters({ sede: FAC2 }, { facilityIds: [FAC], allowNoFacility: false }).facility).toBeNull();
    expect(parseWorkerFilters({ sede: NO_FACILITY }, { facilityIds: [FAC], allowNoFacility: false }).facility).toBeNull();
    expect(parseWorkerFilters({ sede: NO_FACILITY }, { facilityIds: null, allowNoFacility: true }).facility).toBe(NO_FACILITY);
  });

  it("el municipio requiere estado", () => {
    expect(parseWorkerFilters({ municipio: "17" }, { facilityIds: null, allowNoFacility: true }).municipalityId).toBeNull();
  });

  it("construye la URL sin valores por omisión", () => {
    expect(workersHref(DEFAULT_WORKER_FILTERS)).toBe("/trabajadores");
    const f = { ...DEFAULT_WORKER_FILTERS, q: "ana", stateId: 18, municipalityId: 17, status: "inactivos" as const, page: 2 };
    expect(workersHref(f)).toBe("/trabajadores?q=ana&estado=18&municipio=17&activo=inactivos&pagina=2");
    expect(workersHref(f, { page: 1 })).toBe("/trabajadores?q=ana&estado=18&municipio=17&activo=inactivos");
    const roundTrip = parseWorkerFilters(Object.fromEntries(new URL(workersHref(f), "http://x").searchParams), {
      facilityIds: null,
      allowNoFacility: true,
    });
    expect(roundTrip).toEqual(f);
  });
});

describe("visibilidad de la cuenta de acceso", () => {
  it("replica profiles_read: administración o sede de adscripción en el alcance", () => {
    expect(canSeeWorkerAccount({ isAdmin: true, facilityIds: [] }, null)).toBe(true);
    expect(canSeeWorkerAccount({ isAdmin: false, facilityIds: [FAC] }, FAC)).toBe(true);
    // Persona de otra sede visible por una asignación: su perfil no es visible, no se afirma «Sin cuenta».
    expect(canSeeWorkerAccount({ isAdmin: false, facilityIds: [FAC] }, FAC2)).toBe(false);
    expect(canSeeWorkerAccount({ isAdmin: false, facilityIds: [FAC] }, null)).toBe(false);
  });
});

describe("búsqueda y paginación", () => {
  it("arma el patrón de búsqueda seguro para PostgREST", () => {
    expect(buildSearchPattern("Ana  Ruíz")).toBe("%ana%ruiz%");
    expect(buildSearchPattern("TRA-000001")).toBe("%tra-000001%");
    expect(buildSearchPattern("a,b(c).d*%")).toBe("%a%b%c%d%");
    expect(buildSearchPattern(" ,() ")).toBeNull();
  });

  it("escapa comodines de LIKE", () => {
    expect(escapeLike("50%_a\\b*")).toBe("50\\%\\_a\\\\b");
    expect(employeeNumberPattern("E-0001")).toBe("%E-0001%");
    expect(employeeNumberPattern("a")).toBeNull();
    expect(employeeNumberPattern("ana, (ruiz)")).toBe("%ana ruiz%");
  });

  it("calcula páginas y rangos de 25", () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(25)).toBe(1);
    expect(totalPages(26)).toBe(2);
    expect(pageRange(1)).toEqual({ from: 0, to: 24 });
    expect(pageRange(3)).toEqual({ from: 50, to: 74 });
  });
});
