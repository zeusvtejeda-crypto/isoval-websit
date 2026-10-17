import { describe, expect, it } from "vitest";
import { describeCorrection, parseCorrectionTab, parseReview, parseReviewResult } from "@/lib/reports/corrections";
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
