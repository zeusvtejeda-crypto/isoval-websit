import { describe, expect, it } from "vitest";
import { afterPreposition } from "@/lib/attendance/labels";
import {
  addDays,
  buildShiftTimes,
  daysInRange,
  describeShiftClock,
  hasStarted,
  isValidDay,
  isValidLocalDateTime,
  localDateTimeToUtc,
  resolveEditedSchedule,
  splitShiftTimes,
  startOfWeek,
  weekDays,
} from "@/lib/shifts/dates";
import {
  applyShiftFilters,
  groupByStartDay,
  guardiasHref,
  includeCancelledFor,
  matchesStatus,
  MAX_RANGE_DAYS,
  parseShiftFilters,
  shiftRangeByWeeks,
  type FilterableShift,
} from "@/lib/shifts/filters";
import { coverLabel, formatSignedDuration, formatTimeRangeCompact, shiftDisplayTitle, staffingSummary, timezoneLabel } from "@/lib/shifts/format";
import {
  FUTURE_TIME_MESSAGE,
  OUTSIDE_WINDOW_MESSAGE,
  captureInputBounds,
  captureWindow,
  describeCaptureWindow,
  isOpenSessionStale,
  isOwnRecordLocked,
  isScheduleLocked,
  maxStaffBelowAssigned,
  validateCapturedTimes,
} from "@/lib/shifts/rules";
import {
  addAssignmentSchema,
  correctSessionSchema,
  fieldErrorsFrom,
  manualSessionSchema,
  readForm,
  shiftFormSchema,
  SHIFT_FORM_FIELDS,
  updateAssignmentSchema,
} from "@/lib/shifts/schemas";
import { collectActorIds, describeActor } from "@/lib/shifts/actors";

const MAZ = "America/Mazatlan";
const BAH = "America/Bahia_Banderas";
const FACILITY = "d0000000-0000-4000-8000-000000000001";
const OTHER = "d0000000-0000-4000-8000-000000000002";

describe("buildShiftTimes", () => {
  it("guardia diurna en Mazatlán (UTC−7)", () => {
    const t = buildShiftTimes("2026-10-17", "08:00", "14:00", MAZ);
    expect(t.startsAt.toISOString()).toBe("2026-10-17T15:00:00.000Z");
    expect(t.endsAt.toISOString()).toBe("2026-10-17T21:00:00.000Z");
    expect(t.crossesMidnight).toBe(false);
    expect(t.endDate).toBe("2026-10-17");
    expect(t.durationMinutes).toBe(360);
  });

  it("cruce de medianoche en America/Mazatlan: termina al día siguiente", () => {
    const t = buildShiftTimes("2026-10-17", "22:00", "06:00", MAZ);
    expect(t.startsAt.toISOString()).toBe("2026-10-18T05:00:00.000Z");
    expect(t.endsAt.toISOString()).toBe("2026-10-18T13:00:00.000Z");
    expect(t.crossesMidnight).toBe(true);
    expect(t.endDate).toBe("2026-10-18");
    expect(t.durationMinutes).toBe(480);
  });

  it("cruce de medianoche en America/Bahia_Banderas (hora del centro, UTC−6)", () => {
    const t = buildShiftTimes("2026-10-17", "22:00", "06:00", BAH);
    expect(t.startsAt.toISOString()).toBe("2026-10-18T04:00:00.000Z");
    expect(t.endsAt.toISOString()).toBe("2026-10-18T12:00:00.000Z");
    expect(t.crossesMidnight).toBe(true);
    expect(t.durationMinutes).toBe(480);
  });

  it("la misma hora local es un instante distinto según la sede", () => {
    const maz = buildShiftTimes("2026-12-31", "23:30", "07:30", MAZ);
    const bah = buildShiftTimes("2026-12-31", "23:30", "07:30", BAH);
    expect(maz.startsAt.getTime() - bah.startsAt.getTime()).toBe(60 * 60_000);
    expect(maz.endDate).toBe("2027-01-01");
  });

  it("término igual al inicio = 24 horas", () => {
    const t = buildShiftTimes("2026-10-17", "08:00", "08:00", MAZ);
    expect(t.crossesMidnight).toBe(true);
    expect(t.durationMinutes).toBe(1440);
    expect(t.endsAt.toISOString()).toBe("2026-10-18T15:00:00.000Z");
  });

  it("rechaza datos inválidos", () => {
    expect(() => buildShiftTimes("2026-02-30", "08:00", "10:00", MAZ)).toThrow("Fecha inválida");
    expect(() => buildShiftTimes("2026-10-17", "24:00", "10:00", MAZ)).toThrow("Hora de inicio inválida");
    expect(() => buildShiftTimes("2026-10-17", "08:00", "8:00", MAZ)).toThrow("Hora de término inválida");
    expect(() => buildShiftTimes("2026-10-17", "08:00", "10:00", "Marte/Olympus")).toThrow("Zona horaria inválida");
  });
});

describe("describeShiftClock y splitShiftTimes", () => {
  it("lee el horario de reloj", () => {
    expect(describeShiftClock("08:00", "14:30")).toEqual({ crossesMidnight: false, durationMinutes: 390 });
    expect(describeShiftClock("22:00", "06:00")).toEqual({ crossesMidnight: true, durationMinutes: 480 });
    expect(describeShiftClock("08:00", "08:00")).toEqual({ crossesMidnight: true, durationMinutes: 1440 });
    expect(describeShiftClock("", "08:00")).toBeNull();
  });

  it("reconstruye fecha y horas de una guardia nocturna", () => {
    const s = splitShiftTimes("2026-10-18T04:00:00Z", "2026-10-18T12:00:00Z", BAH);
    expect(s).toEqual({ date: "2026-10-17", startTime: "22:00", endTime: "06:00", durationMinutes: 480, representable: true });
  });

  it("marca como no representable una guardia de más de 24 h", () => {
    const s = splitShiftTimes("2026-10-17T15:00:00Z", "2026-10-19T03:00:00Z", MAZ);
    expect(s.representable).toBe(false);
    expect(s.durationMinutes).toBe(36 * 60);
  });

  it("hasStarted compara con el momento actual", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(hasStarted("2026-10-17T11:59:00Z", now)).toBe(true);
    expect(hasStarted("2026-10-17T12:01:00Z", now)).toBe(false);
  });
});

describe("captura datetime-local en la zona de la sede", () => {
  it("convierte a UTC según la sede", () => {
    expect(localDateTimeToUtc("2026-10-17T22:05", MAZ)?.toISOString()).toBe("2026-10-18T05:05:00.000Z");
    expect(localDateTimeToUtc("2026-10-17T22:05", BAH)?.toISOString()).toBe("2026-10-18T04:05:00.000Z");
  });

  it("rechaza fechas que no existen en lugar de producir una fecha inválida", () => {
    expect(isValidLocalDateTime("2026-02-31T10:00")).toBe(false);
    expect(isValidLocalDateTime("2026-13-01T10:00")).toBe(false);
    expect(isValidLocalDateTime("2026-10-17T24:00")).toBe(false);
    expect(isValidLocalDateTime("2026-10-17T22:05")).toBe(true);
    expect(localDateTimeToUtc("2026-02-31T10:00", MAZ)).toBeNull();
    expect(localDateTimeToUtc("17/10/2026 22:05", MAZ)).toBeNull();
  });
});

describe("semanas y rangos", () => {
  it("la semana va de lunes a domingo", () => {
    expect(startOfWeek("2026-10-17")).toBe("2026-10-12"); // sábado → lunes
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12"); // domingo → lunes anterior
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
    expect(weekDays("2026-10-12")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  });

  it("suma días y genera rangos inclusivos", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysInRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(daysInRange("2026-11-02", "2026-10-30")).toEqual([]);
    expect(isValidDay("2026-13-01")).toBe(false);
  });
});

describe("filtros de /guardias", () => {
  const today = "2026-10-17";

  it("por omisión: lista de la semana actual, sin canceladas", () => {
    const f = parseShiftFilters({}, today, [FACILITY]);
    expect(f).toMatchObject({ view: "lista", facilityId: null, from: "2026-10-12", to: "2026-10-18", status: "", onlyInsufficient: false });
    expect(f.notices).toEqual([]);
    expect(includeCancelledFor(f.status)).toBe(false);
  });

  it("el calendario siempre muestra la semana completa que incluye «desde»", () => {
    const f = parseShiftFilters({ vista: "calendario", desde: "2026-10-22", hasta: "2026-12-01" }, today, [FACILITY]);
    expect(f.from).toBe("2026-10-19");
    expect(f.to).toBe("2026-10-25");
  });

  it("ignora sedes no visibles para la cuenta", () => {
    const f = parseShiftFilters({ sede: OTHER }, today, [FACILITY]);
    expect(f.facilityId).toBeNull();
    expect(f.notices.length).toBe(1);
    expect(parseShiftFilters({ sede: FACILITY }, today, [FACILITY]).facilityId).toBe(FACILITY);
  });

  it("invierte un rango al revés y limita rangos largos", () => {
    const swapped = parseShiftFilters({ desde: "2026-10-20", hasta: "2026-10-10" }, today, []);
    expect([swapped.from, swapped.to]).toEqual(["2026-10-10", "2026-10-20"]);
    const long = parseShiftFilters({ desde: "2026-01-01", hasta: "2026-12-31" }, today, []);
    expect(long.to).toBe(addDays("2026-01-01", MAX_RANGE_DAYS - 1));
    expect(long.notices.some((n) => n.includes(String(MAX_RANGE_DAYS)))).toBe(true);
  });

  it("valida estado y cobertura", () => {
    const f = parseShiftFilters({ estado: "cancelada", cobertura: "1" }, today, []);
    expect(f.status).toBe("cancelada");
    expect(f.onlyInsufficient).toBe(true);
    expect(includeCancelledFor(f.status)).toBe(true);
    expect(parseShiftFilters({ estado: "inventado" }, today, []).status).toBe("");
    expect(matchesStatus("cancelada", "")).toBe(false);
    expect(matchesStatus("cancelada", "todas")).toBe(true);
    expect(matchesStatus("en_curso", "en_curso")).toBe(true);
    expect(matchesStatus("programada", "en_curso")).toBe(false);
  });

  it("construye URLs que conservan los filtros y navega por semanas", () => {
    const f = parseShiftFilters({ sede: FACILITY, estado: "programada", cobertura: "1" }, today, [FACILITY]);
    const next = shiftRangeByWeeks(f, 1);
    expect(next).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    const href = guardiasHref(f, next);
    expect(href).toBe(`/guardias?sede=${FACILITY}&desde=2026-10-19&hasta=2026-10-25&estado=programada&cobertura=1`);
    expect(guardiasHref(f, { view: "calendario" })).toBe(`/guardias?vista=calendario&sede=${FACILITY}&desde=2026-10-12&estado=programada&cobertura=1`);
  });
});

function item(startsAt: string, tz: string, overrides: Partial<FilterableShift> = {}): FilterableShift & { id: string } {
  return {
    id: startsAt + tz,
    effectiveStatus: "programada",
    coverage: { insufficient: false },
    shift: { starts_at: startsAt },
    facility: { timezone: tz },
    ...overrides,
  };
}

describe("filtrado y agrupación por día de inicio", () => {
  it("una guardia que cruza medianoche queda en su día de inicio (zona de la sede)", () => {
    // 22:00 del domingo 18 en Mazatlán = 05:00 UTC del lunes 19.
    const night = item("2026-10-19T05:00:00Z", MAZ);
    const groups = groupByStartDay([night], weekDays("2026-10-12"), MAZ);
    expect(groups.get("2026-10-18")).toHaveLength(1);
    expect(applyShiftFilters([night], { from: "2026-10-12", to: "2026-10-18", status: "", onlyInsufficient: false })).toHaveLength(1);
  });

  it("usa la zona de cada sede: el mismo instante puede caer en días distintos", () => {
    // 06:30 UTC = 23:30 del día 17 en Mazatlán, 00:30 del día 18 en Bahía de Banderas.
    const maz = item("2026-10-18T06:30:00Z", MAZ);
    const bah = item("2026-10-18T06:30:00Z", BAH);
    const groups = groupByStartDay([maz, bah], ["2026-10-17", "2026-10-18"]);
    expect(groups.get("2026-10-17")).toEqual([maz]);
    expect(groups.get("2026-10-18")).toEqual([bah]);
  });

  it("filtra por estado efectivo y cobertura insuficiente", () => {
    const a = item("2026-10-14T15:00:00Z", MAZ, { effectiveStatus: "en_curso", coverage: { insufficient: true } });
    const b = item("2026-10-14T16:00:00Z", MAZ, { effectiveStatus: "cancelada" });
    const c = item("2026-10-14T17:00:00Z", MAZ, { effectiveStatus: "programada" });
    const base = { from: "2026-10-12", to: "2026-10-18" };
    expect(applyShiftFilters([a, b, c], { ...base, status: "", onlyInsufficient: false })).toEqual([a, c]);
    expect(applyShiftFilters([a, b, c], { ...base, status: "todas", onlyInsufficient: false })).toHaveLength(3);
    expect(applyShiftFilters([a, b, c], { ...base, status: "", onlyInsufficient: true })).toEqual([a]);
    expect(applyShiftFilters([a, b, c], { ...base, status: "cancelada", onlyInsufficient: false })).toEqual([b]);
    expect(applyShiftFilters([a], { from: "2026-10-15", to: "2026-10-18", status: "", onlyInsufficient: false })).toEqual([]);
  });
});

describe("formatos", () => {
  it("rango compacto con «+1 día» en la zona de la sede", () => {
    expect(formatTimeRangeCompact("2026-10-18T05:00:00Z", "2026-10-18T13:00:00Z", MAZ)).toBe("22:00 – 06:00 (+1 día)");
    expect(formatTimeRangeCompact("2026-10-17T15:00:00Z", "2026-10-17T21:00:00Z", MAZ)).toBe("08:00 – 14:00");
    expect(formatTimeRangeCompact("2026-10-17T15:00:00Z", "2026-10-19T15:00:00Z", MAZ)).toBe("08:00 – 08:00 (+2 días)");
  });

  it("cobertura, diferencia, título y zona", () => {
    expect(staffingSummary({ assigned: 1, minStaff: 3, maxStaff: 6 })).toBe("1 asignado (mín. 3, máx. 6)");
    expect(staffingSummary({ assigned: 4, minStaff: 2, maxStaff: null })).toBe("4 asignados (mín. 2, sin máximo)");
    expect(formatSignedDuration(30)).toBe("+30 min");
    expect(formatSignedDuration(-90)).toBe("−1 h 30 min");
    expect(formatSignedDuration(0)).toBe("0 min");
    expect(shiftDisplayTitle({ title: "  ", meeting_point: "Acceso principal" })).toBe("Acceso principal");
    expect(shiftDisplayTitle({ title: "Guardia nocturna", meeting_point: "Acceso principal" })).toBe("Guardia nocturna");
    expect(timezoneLabel(BAH)).toContain("Centro");
    expect(timezoneLabel("Europe/Madrid")).toBe("Europe/Madrid");
  });
});

function fd(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
}

describe("validación de formularios", () => {
  const base = {
    facility_id: FACILITY,
    title: "  ",
    meeting_point: " Acceso principal ",
    date: "2026-10-17",
    start_time: "22:00",
    end_time: "06:00",
    min_staff: "2",
    max_staff: "",
    instructions: "",
  };

  it("readForm recorta espacios y convierte vacíos en undefined", () => {
    const v = readForm(fd(base), SHIFT_FORM_FIELDS);
    expect(v.title).toBeUndefined();
    expect(v.meeting_point).toBe("Acceso principal");
    expect(v.max_staff).toBeUndefined();
    expect(v.id).toBeUndefined();
  });

  it("acepta una guardia válida y convierte cupos a número", () => {
    const r = shiftFormSchema.safeParse(readForm(fd(base), SHIFT_FORM_FIELDS));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.min_staff).toBe(2);
      expect(r.data.max_staff).toBeUndefined();
    }
  });

  it("cupo máximo menor al mínimo y motivo obligatorio al editar", () => {
    const r = shiftFormSchema.safeParse(
      readForm(fd({ ...base, id: "d2000000-0000-4000-8000-000000000001", max_staff: "1", change_reason: "abc" }), SHIFT_FORM_FIELDS),
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      const errors = fieldErrorsFrom(r.error);
      expect(errors.max_staff).toMatch(/mayor o igual/);
      expect(errors.change_reason).toMatch(/motivo/);
    }
  });

  it("campos obligatorios vacíos", () => {
    const r = shiftFormSchema.safeParse(readForm(fd({ ...base, meeting_point: "", min_staff: "", date: "2026-02-31" }), SHIFT_FORM_FIELDS));
    expect(r.success).toBe(false);
    if (!r.success) {
      const errors = fieldErrorsFrom(r.error);
      expect(Object.keys(errors).sort()).toEqual(["date", "meeting_point", "min_staff"]);
    }
  });

  it("una persona no puede sustituirse a sí misma", () => {
    const r = addAssignmentSchema.safeParse({ shift_id: FACILITY, worker_id: OTHER, substitute_for_worker_id: OTHER });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsFrom(r.error).substitute_for_worker_id).toBeDefined();
  });

  it("corrección: motivo de al menos 5 caracteres y horas con formato datetime-local", () => {
    const ok = correctSessionSchema.safeParse({ session_id: FACILITY, check_in: "2026-10-17T22:05", reason: "Olvidó registrar" });
    expect(ok.success).toBe(true);
    const bad = correctSessionSchema.safeParse({ session_id: FACILITY, check_in: "17/10/2026 22:05", reason: "no" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(Object.keys(fieldErrorsFrom(bad.error)).sort()).toEqual(["check_in", "reason"]);
    const impossible = correctSessionSchema.safeParse({ session_id: FACILITY, check_in: "2026-02-31T22:05", reason: "Olvidó registrar" });
    expect(impossible.success).toBe(false);
    if (!impossible.success) expect(fieldErrorsFrom(impossible.error).check_in).toMatch(/fecha y hora válidas/);
  });

  it("registro manual: exige solicitud generada por el servidor y ambas horas", () => {
    const base = { assignment_id: FACILITY, request_id: OTHER, check_in: "2026-10-17T22:00", check_out: "2026-10-18T06:00", reason: "No pudo registrar" };
    expect(manualSessionSchema.safeParse(base).success).toBe(true);
    const missing = manualSessionSchema.safeParse({ ...base, request_id: undefined, check_out: undefined });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(Object.keys(fieldErrorsFrom(missing.error)).sort()).toEqual(["check_out", "request_id"]);
  });
});

describe("quién registró", () => {
  const names = { u1: "Coordinación (demo)", w1: "Ana (demo)" };
  it("describe la cuenta según lo visible", () => {
    expect(describeActor("me", names, { currentUserId: "me" })).toBe("Tú");
    expect(describeActor("u1", names, { currentUserId: "me", method: "coordinador" })).toBe("Coordinación (demo)");
    expect(describeActor("w1", names, { currentUserId: "me", workerProfileId: "w1", method: "propio" })).toBe("Ana (demo) (la propia persona)");
    expect(describeActor("x", names, { currentUserId: "me", method: "coordinador" })).toBe("Coordinación o administración");
    expect(describeActor("x", names, { currentUserId: "me", method: "propio" })).toBe("La propia persona");
    expect(describeActor(null, names, { currentUserId: "me" })).toBe("—");
  });

  it("después de «por» la cuenta propia se escribe «ti»", () => {
    expect(`Corregido por ${afterPreposition(describeActor("me", names, { currentUserId: "me" }))}`).toBe("Corregido por ti");
    expect(`Corregido por ${afterPreposition(describeActor("u1", names, { currentUserId: "me" }))}`).toBe("Corregido por Coordinación (demo)");
  });

  it("reúne ids sin repetir", () => {
    const ids = collectActorIds([
      { check_in_by: "a", check_out_by: "b", status_changed_by: null },
      { check_in_by: "a", check_out_by: null, status_changed_by: "c" },
    ]);
    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("reglas de la BD reflejadas en la interfaz", () => {
  // Guardia 22:00 (17/10) – 06:00 (18/10) en Mazatlán.
  const night = { starts_at: "2026-10-18T05:00:00Z", ends_at: "2026-10-18T13:00:00Z" };

  it("propia asistencia: bloqueada salvo para administración", () => {
    expect(isOwnRecordLocked({ isAdmin: false, workerId: "w1" }, "w1")).toBe(true);
    expect(isOwnRecordLocked({ isAdmin: true, workerId: "w1" }, "w1")).toBe(false);
    expect(isOwnRecordLocked({ isAdmin: false, workerId: "w1" }, "w2")).toBe(false);
    expect(isOwnRecordLocked({ isAdmin: false, workerId: null }, "w1")).toBe(false);
    expect(isOwnRecordLocked({ isAdmin: false, workerId: null }, null)).toBe(false);
  });

  it("entrada abierta vencida: después de término + margen", () => {
    const base = { hasOpenSession: true, shiftEndsAt: night.ends_at, graceMinutes: 240 };
    expect(isOpenSessionStale({ ...base, now: new Date("2026-10-18T17:00:00Z") })).toBe(false); // justo en el margen
    expect(isOpenSessionStale({ ...base, now: new Date("2026-10-18T17:00:01Z") })).toBe(true);
    expect(isOpenSessionStale({ ...base, hasOpenSession: false, now: new Date("2026-10-19T00:00:00Z") })).toBe(false);
    expect(isOpenSessionStale({ ...base, graceMinutes: 0, now: new Date("2026-10-18T13:01:00Z") })).toBe(true);
  });

  it("horario bloqueado con asistencia vigente, salvo administración", () => {
    expect(isScheduleLocked({ isAdmin: false }, 1)).toBe(true);
    expect(isScheduleLocked({ isAdmin: false }, 0)).toBe(false);
    expect(isScheduleLocked({ isAdmin: true }, 5)).toBe(false);
  });

  it("ventana de captura: la guardia ±12 h, y límites del input nunca en el futuro", () => {
    const w = captureWindow(night);
    expect(w.min.toISOString()).toBe("2026-10-17T17:00:00.000Z");
    expect(w.max.toISOString()).toBe("2026-10-19T01:00:00.000Z");
    expect(describeCaptureWindow(night, MAZ)).toBe("17/10/2026 10:00 y 18/10/2026 18:00");
    expect(captureInputBounds(night, new Date("2026-10-18T16:00:00Z"), MAZ)).toEqual({ min: "2026-10-17T10:00", max: "2026-10-18T09:00" });
    expect(captureInputBounds(night, new Date("2026-10-25T00:00:00Z"), MAZ)).toEqual({ min: "2026-10-17T10:00", max: "2026-10-18T18:00" });
  });

  it("valida horas capturadas: futuras y fuera de la ventana con mensaje claro", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const opts = { now, tz: MAZ };
    expect(validateCapturedTimes(night, new Date("2026-10-18T05:10:00Z"), new Date("2026-10-18T13:00:00Z"), opts)).toBeNull();
    expect(validateCapturedTimes(night, new Date("2026-10-17T17:00:00Z"), null, opts)).toBeNull(); // límite exacto

    const early = validateCapturedTimes(night, new Date("2026-10-17T16:59:00Z"), new Date("2026-10-18T13:00:00Z"), opts);
    expect(early?.message).toBe(`${OUTSIDE_WINDOW_MESSAGE}: entre 17/10/2026 10:00 y 18/10/2026 18:00.`);
    expect(early?.fieldErrors).toEqual({ check_in: "Debe estar entre 17/10/2026 10:00 y 18/10/2026 18:00." });

    const lateOut = validateCapturedTimes(night, new Date("2026-10-18T05:00:00Z"), new Date("2026-10-19T01:01:00Z"), opts);
    expect(Object.keys(lateOut?.fieldErrors ?? {})).toEqual(["check_out"]);

    const future = validateCapturedTimes(night, new Date("2026-10-18T05:00:00Z"), new Date("2026-10-18T13:00:00Z"), {
      now: new Date("2026-10-18T10:00:00Z"),
      tz: MAZ,
    });
    expect(future).toEqual({ message: FUTURE_TIME_MESSAGE, fieldErrors: { check_out: "No puede ser una hora futura." } });
  });

  it("edición: sin cambios en fecha y horas se conserva el horario guardado (también si dura más de 24 h)", () => {
    const same = resolveEditedSchedule(night, { date: "2026-10-17", start_time: "22:00", end_time: "06:00" }, MAZ, MAZ);
    expect(same.changed).toBe(false);
    expect(same.startsAt.toISOString()).toBe("2026-10-18T05:00:00.000Z");

    const long = { starts_at: "2026-10-18T05:00:00Z", ends_at: "2026-10-19T11:00:00Z" }; // 30 h
    const split = splitShiftTimes(long.starts_at, long.ends_at, MAZ);
    const kept = resolveEditedSchedule(long, { date: split.date, start_time: split.startTime, end_time: split.endTime }, MAZ, MAZ);
    expect(kept.changed).toBe(false);
    expect(kept.endsAt.toISOString()).toBe("2026-10-19T11:00:00.000Z");

    const moved = resolveEditedSchedule(night, { date: "2026-10-17", start_time: "21:00", end_time: "06:00" }, MAZ, MAZ);
    expect(moved.changed).toBe(true);
    expect(moved.startsAt.toISOString()).toBe("2026-10-18T04:00:00.000Z");

    // Otra sede con otra zona: se reinterpreta en la zona nueva.
    const otherZone = resolveEditedSchedule(night, { date: "2026-10-17", start_time: "22:00", end_time: "06:00" }, MAZ, BAH);
    expect(otherZone.changed).toBe(true);
    expect(otherZone.startsAt.toISOString()).toBe("2026-10-18T04:00:00.000Z");
  });

  it("sustitución visible: «Cubre a <nombre>»", () => {
    expect(coverLabel({ full_name: "Ana López" }, "w1")).toBe("Cubre a Ana López");
    expect(coverLabel(null, "w1")).toBe("Cubre a una persona no visible para tu cuenta");
    expect(coverLabel(null, null)).toBeNull();
  });
});

describe("cupo máximo y corrección de asignaciones", () => {
  it("el cupo máximo no queda por debajo de las asignaciones activas", () => {
    expect(maxStaffBelowAssigned(undefined, 4)).toBeNull();
    expect(maxStaffBelowAssigned(null, 4)).toBeNull();
    expect(maxStaffBelowAssigned(4, 4)).toBeNull();
    expect(maxStaffBelowAssigned(1, 2)).toMatch(/^La guardia tiene 2 personas asignadas: el cupo máximo no puede ser menor\./);
    expect(maxStaffBelowAssigned(0, 1)).toMatch(/^La guardia tiene 1 persona asignada:/);
  });

  it("editar asignación: motivo obligatorio y campos opcionales", () => {
    const keys = ["assignment_id", "assigned_point", "substitute_for_worker_id", "notes", "reason"] as const;
    const ok = updateAssignmentSchema.safeParse(
      readForm(fd({ assignment_id: "d3000000-0000-4000-8000-000000000001", assigned_point: " ", notes: "", reason: " Cubre una incapacidad " }), keys),
    );
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toEqual({ assignment_id: "d3000000-0000-4000-8000-000000000001", reason: "Cubre una incapacidad" });
    const bad = updateAssignmentSchema.safeParse(readForm(fd({ assignment_id: "x", substitute_for_worker_id: "y", reason: "ok" }), keys));
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(fieldErrorsFrom(bad.error)).toEqual({
        assignment_id: "Asignación inválida.",
        substitute_for_worker_id: "Persona sustituida inválida.",
        reason: "Indica el motivo del cambio (mínimo 5 caracteres).",
      });
    }
  });
});
