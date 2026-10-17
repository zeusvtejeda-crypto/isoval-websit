import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_DEFAULTS,
  RETENTION_DEFAULTS,
  attendanceSettingsFormSchema,
  attendanceSettingsSchema,
  demoTotal,
  describeAppliedRetention,
  describeDemoCounts,
  isConfirmed,
  mergeSettingValue,
  parseDemoPurgeResult,
  parseRetentionImpact,
  privacyNoticeFormSchema,
  privacyNoticeSchema,
  readAttendanceSettings,
  readAttendanceSettingsForm,
  readPrivacyNotice,
  readPrivacyNoticeForm,
  readRetention,
  readRetentionForm,
  retentionFormSchema,
  retentionImpactIsEmpty,
  retentionSchema,
  splitReason,
} from "@/lib/admin/settings";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe("aviso de privacidad", () => {
  it("lee el valor guardado con valores por omisión seguros", () => {
    expect(readPrivacyNotice(null)).toEqual({ title: "Aviso de privacidad", body: "", responsible: null, contact: null, legal_review_status: "pendiente" });
    const n = readPrivacyNotice({ title: "Aviso", body: "Texto", responsible: " ", contact: "c@x.mx", legal_review_status: "aprobado" });
    expect(n.responsible).toBeNull();
    expect(n.contact).toBe("c@x.mx");
    expect(n.legal_review_status).toBe("aprobado");
    // Cualquier otro valor se considera pendiente.
    expect(readPrivacyNotice({ legal_review_status: "otro" }).legal_review_status).toBe("pendiente");
  });

  it("valida el formulario y conserva saltos de línea", () => {
    const raw = readPrivacyNoticeForm(
      form({ title: " Aviso ", body: "  Línea 1\r\nLínea 2 con más texto  ", responsible: "", contact: "x@y.mx", legal_review_status: "pendiente" }),
    );
    const r = privacyNoticeSchema.safeParse(raw);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.body).toBe("Línea 1\nLínea 2 con más texto");
      expect(r.data.responsible).toBeNull();
      expect(r.data.title).toBe("Aviso");
    }
    const bad = privacyNoticeSchema.safeParse(readPrivacyNoticeForm(form({ title: "A", body: "corto", legal_review_status: "x" })));
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["title", "body", "legal_review_status"]));
  });
});

describe("conservación de datos", () => {
  it("lee periodos con valores por omisión", () => {
    expect(readRetention(undefined)).toEqual(RETENTION_DEFAULTS);
    expect(RETENTION_DEFAULTS.inactive_worker_months).toBe(24);
    expect(readRetention({ attendance_months: "12", audit_months: 36 })).toEqual({ attendance_months: 12, audit_months: 36, inactive_worker_months: 24 });
    expect(readRetention({ attendance_months: 12, audit_months: 36, inactive_worker_months: "6" }).inactive_worker_months).toBe(6);
  });

  it("exige enteros de al menos 1 mes", () => {
    const ok = retentionSchema.safeParse(readRetentionForm(form({ attendance_months: "1", audit_months: "600", inactive_worker_months: "18" })));
    expect(ok.success && ok.data).toEqual({ attendance_months: 1, audit_months: 600, inactive_worker_months: 18 });
    for (const bad of ["0", "-3", "1.5", "", "abc", "601"]) {
      expect(
        retentionSchema.safeParse(readRetentionForm(form({ attendance_months: bad, audit_months: "12", inactive_worker_months: "24" }))).success,
      ).toBe(false);
      const r = retentionSchema.safeParse(readRetentionForm(form({ attendance_months: "12", audit_months: "12", inactive_worker_months: bad })));
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toEqual(["inactive_worker_months"]);
    }
    // Sin el campo nuevo, el formulario no es válido (no se guarda un periodo vacío).
    expect(retentionSchema.safeParse(readRetentionForm(form({ attendance_months: "12", audit_months: "12" }))).success).toBe(false);
  });

  it("interpreta el resultado de apply_retention_policy", () => {
    const impact = parseRetentionImpact({
      executed: false,
      attendance_cutoff: "2024-10-17T12:00:00+00:00",
      audit_cutoff: "2021-10-17T12:00:00+00:00",
      inactive_worker_cutoff: "2024-10-17T12:00:00+00:00",
      shifts: 3,
      sessions: 10,
      audit_rows: 0,
      worker_private_rows: 2,
      audit_rows_redacted: 5,
    });
    expect(impact).toEqual({
      executed: false,
      attendanceCutoff: "2024-10-17T12:00:00+00:00",
      auditCutoff: "2021-10-17T12:00:00+00:00",
      inactiveWorkerCutoff: "2024-10-17T12:00:00+00:00",
      shifts: 3,
      sessions: 10,
      auditRows: 0,
      workerPrivateRows: 2,
      auditRowsRedacted: 5,
    });
    expect(retentionImpactIsEmpty(impact!)).toBe(false);
    // Los datos privados de trabajadores inactivos también cuentan como impacto.
    expect(retentionImpactIsEmpty({ ...impact!, shifts: 0, sessions: 0, auditRowsRedacted: 0 })).toBe(false);
    // Y también las copias en la bitácora que se redactarían.
    expect(retentionImpactIsEmpty({ ...impact!, shifts: 0, sessions: 0, workerPrivateRows: 0 })).toBe(false);
    expect(retentionImpactIsEmpty({ ...impact!, shifts: 0, sessions: 0, workerPrivateRows: 0, auditRowsRedacted: 0 })).toBe(true);
    expect(parseRetentionImpact("x")).toBeNull();
  });

  it("tolera respuestas de la versión anterior de la función", () => {
    const impact = parseRetentionImpact({ executed: true, shifts: 1, sessions: 2, audit_rows: 3 });
    expect(impact?.workerPrivateRows).toBe(0);
    expect(impact?.auditRowsRedacted).toBe(0);
    expect(impact?.inactiveWorkerCutoff).toBeNull();
  });

  it("resume lo eliminado al aplicar", () => {
    const impact = parseRetentionImpact({ executed: true, shifts: 1, sessions: 12, audit_rows: 0, worker_private_rows: 3, audit_rows_redacted: 40 })!;
    expect(describeAppliedRetention(impact)).toBe(
      "Política aplicada. Se eliminaron 1 guardia, 12 registros de entrada y salida, 0 eventos de bitácora y los datos privados de 3 trabajadores inactivos; " +
        "se borró el contenido de 40 eventos de bitácora que los copiaban. Quedó constancia en la bitácora.",
    );
  });
});

describe("registro de asistencia", () => {
  it("lee valores con omisión", () => {
    expect(readAttendanceSettings({})).toEqual(ATTENDANCE_DEFAULTS);
    expect(readAttendanceSettings({ checkin_window_before_minutes: 30, open_session_grace_minutes: 60 })).toEqual({
      checkin_window_before_minutes: 30,
      open_session_grace_minutes: 60,
    });
  });

  it("valida minutos enteros dentro de rango", () => {
    const ok = attendanceSettingsSchema.safeParse(readAttendanceSettingsForm(form({ checkin_window_before_minutes: "0", open_session_grace_minutes: "240" })));
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toEqual({ checkin_window_before_minutes: 0, open_session_grace_minutes: 240 });
    expect(attendanceSettingsSchema.safeParse({ checkin_window_before_minutes: "1441", open_session_grace_minutes: "10" }).success).toBe(false);
    expect(attendanceSettingsSchema.safeParse({ checkin_window_before_minutes: "-1", open_session_grace_minutes: "10" }).success).toBe(false);
    expect(attendanceSettingsSchema.safeParse({ checkin_window_before_minutes: "10", open_session_grace_minutes: "2881" }).success).toBe(false);
  });
});

describe("datos de demostración y utilidades", () => {
  it("interpreta el resultado y lo describe", () => {
    const c = parseDemoPurgeResult({ facilities: 1, workers: 8, shifts: "4" });
    expect(c).toEqual({ facilities: 1, workers: 8, shifts: 4 });
    expect(demoTotal(c)).toBe(13);
    expect(describeDemoCounts(c)).toBe("1 instalación, 8 trabajadores y 4 guardias");
    expect(parseDemoPurgeResult(null)).toEqual({ facilities: 0, workers: 0, shifts: 0 });
  });

  it("reconoce la casilla de confirmación", () => {
    expect(isConfirmed(form({ confirm: "on" }))).toBe(true);
    expect(isConfirmed(form({}))).toBe(false);
    expect(isConfirmed(form({ confirm: "no" }))).toBe(false);
  });

  it("conserva claves desconocidas al guardar", () => {
    expect(mergeSettingValue({ a: 1, title: "x" }, { title: "y" })).toEqual({ a: 1, title: "y" });
    expect(mergeSettingValue(null, { title: "y" })).toEqual({ title: "y" });
  });
});

describe("motivo del cambio en la configuración", () => {
  const privacy = { title: "Aviso", body: "Texto del aviso con suficiente longitud.", legal_review_status: "pendiente" };

  it("los tres formularios exigen motivo de al menos 5 caracteres", () => {
    const cases = [
      privacyNoticeFormSchema.safeParse(readPrivacyNoticeForm(form(privacy))),
      retentionFormSchema.safeParse(readRetentionForm(form({ attendance_months: "24", audit_months: "60", inactive_worker_months: "24", reason: "abc" }))),
      attendanceSettingsFormSchema.safeParse(
        readAttendanceSettingsForm(form({ checkin_window_before_minutes: "60", open_session_grace_minutes: "120", reason: "    " })),
      ),
    ];
    for (const r of cases) {
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toEqual(["reason"]);
    }
  });

  it("el motivo va a la bitácora y no se mezcla con el valor guardado", () => {
    const r = retentionFormSchema.safeParse(
      readRetentionForm(form({ attendance_months: "24", audit_months: "60", inactive_worker_months: "18", reason: "  Acuerdo del comité  " })),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    const { reason, value } = splitReason(r.data);
    expect(reason).toBe("Acuerdo del comité");
    expect(value).toEqual({ attendance_months: 24, audit_months: 60, inactive_worker_months: 18 });
    expect(mergeSettingValue({ attendance_months: 12, extra: true }, value)).not.toHaveProperty("reason");

    const p = privacyNoticeFormSchema.safeParse(readPrivacyNoticeForm(form({ ...privacy, reason: "Revisión jurídica pendiente" })));
    expect(p.success && splitReason(p.data).value).toEqual({ ...privacy, responsible: null, contact: null });
  });
});
