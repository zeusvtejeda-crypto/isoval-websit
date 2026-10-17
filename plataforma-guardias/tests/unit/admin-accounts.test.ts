import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNT_FILTERS,
  accountStatus,
  accountStatusSchema,
  accountsHref,
  buildAccountRows,
  changedAccountFields,
  createAccountSchema,
  facilitiesSummary,
  filterAccounts,
  hasAccountFilters,
  isBanned,
  joinSpanish,
  linkableWorkers,
  normalizeSearch,
  ownAttendanceRestricted,
  parseAccountFilters,
  readCreateAccountForm,
  readUpdateAccountForm,
  reasonRequired,
  resetPasswordSchema,
  roleUsesFacilityScopes,
  scopeChanges,
  updateAccountSchema,
  workerOptionLabel,
} from "@/lib/admin/accounts";
import { LAST_ADMIN_MESSAGE, friendlyAdminError, friendlyAuthError } from "@/lib/admin/form";

const U1 = "a0000000-0000-4000-8000-000000000001";
const U2 = "a0000000-0000-4000-8000-000000000002";
const U3 = "a0000000-0000-4000-8000-000000000003";
const F1 = "d0000000-0000-4000-8000-000000000001";
const F2 = "d0000000-0000-4000-8000-000000000002";
const W1 = "c0000000-0000-4000-8000-000000000001";
const W2 = "c0000000-0000-4000-8000-000000000002";

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

describe("esquema de alta", () => {
  const base = { email: "ana@ejemplo.mx", display_name: "Ana", role: "trabajador", facility_ids: [], password_mode: "generar" };

  it("acepta un alta con contraseña generada", () => {
    const r = createAccountSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("normaliza el correo y descarta sedes para roles sin alcance", () => {
    const fd = form([
      ["email", "  Ana@Ejemplo.MX "],
      ["display_name", " Ana "],
      ["role", "admin"],
      ["facility_ids", F1],
      ["facility_ids", F1],
      ["password_mode", "generar"],
    ]);
    const r = createAccountSchema.safeParse(readCreateAccountForm(fd));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("ana@ejemplo.mx");
      expect(r.data.display_name).toBe("Ana");
      expect(r.data.facility_ids).toEqual([]);
    }
  });

  it("exige contraseña de 12+ caracteres si se captura a mano", () => {
    const r = createAccountSchema.safeParse({ ...base, password_mode: "manual", password: "corta" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["password"]);
    expect(createAccountSchema.safeParse({ ...base, password_mode: "manual", password: "Segura-2026-ok" }).success).toBe(true);
  });

  it("exige al menos una sede para coordinación y auditoría", () => {
    for (const role of ["coordinador", "auditor"]) {
      const r = createAccountSchema.safeParse({ ...base, role });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "facility_ids")).toBe(true);
      const ok = createAccountSchema.safeParse({ ...base, role, facility_ids: [F1, F2, F1] });
      expect(ok.success).toBe(true);
      if (ok.success) expect(ok.data.facility_ids).toEqual([F1, F2]);
    }
  });

  it("rechaza correo, rol y trabajador inválidos", () => {
    const r = createAccountSchema.safeParse({ ...base, email: "no-es-correo", role: "root", worker_id: "x" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(expect.arrayContaining(["email", "role", "worker_id"]));
    }
  });
});

describe("esquemas de edición, estado y contraseña", () => {
  it("edición: el motivo es opcional en el esquema pero con mínimo de 5", () => {
    const fd = form([
      ["user_id", U1],
      ["display_name", "Luis"],
      ["role", "coordinador"],
      ["facility_ids", F1],
      ["reason", "abc"],
    ]);
    const r = updateAccountSchema.safeParse(readUpdateAccountForm(fd));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["reason"]);
    const ok = updateAccountSchema.safeParse({ user_id: U1, display_name: "Luis", role: "trabajador", facility_ids: [F1], worker_id: W1 });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.facility_ids).toEqual([]);
      expect(ok.data.reason).toBeUndefined();
    }
  });

  it("estado: motivo obligatorio y valor booleano", () => {
    expect(accountStatusSchema.safeParse({ user_id: U1, active: "0" }).success).toBe(false);
    const r = accountStatusSchema.safeParse({ user_id: U1, active: "0", reason: "Baja temporal" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.active).toBe(false);
  });

  it("restablecer: generar no requiere contraseña; manual sí", () => {
    expect(resetPasswordSchema.safeParse({ user_id: U1, password_mode: "generar" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ user_id: U1, password_mode: "manual", password: "123" }).success).toBe(false);
  });
});

describe("reglas de cambio", () => {
  it("motivo obligatorio solo si cambia el rol o el estado", () => {
    expect(reasonRequired({ role: "trabajador", active: true }, { role: "trabajador", active: true })).toBe(false);
    expect(reasonRequired({ role: "trabajador", active: true }, { role: "coordinador", active: true })).toBe(true);
    expect(reasonRequired({ role: "admin", active: true }, { role: "admin", active: false })).toBe(true);
  });

  it("calcula sedes por agregar y quitar", () => {
    expect(scopeChanges([F1], [F1, F2])).toEqual({ add: [F2], remove: [] });
    expect(scopeChanges([F1, F2], [])).toEqual({ add: [], remove: [F1, F2] });
    expect(scopeChanges([F1], [F1])).toEqual({ add: [], remove: [] });
  });

  it("enumera los datos cambiados en español", () => {
    const before = { display_name: "Ana", role: "coordinador" as const, worker_id: null, facility_ids: [F1] };
    expect(changedAccountFields(before, { ...before })).toEqual([]);
    expect(changedAccountFields(before, { ...before, role: "auditor", facility_ids: [F2], worker_id: W1, display_name: "Ana M." })).toEqual([
      "nombre visible",
      "rol",
      "trabajador vinculado",
      "sedes asignadas",
    ]);
    expect(joinSpanish(["rol"])).toBe("rol");
    expect(joinSpanish(["rol", "sedes"])).toBe("rol y sedes");
    expect(joinSpanish(["a", "b", "c"])).toBe("a, b y c");
  });

  it("solo coordinación y auditoría usan sedes", () => {
    expect(roleUsesFacilityScopes("coordinador")).toBe(true);
    expect(roleUsesFacilityScopes("auditor")).toBe(true);
    expect(roleUsesFacilityScopes("admin")).toBe(false);
    expect(roleUsesFacilityScopes("trabajador")).toBe(false);
  });
});

describe("lista de cuentas", () => {
  const profiles = [
    { id: U1, role: "admin" as const, display_name: "Zoe Admin", active: true, worker_id: null, created_at: "2026-01-01T00:00:00Z" },
    { id: U2, role: "coordinador" as const, display_name: "Álvaro Coord", active: true, worker_id: W1, created_at: "2026-01-02T00:00:00Z" },
    { id: U3, role: "trabajador" as const, display_name: null, active: false, worker_id: W2, created_at: "2026-01-03T00:00:00Z" },
  ];
  const authUsers = [
    { id: U1, email: "zoe@ejemplo.mx", banned_until: null, last_sign_in_at: "2026-10-01T10:00:00Z" },
    { id: U2, email: "alvaro@ejemplo.mx", banned_until: null, last_sign_in_at: null },
  ];
  const rows = buildAccountRows({
    profiles,
    authUsers,
    scopes: [
      { user_id: U2, facility_id: F2 },
      { user_id: U2, facility_id: F1 },
    ],
    workers: [{ id: W1, full_name: "Álvaro Pérez", internal_code: "TRA-000001" }],
    facilityNames: { [F1]: "UMF 1", [F2]: "Hospital A" },
  });

  it("combina perfiles, correos, sedes y trabajadores y ordena por nombre", () => {
    expect(rows.map((r) => r.id)).toEqual([U3, U2, U1]);
    const coord = rows.find((r) => r.id === U2)!;
    expect(coord.email).toBe("alvaro@ejemplo.mx");
    expect(coord.facilities.map((f) => f.name)).toEqual(["Hospital A", "UMF 1"]);
    expect(coord.worker).toEqual({ id: W1, fullName: "Álvaro Pérez", internalCode: "TRA-000001" });
    const worker = rows.find((r) => r.id === U3)!;
    expect(worker.authMissing).toBe(true);
    expect(worker.worker).toBeNull();
    expect(worker.workerId).toBe(W2);
  });

  it("sin datos de Auth no marca cuentas como faltantes", () => {
    const noAuth = buildAccountRows({ profiles, authUsers: null, scopes: [], workers: [], facilityNames: {} });
    expect(noAuth.every((r) => !r.authMissing && r.email === null)).toBe(true);
  });

  it("filtra por texto sin acentos, rol y estado", () => {
    expect(filterAccounts(rows, { ...DEFAULT_ACCOUNT_FILTERS, q: "alvaro" }).map((r) => r.id)).toEqual([U2]);
    expect(filterAccounts(rows, { ...DEFAULT_ACCOUNT_FILTERS, q: "TRA-000001" }).map((r) => r.id)).toEqual([U2]);
    expect(filterAccounts(rows, { ...DEFAULT_ACCOUNT_FILTERS, role: "admin" }).map((r) => r.id)).toEqual([U1]);
    expect(filterAccounts(rows, { ...DEFAULT_ACCOUNT_FILTERS, status: "inactivas" }).map((r) => r.id)).toEqual([U3]);
    expect(filterAccounts(rows, { ...DEFAULT_ACCOUNT_FILTERS, status: "activas" })).toHaveLength(2);
  });

  it("lee y construye filtros por URL", () => {
    const f = parseAccountFilters({ q: "  ana   m ", rol: "auditor", estado: "inactivas" });
    expect(f).toEqual({ q: "ana m", role: "auditor", status: "inactivas" });
    expect(accountsHref(f)).toBe("/administracion/usuarios?q=ana+m&rol=auditor&estado=inactivas");
    expect(parseAccountFilters({ rol: "root", estado: "x" })).toEqual(DEFAULT_ACCOUNT_FILTERS);
    expect(accountsHref(DEFAULT_ACCOUNT_FILTERS)).toBe("/administracion/usuarios");
    expect(hasAccountFilters(DEFAULT_ACCOUNT_FILTERS)).toBe(false);
    expect(hasAccountFilters(f)).toBe(true);
  });

  it("resume sedes", () => {
    expect(facilitiesSummary([])).toBe("");
    expect(facilitiesSummary(["A", "B"])).toBe("A y B");
    expect(facilitiesSummary(["A", "B", "C", "D", "E"])).toBe("A, B, C y 2 más");
  });

  it("normaliza búsquedas", () => {
    expect(normalizeSearch("  ÁNA   María ")).toBe("ana maria");
  });
});

describe("estado de la cuenta", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  it("detecta el bloqueo en Auth", () => {
    expect(isBanned(null, now)).toBe(false);
    expect(isBanned("2126-10-17T12:00:00Z", now)).toBe(true);
    expect(isBanned("2020-01-01T00:00:00Z", now)).toBe(false);
  });

  it("muestra el estado siempre con texto", () => {
    expect(accountStatus({ active: true, bannedUntil: null }, now)).toMatchObject({ label: "Activa", tone: "success" });
    expect(accountStatus({ active: false, bannedUntil: "2126-01-01T00:00:00Z" }, now)).toMatchObject({ label: "Inactiva" });
    expect(accountStatus({ active: false, bannedUntil: null }, now).hint).toMatch(/no está bloqueado/);
    expect(accountStatus({ active: true, bannedUntil: "2126-01-01T00:00:00Z" }, now).label).toMatch(/bloqueado/);
  });
});

describe("trabajadores vinculables", () => {
  const workers = [
    { id: W1, active: true },
    { id: W2, active: true },
    { id: "c0000000-0000-4000-8000-000000000003", active: false },
  ];
  it("solo activos sin cuenta, más el vinculado actualmente", () => {
    expect(linkableWorkers(workers, [W1]).map((w) => w.id)).toEqual([W2]);
    expect(linkableWorkers(workers, [W1], W1).map((w) => w.id)).toEqual([W1, W2]);
    expect(linkableWorkers(workers, [], "c0000000-0000-4000-8000-000000000003")).toHaveLength(3);
  });

  it("etiqueta de opción", () => {
    expect(workerOptionLabel({ id: W1, fullName: "Ana", internalCode: "TRA-1", facilityName: "UMF 1", active: true })).toBe("Ana · TRA-1 · UMF 1");
    expect(workerOptionLabel({ id: W1, fullName: "Ana", internalCode: "TRA-1", facilityName: null, active: false })).toBe("Ana · TRA-1 (inactivo)");
  });
});

describe("errores amigables", () => {
  it("traduce el error del último administrador", () => {
    expect(friendlyAdminError({ code: "23514", message: "Debe existir al menos un administrador activo" })).toBe(LAST_ADMIN_MESSAGE);
    expect(friendlyAdminError({ code: "42501", message: "permission denied for table profiles" })).toBe("No tienes permiso para realizar esta acción.");
  });

  it("traduce errores de Auth", () => {
    expect(friendlyAuthError({ code: "email_exists", message: "A user with this email address has already been registered" })).toBe(
      "Ya existe una cuenta con ese correo.",
    );
    expect(friendlyAuthError({ message: "User not found", status: 404 })).toBe("La cuenta no existe en el sistema de acceso.");
    expect(friendlyAuthError({ message: "Database error creating new user" })).toMatch(/perfil/);
    expect(friendlyAuthError({ message: "weird" }, "Falló")).toBe("Falló");
    expect(friendlyAuthError(null)).toMatch(/sistema de acceso/);
  });
});

describe("separación de funciones", () => {
  it("avisa solo a coordinación vinculada a un trabajador (administración queda exenta)", () => {
    expect(ownAttendanceRestricted("coordinador", W1)).toBe(true);
    expect(ownAttendanceRestricted("coordinador", null)).toBe(false);
    expect(ownAttendanceRestricted("admin", W1)).toBe(false);
    expect(ownAttendanceRestricted("trabajador", W1)).toBe(false);
    expect(ownAttendanceRestricted("auditor", W1)).toBe(false);
  });
});
