import { describe, expect, it } from "vitest";
import {
  OWN_REVIEW_DB_MESSAGES,
  OWN_REVIEW_MESSAGE,
  SHIFT_WINDOW_MESSAGE,
  absenceRequestHint,
  correctionContext,
  correctionRequestBlock,
  describeCorrection,
  isRevertibleAbsence,
  isWithinShiftWindow,
  ownReviewBlock,
  parseCorrectionTab,
  parseReview,
  parseReviewResult,
  shiftWindow,
} from "@/lib/reports/corrections";
import { actorLabel } from "@/lib/reports/actors";

const REQ = "c0000000-0000-4000-8000-000000000001";
const MZT = "America/Mazatlan";
const BDB = "America/Bahia_Banderas";

describe("parseReview", () => {
  it("aprobar no exige notas", () => {
    expect(parseReview({ requestId: REQ, decision: "aprobar", notes: "  " })).toEqual({
      ok: true,
      input: { requestId: REQ, approve: true, notes: null },
    });
  });

  it("rechazar exige notas de al menos 3 caracteres", () => {
    const r = parseReview({ requestId: REQ, decision: "rechazar", notes: " no" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.notes).toMatch(/motivo/);
    expect(parseReview({ requestId: REQ, decision: "rechazar", notes: "Faltan las horas de salida" })).toMatchObject({
      ok: true,
      input: { approve: false, notes: "Faltan las horas de salida" },
    });
  });

  it("valida la solicitud y la decisión", () => {
    expect(parseReview({ requestId: "123", decision: "aprobar", notes: "" }).ok).toBe(false);
    expect(parseReview({ requestId: REQ, decision: "borrar", notes: "" }).ok).toBe(false);
    expect(parseReview({ requestId: null, decision: null, notes: null }).ok).toBe(false);
    expect(parseReview({ requestId: REQ, decision: "aprobar", notes: "x".repeat(1001) }).ok).toBe(false);
  });
});

describe("describeCorrection", () => {
  const session = { check_in_at: "2026-10-17T15:20:00Z", check_out_at: "2026-10-17T23:00:00Z", record_status: "vigente" as const };

  it("compara horas actuales y solicitadas en la zona de la sede", () => {
    const view = describeCorrection(
      { session_id: "s1", requested_check_in_at: "2026-10-17T15:00:00Z", requested_check_out_at: null },
      session,
      MZT,
    );
    expect(view.kind).toBe("ajuste");
    expect(view.current).toEqual({ checkIn: "17/10/2026 08:20", checkOut: "17/10/2026 16:00", status: "vigente" });
    expect(view.requested).toEqual({ checkIn: "17/10/2026 08:00", checkOut: null });
    expect(view.result).toEqual({ checkIn: "17/10/2026 08:00", checkOut: "17/10/2026 16:00" });
    expect(view.canApprove).toBe(true);
    expect(view.warnings).toEqual([]);
    // Misma solicitud en una sede con otra zona.
    expect(describeCorrection({ session_id: "s1", requested_check_in_at: "2026-10-17T15:00:00Z", requested_check_out_at: null }, session, BDB).requested.checkIn).toBe(
      "17/10/2026 09:00",
    );
  });

  it("avisa si el registro ya no está vigente", () => {
    const view = describeCorrection({ session_id: "s1", requested_check_in_at: "2026-10-17T15:00:00Z", requested_check_out_at: null }, { ...session, record_status: "corregido" }, MZT);
    expect(view.canApprove).toBe(false);
    expect(view.warnings[0]).toMatch(/corregido o anulado/);
  });

  it("un registro nuevo necesita ambas horas", () => {
    const partial = describeCorrection({ session_id: null, requested_check_in_at: "2026-10-17T15:00:00Z", requested_check_out_at: null }, null, MZT);
    expect(partial.kind).toBe("nuevo");
    expect(partial.canApprove).toBe(false);
    const complete = describeCorrection({ session_id: null, requested_check_in_at: "2026-10-17T15:00:00Z", requested_check_out_at: "2026-10-17T23:00:00Z" }, null, MZT);
    expect(complete.canApprove).toBe(true);
    expect(complete.current).toEqual({ checkIn: null, checkOut: null, status: null });
  });

  it("detecta una salida que quedaría antes de la entrada", () => {
    const view = describeCorrection({ session_id: "s1", requested_check_in_at: "2026-10-17T23:30:00Z", requested_check_out_at: null }, session, MZT);
    expect(view.canApprove).toBe(false);
  });
});

describe("describeCorrection: reglas de la base de datos", () => {
  // Guardia 08:00–16:00 en Mazatlán.
  const shift = { starts_at: "2026-10-17T15:00:00Z", ends_at: "2026-10-17T23:00:00Z", status: "finalizada" };
  const session = { check_in_at: "2026-10-17T15:20:00Z", check_out_at: null, record_status: "vigente" as const };

  it("acepta horas dentro de la guardia ±12 h", () => {
    const view = describeCorrection(
      { session_id: "s1", requested_check_in_at: null, requested_check_out_at: "2026-10-18T10:00:00Z" }, // término + 11 h
      session,
      MZT,
      { shift, assignmentStatus: "asignado" },
    );
    expect(view.canApprove).toBe(true);
    expect(view.warnings).toEqual([]);
  });

  it("anticipa el rechazo de horas fuera de la ventana de la guardia", () => {
    const view = describeCorrection(
      { session_id: "s1", requested_check_in_at: null, requested_check_out_at: "2026-10-18T11:01:00Z" }, // término + 12 h 1 min
      session,
      MZT,
      { shift, assignmentStatus: "asignado" },
    );
    expect(view.canApprove).toBe(false);
    expect(view.warnings.join(" ")).toContain(SHIFT_WINDOW_MESSAGE);
    const early = describeCorrection(
      { session_id: null, requested_check_in_at: "2026-10-17T02:59:00Z", requested_check_out_at: "2026-10-17T16:00:00Z" }, // inicio − 12 h 1 min
      null,
      MZT,
      { shift, assignmentStatus: "asignado" },
    );
    expect(early.canApprove).toBe(false);
  });

  it("un registro nuevo no se aprueba en guardias ni asignaciones canceladas", () => {
    const req = { session_id: null, requested_check_in_at: "2026-10-17T15:00:00Z", requested_check_out_at: "2026-10-17T23:00:00Z" };
    const active = describeCorrection(req, null, MZT, { shift, assignmentStatus: "asignado" });
    expect(active.canApprove).toBe(true);
    expect(active.revertNote).toBeNull();
    const cancelled = describeCorrection(req, null, MZT, { shift: { ...shift, status: "cancelada" }, assignmentStatus: "asignado" });
    expect(cancelled.canApprove).toBe(false);
    expect(cancelled.warnings.join(" ")).toMatch(/guardia está cancelada/);
    const cancelledAssignment = describeCorrection(req, null, MZT, { shift, assignmentStatus: "cancelado" });
    expect(cancelledAssignment.canApprove).toBe(false);
    expect(cancelledAssignment.warnings.join(" ")).toMatch(/asignación está cancelada/);
    expect(cancelledAssignment.revertNote).toBeNull();
  });

  it("un registro nuevo sobre una ausencia o inasistencia se aprueba y avisa que revierte el estado", () => {
    const req = { session_id: null, requested_check_in_at: "2026-10-17T15:00:00Z", requested_check_out_at: "2026-10-17T23:00:00Z" };
    const absent = describeCorrection(req, null, MZT, {
      shift,
      assignmentStatus: "inasistencia_confirmada",
      assignmentStatusReason: "  No se presentó según el responsable ",
    });
    expect(absent.canApprove).toBe(true);
    expect(absent.warnings).toEqual([]);
    expect(absent.revertNote).toBe(
      "La asignación está registrada como «Inasistencia confirmada» (motivo: No se presentó según el responsable). " +
        "Si apruebas, deja de contar como «Inasistencia confirmada», vuelve a «Asignado» y se agrega el registro solicitado. " +
        "El cambio queda en la bitácora con el motivo de la solicitud y tus notas de revisión.",
    );
    const justified = describeCorrection(req, null, MZT, { shift, assignmentStatus: "ausencia_justificada" });
    expect(justified.canApprove).toBe(true);
    expect(justified.revertNote).toMatch(/^La asignación está registrada como «Ausencia justificada»\. Si apruebas/);
    // Con la guardia cancelada no se aprueba (la base de datos la rechaza).
    expect(describeCorrection(req, null, MZT, { shift: { ...shift, status: "cancelada" }, assignmentStatus: "ausencia_justificada" }).canApprove).toBe(false);
    // Faltan horas: sigue sin poder aprobarse.
    const partial = describeCorrection({ ...req, requested_check_out_at: null }, null, MZT, { shift, assignmentStatus: "inasistencia_confirmada" });
    expect(partial.canApprove).toBe(false);
  });

  it("sin contexto se comporta como antes", () => {
    const view = describeCorrection({ session_id: "s1", requested_check_in_at: null, requested_check_out_at: "2026-10-25T00:00:00Z" }, session, MZT);
    expect(view.canApprove).toBe(true);
  });

  it("obtiene el contexto de una solicitud cargada", () => {
    expect(correctionContext({ assignment: { status: "asignado", shift } })).toEqual({ shift, assignmentStatus: "asignado", assignmentStatusReason: null });
    expect(correctionContext({ assignment: { status: "inasistencia_confirmada", status_reason: "No llegó", shift } })).toEqual({
      shift,
      assignmentStatus: "inasistencia_confirmada",
      assignmentStatusReason: "No llegó",
    });
    expect(correctionContext({ assignment: null })).toEqual({ shift: null, assignmentStatus: null, assignmentStatusReason: null });
  });

  it("calcula la ventana de la guardia (±12 h, extremos incluidos)", () => {
    const w = shiftWindow(shift);
    expect(w.start.toISOString()).toBe("2026-10-17T03:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-18T11:00:00.000Z");
    expect(isWithinShiftWindow(shift, "2026-10-17T03:00:00Z", "2026-10-18T11:00:00Z")).toBe(true);
    expect(isWithinShiftWindow(shift, null, undefined)).toBe(true);
    expect(isWithinShiftWindow(shift, "2026-10-17T02:59:59Z")).toBe(false);
    expect(isWithinShiftWindow(shift, new Date("2026-10-18T11:00:01Z"))).toBe(false);
  });
});

describe("solicitudes que no se ofrecen", () => {
  it("no se solicitan correcciones de guardias ni asignaciones canceladas", () => {
    expect(correctionRequestBlock("finalizada", "asignado")).toBeNull();
    expect(correctionRequestBlock("programada", "asignado")).toBeNull();
    expect(correctionRequestBlock("cancelada", "asignado")).toBe("La guardia está cancelada: no se pueden solicitar correcciones de esta guardia.");
    expect(correctionRequestBlock("cancelada", "inasistencia_confirmada")).toMatch(/guardia está cancelada/);
    expect(correctionRequestBlock("finalizada", "cancelado")).toBe("La asignación está cancelada: no se pueden solicitar correcciones de esta guardia.");
  });

  it("una ausencia justificada o una inasistencia confirmada sí se impugna", () => {
    expect(correctionRequestBlock("finalizada", "inasistencia_confirmada")).toBeNull();
    expect(correctionRequestBlock("finalizada", "ausencia_justificada")).toBeNull();
    expect(isRevertibleAbsence("inasistencia_confirmada")).toBe(true);
    expect(isRevertibleAbsence("ausencia_justificada")).toBe(true);
    expect(isRevertibleAbsence("asignado")).toBe(false);
    expect(isRevertibleAbsence("cancelado")).toBe(false);
    expect(isRevertibleAbsence(null)).toBe(false);
    expect(absenceRequestHint("inasistencia_confirmada")).toBe(
      "Esta guardia está registrada como «Inasistencia confirmada». Si sí asististe, solicita el registro con tus horas reales de entrada y salida. " +
        "Si coordinación lo aprueba, la guardia deja de contar como «Inasistencia confirmada».",
    );
    expect(absenceRequestHint("ausencia_justificada")).toContain("«Ausencia justificada»");
    expect(absenceRequestHint("asignado")).toBeNull();
    expect(absenceRequestHint("cancelado")).toBeNull();
  });

  it("separación de funciones: nadie salvo administración revisa lo propio", () => {
    const coord = { id: "u-coord", workerId: "w-coord", isAdmin: false };
    const admin = { id: "u-admin", workerId: "w-admin", isAdmin: true };
    // Solicitud que hizo la misma cuenta (por ejemplo, en nombre de otra persona).
    expect(ownReviewBlock({ requested_by: "u-coord", worker_id: "w-otra" }, coord)).toBe("own_request");
    // Solicitud sobre su propia asistencia.
    expect(ownReviewBlock({ requested_by: "u-otra", worker_id: "w-coord" }, coord)).toBe("own_attendance");
    // Ambas: mismo orden que la base de datos.
    expect(ownReviewBlock({ requested_by: "u-coord", worker_id: "w-coord" }, coord)).toBe("own_request");
    expect(ownReviewBlock({ requested_by: "u-otra", worker_id: "w-otra" }, coord)).toBeNull();
    // Sin trabajador vinculado no hay asistencia propia.
    expect(ownReviewBlock({ requested_by: "u-otra", worker_id: "w-otra" }, { ...coord, workerId: null })).toBeNull();
    // Administración sí puede.
    expect(ownReviewBlock({ requested_by: "u-admin", worker_id: "w-admin" }, admin)).toBeNull();
    expect(OWN_REVIEW_MESSAGE).toBe("Otra persona de coordinación o administración debe revisar esta solicitud");
    expect(OWN_REVIEW_DB_MESSAGES.own_request).toBe("No puedes revisar una solicitud que tú hiciste");
    expect(OWN_REVIEW_DB_MESSAGES.own_attendance).toMatch(/^No puedes corregir, anular ni revisar tu propia asistencia/);
  });
});

describe("pestañas, resultado y quién", () => {
  it("interpreta pestaña y resultado", () => {
    expect(parseCorrectionTab("revisadas")).toBe("revisadas");
    expect(parseCorrectionTab(["revisadas"])).toBe("revisadas");
    expect(parseCorrectionTab("otra")).toBe("pendientes");
    expect(parseReviewResult("aprobada")).toBe("aprobada");
    expect(parseReviewResult("x")).toBeNull();
  });

  it("describe a quien registró sin inventar nombres", () => {
    const ctx = { currentUserId: "u-me", names: { "u-coord": "Coordinación (demo)", "u-worker": "Ana" }, workerProfileId: "u-worker" };
    expect(actorLabel("u-me", ctx)).toBe("Tú");
    expect(actorLabel("u-worker", ctx)).toBe("Ana (la propia persona)");
    expect(actorLabel("u-coord", ctx)).toBe("Coordinación (demo)");
    expect(actorLabel("u-unknown", ctx, "propio")).toBe("La propia persona");
    expect(actorLabel("u-unknown", ctx, "coordinador")).toBe("Coordinación o administración");
    expect(actorLabel(null, ctx)).toBe("—");
  });
});
