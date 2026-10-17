import { describe, expect, it } from "vitest";
import {
  EMPTY_VALUE,
  NOT_APPLICABLE,
  auditFieldChanges,
  auditSubject,
  changesSummary,
  collectRefIds,
  eventValueTimeZone,
  formatAuditValue,
  settingValueChanges,
  truncate,
  type ValueContext,
} from "@/lib/admin/audit-diff";
import {
  AUDIT_TABLE_LABELS,
  actorRoleLabel,
  auditActionLabel,
  auditActionTone,
  auditTableLabel,
  auditTablesFor,
  enumValueLabel,
  fieldLabel,
} from "@/lib/admin/audit-labels";
import {
  EMPTY_AUDIT_FILTERS,
  actorDisplay,
  auditHref,
  auditTimeRange,
  hasAuditFilters,
  isIsoDay,
  pageBounds,
  pageCount,
  parseAuditFilters,
} from "@/lib/admin/audit-filters";

const ROLE_LABELS = { admin: "Administración general", coordinador: "Coordinación", trabajador: "Trabajador", auditor: "Consulta o auditoría" };
const TZ = "America/Mazatlan";
const U1 = "a0000000-0000-4000-8000-000000000001";
const F1 = "d0000000-0000-4000-8000-000000000001";
const W1 = "c0000000-0000-4000-8000-000000000001";
const ctx: ValueContext = {
  timeZone: TZ,
  roleLabels: ROLE_LABELS,
  refs: {
    facility: { [F1]: "[DEMO] Hospital A" },
    profile: { [U1]: "Administración (demo)" },
    category: { "2": "Unidades de Medicina Familiar" },
    municipality: { "17": "Tepic" },
    worker: { [W1]: "Ana (demo)" },
  },
};

describe("etiquetas", () => {
  it("nombres de tablas y acciones en español", () => {
    expect(auditTableLabel("attendance_sessions")).toBe("Registros de entrada y salida");
    expect(auditTableLabel("profiles")).toBe("Cuentas de acceso");
    expect(auditTableLabel("otra")).toBe("Tabla «otra»");
    expect(auditActionLabel("UPDATE")).toBe("Modificación");
    expect(auditActionLabel("PURGE")).toBe("Depuración");
    expect(auditActionLabel("RARO")).toBe("RARO");
    expect(auditActionTone("DELETE")).toBe("danger");
    expect(auditActionTone("RARO")).toBe("neutral");
  });

  it("todas las tablas con bitácora tienen nombre", () => {
    for (const t of [
      "facility_categories",
      "facilities",
      "workers",
      "worker_private",
      "profiles",
      "user_facility_scopes",
      "shifts",
      "shift_assignments",
      "attendance_sessions",
      "correction_requests",
      "incident_notes",
      "app_settings",
      "retention",
      "demo_data",
    ]) {
      expect(AUDIT_TABLE_LABELS[t]).toBeTruthy();
    }
  });

  it("coordinación y auditoría no filtran tablas que RLS no les muestra", () => {
    const limited = auditTablesFor(false);
    expect(limited).not.toContain("profiles");
    expect(limited).not.toContain("worker_private");
    expect(limited).not.toContain("user_facility_scopes");
    expect(limited).not.toContain("app_settings");
    expect(limited).toContain("attendance_sessions");
    expect(auditTablesFor(true)).toContain("profiles");
  });

  it("etiquetas de campos dependientes de la tabla", () => {
    expect(fieldLabel("shifts", "status")).toBe("Estado de la guardia");
    expect(fieldLabel("shift_assignments", "status")).toBe("Estado de la asignación");
    expect(fieldLabel("profiles", "active")).toBe("Cuenta activa");
    expect(fieldLabel("facilities", "official_name")).toBe("Nombre oficial");
    expect(fieldLabel("facilities", "campo_nuevo")).toBe("campo_nuevo");
  });

  it("valores enumerados", () => {
    expect(enumValueLabel("profiles", "role", "auditor", ROLE_LABELS)).toBe("Consulta o auditoría");
    expect(enumValueLabel("shifts", "status", "en_curso")).toBe("En curso");
    expect(enumValueLabel("shift_assignments", "status", "cancelado")).toBe("Asignación cancelada");
    expect(enumValueLabel("correction_requests", "status", "aprobada")).toBe("Aprobada");
    expect(enumValueLabel("attendance_sessions", "check_in_method", "coordinador")).toBe("Registrado por coordinación");
    expect(enumValueLabel("facilities", "status", "x")).toBeNull();
    expect(enumValueLabel("profiles", "role", "toString", ROLE_LABELS)).toBeNull();
  });

  it("rol del autor", () => {
    expect(actorRoleLabel("coordinador", ROLE_LABELS)).toBe("Coordinación");
    expect(actorRoleLabel("supabase_auth_admin", ROLE_LABELS)).toBe("Proceso del sistema");
    expect(actorRoleLabel(null, ROLE_LABELS)).toBe("Sin rol registrado");
  });
});

describe("formato de valores", () => {
  it("vacíos, booleanos, números y listas", () => {
    expect(formatAuditValue("facilities", "phone", null, ctx)).toBe(EMPTY_VALUE);
    expect(formatAuditValue("facilities", "phone", "  ", ctx)).toBe(EMPTY_VALUE);
    expect(formatAuditValue("facilities", "is_public", true, ctx)).toBe("Sí");
    expect(formatAuditValue("facilities", "is_public", false, ctx)).toBe("No");
    expect(formatAuditValue("shifts", "min_staff", 3, ctx)).toBe("3");
    expect(formatAuditValue("facilities", "services", ["Urgencias", "Consulta"], ctx)).toBe("Urgencias, Consulta");
    expect(formatAuditValue("facilities", "services", [], ctx)).toBe("(sin elementos)");
  });

  it("fechas en la zona indicada", () => {
    // 2026-10-18 05:05 UTC = 2026-10-17 22:05 en Mazatlán (UTC−7).
    expect(formatAuditValue("attendance_sessions", "check_in_at", "2026-10-18T05:05:00.123456+00:00", ctx)).toBe("17/10/2026 22:05");
    expect(formatAuditValue("facilities", "last_verified_at", "2026-10-01", ctx)).toBe("01/10/2026");
  });

  it("referencias a sedes, categorías y cuentas", () => {
    expect(formatAuditValue("workers", "facility_id", F1, ctx)).toBe("[DEMO] Hospital A");
    expect(formatAuditValue("facilities", "category_id", 2, ctx)).toBe("Unidades de Medicina Familiar");
    expect(formatAuditValue("shifts", "updated_by", U1, ctx)).toBe("Administración (demo)");
    expect(formatAuditValue("shifts", "created_by", "b0000000-0000-4000-8000-000000000009", ctx)).toBe("Usuario b0000000");
    expect(formatAuditValue("profiles", "role", "admin", ctx)).toBe("Administración general");
  });

  it("objetos y textos largos se recortan", () => {
    expect(formatAuditValue("x", "y", { a: 1 }, ctx)).toBe('{"a":1}');
    const long = "x".repeat(400);
    expect(formatAuditValue("facilities", "notes", long, ctx)).toHaveLength(300);
    expect(truncate("abcdef", 4)).toBe("abc…");
  });
});

describe("cambios de un evento", () => {
  it("modificación: usa changed_fields, oculta campos técnicos y traduce", () => {
    const changes = auditFieldChanges(
      {
        table_name: "shifts",
        action: "UPDATE",
        changed_fields: ["status", "cancel_reason", "normalized_name"],
        old_data: { status: "programada", cancel_reason: null, normalized_name: "a" },
        new_data: { status: "cancelada", cancel_reason: "Lluvia", normalized_name: "b" },
      },
      ctx,
    );
    expect(changes).toEqual([
      { field: "status", label: "Estado de la guardia", before: "Programada", after: "Cancelada" },
      { field: "cancel_reason", label: "Motivo de cancelación", before: EMPTY_VALUE, after: "Lluvia" },
    ]);
  });

  it("modificación sin changed_fields: calcula las diferencias", () => {
    const changes = auditFieldChanges(
      {
        table_name: "profiles",
        action: "UPDATE",
        changed_fields: null,
        old_data: { role: "trabajador", active: true, updated_at: "2026-01-01T00:00:00Z" },
        new_data: { role: "coordinador", active: true, updated_at: "2026-02-01T00:00:00Z" },
      },
      ctx,
    );
    expect(changes).toEqual([{ field: "role", label: "Rol", before: "Trabajador", after: "Coordinación" }]);
  });

  it("alta: muestra los valores registrados sin datos de control ni vacíos", () => {
    const changes = auditFieldChanges(
      {
        table_name: "user_facility_scopes",
        action: "INSERT",
        changed_fields: null,
        old_data: null,
        new_data: { user_id: U1, facility_id: F1, granted_by: null, granted_at: "2026-10-18T05:05:00+00:00" },
      },
      ctx,
    );
    expect(changes.map((c) => [c.label, c.before, c.after])).toEqual([
      ["Sede", NOT_APPLICABLE, "[DEMO] Hospital A"],
      ["Cuenta", NOT_APPLICABLE, "Administración (demo)"],
      ["Fecha de asignación", NOT_APPLICABLE, "17/10/2026 22:05"],
    ]);
  });

  it("eliminación: valores anteriores → —", () => {
    const changes = auditFieldChanges(
      { table_name: "facility_categories", action: "DELETE", changed_fields: null, old_data: { id: 9, name: "Temporal", active: false }, new_data: null },
      ctx,
    );
    expect(changes).toEqual([
      { field: "active", label: "Activa", before: "No", after: NOT_APPLICABLE },
      { field: "name", label: "Nombre", before: "Temporal", after: NOT_APPLICABLE },
    ]);
  });

  it("configuración: compara las claves del valor JSON", () => {
    const changes = auditFieldChanges(
      {
        table_name: "app_settings",
        action: "UPDATE",
        changed_fields: ["value"],
        old_data: { key: "privacy_notice", value: { title: "Aviso", legal_review_status: "pendiente", contact: null } },
        new_data: { key: "privacy_notice", value: { title: "Aviso", legal_review_status: "aprobado", contact: "c@x.mx" } },
      },
      ctx,
    );
    expect(changes).toEqual([
      { field: "value.contact", label: "Contacto", before: EMPTY_VALUE, after: "c@x.mx" },
      { field: "value.legal_review_status", label: "Revisión jurídica", before: "Pendiente", after: "Aprobado" },
    ]);
    expect(settingValueChanges({ a: 1 }, {}, ctx)).toEqual([{ field: "value.a", label: "a", before: "1", after: NOT_APPLICABLE }]);
  });

  it("depuración: resumen de lo eliminado", () => {
    const changes = auditFieldChanges(
      { table_name: "demo_data", action: "PURGE", changed_fields: null, old_data: null, new_data: { facilities: 14, workers: 8, shifts: 0 } },
      ctx,
    );
    expect(changes.map((c) => `${c.label}: ${c.after}`)).toEqual(["Guardias: 0", "Trabajadores: 8", "Instalaciones: 14"]);
    expect(changes.every((c) => c.before === NOT_APPLICABLE)).toBe(true);
  });

  it("resumen del detalle plegable", () => {
    expect(changesSummary("UPDATE", 1)).toBe("Ver 1 campo modificado");
    expect(changesSummary("UPDATE", 3)).toBe("Ver 3 campos modificados");
    expect(changesSummary("INSERT", 2)).toBe("Ver datos registrados (2 campos)");
    expect(changesSummary("PURGE", 3)).toBe("Ver resumen de la depuración");
    expect(changesSummary("DELETE", 0)).toBe("Sin campos que mostrar");
  });
});

describe("referencias y asunto del evento", () => {
  it("muestra el nombre del trabajador o un identificador corto", () => {
    expect(formatAuditValue("shift_assignments", "worker_id", W1, ctx)).toBe("Ana (demo)");
    expect(formatAuditValue("shift_assignments", "substitute_for_worker_id", "c0000000-0000-4000-8000-000000000009", ctx)).toBe("Trabajador c0000000");
  });

  it("muestra el municipio por nombre (o el número si no se conoce)", () => {
    expect(formatAuditValue("workers", "municipality_id", 17, ctx)).toBe("Tepic");
    expect(formatAuditValue("workers", "municipality_id", 99, ctx)).toBe("99");
  });

  it("reúne identificadores numéricos (municipios) como texto", () => {
    const events = [{ old_data: { municipality_id: 17 }, new_data: { municipality_id: 18, state_id: 18 } }];
    expect(collectRefIds(events, "municipality").sort()).toEqual(["17", "18"]);
    expect(collectRefIds(events, "state")).toEqual(["18"]);
  });

  it("reúne identificadores referenciados sin repetir", () => {
    const events = [
      { old_data: { worker_id: W1, facility_id: F1 }, new_data: { worker_id: W1, responsible_worker_id: "c0000000-0000-4000-8000-000000000002" } },
      { old_data: null, new_data: { substitute_for_worker_id: null, facility_id: F1 } },
    ];
    expect(collectRefIds(events, "worker").sort()).toEqual([W1, "c0000000-0000-4000-8000-000000000002"]);
    expect(collectRefIds(events, "facility")).toEqual([F1]);
  });

  it("describe qué registro cambió", () => {
    const base = { action: "UPDATE", changed_fields: null, old_data: null };
    expect(auditSubject({ ...base, table_name: "facilities", new_data: { official_name: "UMF 1" } }, ctx)).toBe("UMF 1");
    expect(auditSubject({ ...base, table_name: "attendance_sessions", new_data: { worker_id: W1 } }, ctx)).toBe("Ana (demo)");
    expect(auditSubject({ ...base, table_name: "shifts", new_data: { title: null, meeting_point: "Puerta 2" } }, ctx)).toBe("Puerta 2");
    expect(auditSubject({ ...base, table_name: "user_facility_scopes", new_data: { user_id: U1, facility_id: F1 } }, ctx)).toBe(
      "Administración (demo) → [DEMO] Hospital A",
    );
    expect(auditSubject({ ...base, table_name: "app_settings", new_data: { key: "retention" } }, ctx)).toBe("Conservación de datos");
    expect(auditSubject({ ...base, table_name: "demo_data", new_data: { facilities: 1 } }, ctx)).toBeNull();
  });
});

describe("zona horaria del detalle", () => {
  const zones = { [F1]: "America/Mexico_City" };

  it("usa la zona de la sede del evento y, si no se conoce, la zona por omisión", () => {
    expect(eventValueTimeZone(F1, zones, TZ)).toBe("America/Mexico_City");
    expect(eventValueTimeZone(null, zones, TZ)).toBe(TZ);
    expect(eventValueTimeZone("d0000000-0000-4000-8000-000000000099", zones, TZ)).toBe(TZ);
    expect(eventValueTimeZone("toString", zones, TZ)).toBe(TZ);
  });

  it("el horario de una guardia se muestra en la zona de su sede", () => {
    // 2026-10-18 05:05 UTC = 22:05 (Mazatlán, UTC−7) = 23:05 (Ciudad de México, UTC−6).
    const event = {
      table_name: "shifts",
      action: "UPDATE",
      changed_fields: ["starts_at"],
      old_data: { starts_at: "2026-10-18T04:05:00+00:00" },
      new_data: { starts_at: "2026-10-18T05:05:00+00:00" },
    };
    const tz = eventValueTimeZone(F1, zones, TZ);
    expect(auditFieldChanges(event, { ...ctx, timeZone: tz })).toEqual([
      { field: "starts_at", label: "Inicio", before: "17/10/2026 22:05", after: "17/10/2026 23:05" },
    ]);
  });
});

describe("filtros de la bitácora", () => {
  const tables = auditTablesFor(true);

  it("lee filtros válidos e ignora los inválidos", () => {
    const f = parseAuditFilters(
      { tabla: "shifts", accion: "UPDATE", desde: "2026-10-01", hasta: "2026-10-17", sede: F1.toUpperCase(), autor: U1, pagina: "3" },
      { tables },
    );
    expect(f).toEqual({ table: "shifts", action: "UPDATE", from: "2026-10-01", to: "2026-10-17", facilityId: F1, actorId: U1, page: 3 });
    expect(parseAuditFilters({ tabla: "pg_authid", accion: "DROP", desde: "2026-02-30", sede: "x", autor: "1", pagina: "-2" }, { tables })).toEqual(
      EMPTY_AUDIT_FILTERS,
    );
  });

  it("limita las tablas a las permitidas para el rol", () => {
    expect(parseAuditFilters({ tabla: "profiles" }, { tables: auditTablesFor(false) }).table).toBe("");
  });

  it("corrige un rango invertido", () => {
    const f = parseAuditFilters({ desde: "2026-10-17", hasta: "2026-10-01" }, { tables });
    expect([f.from, f.to]).toEqual(["2026-10-01", "2026-10-17"]);
  });

  it("valida días del calendario", () => {
    expect(isIsoDay("2026-02-28")).toBe(true);
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("17/10/2026")).toBe(false);
  });

  it("construye la URL omitiendo valores por omisión", () => {
    expect(auditHref(EMPTY_AUDIT_FILTERS)).toBe("/administracion/bitacora");
    const f = { ...EMPTY_AUDIT_FILTERS, table: "workers", from: "2026-10-01" };
    expect(auditHref(f, { page: 2 })).toBe("/administracion/bitacora?tabla=workers&desde=2026-10-01&pagina=2");
    expect(hasAuditFilters(f)).toBe(true);
    expect(hasAuditFilters({ ...EMPTY_AUDIT_FILTERS, page: 5 })).toBe(false);
  });

  it("convierte días locales a límites UTC (incluye el día final completo)", () => {
    const r = auditTimeRange({ from: "2026-10-17", to: "2026-10-17" }, TZ);
    expect(r).toEqual({ gte: "2026-10-17T07:00:00.000Z", lt: "2026-10-18T07:00:00.000Z" });
    expect(auditTimeRange({ from: "", to: "" }, TZ)).toEqual({ gte: null, lt: null });
  });

  it("paginación de 50 en 50", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageBounds(1)).toEqual({ from: 0, to: 49 });
    expect(pageBounds(3)).toEqual({ from: 100, to: 149 });
  });

  it("autor visible o identificador corto", () => {
    expect(actorDisplay(U1, { [U1]: "Ana" })).toBe("Ana");
    expect(actorDisplay(U1, {})).toBe("Usuario a0000000");
    expect(actorDisplay(null, {})).toMatch(/Sistema/);
  });
});
