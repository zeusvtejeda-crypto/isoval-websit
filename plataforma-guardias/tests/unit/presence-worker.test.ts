import { describe, expect, it } from "vitest";
import {
  buildMyShifts,
  checkInBlockText,
  checkOutBlockText,
  openElsewhere,
  pickFeatured,
  recentViews,
  registrableViews,
  upcomingViews,
  type MyAssignmentRow,
  type OwnSession,
} from "@/lib/presence/worker";
import { correctionFromFormData, parseCorrection, resolveCorrection } from "@/lib/presence/correction";

const MZT = "America/Mazatlan";
const RULES = { windowBeforeMinutes: 120, graceMinutes: 240 };
const NOW = new Date("2026-10-17T16:00:00Z"); // 09:00 en Mazatlán

function row(id: string, start: string, end: string, extra: Partial<MyAssignmentRow> = {}): MyAssignmentRow {
  return {
    assignment_id: id,
    assignment_status: "asignado",
    assigned_point: null,
    substitute_for_name: null,
    shift_id: `s-${id}`,
    shift_title: null,
    meeting_point: `Punto ${id}`,
    starts_at: start,
    ends_at: end,
    shift_status: "programada",
    instructions: null,
    facility_id: "F1",
    facility_name: "[DEMO] Hospital A",
    facility_timezone: MZT,
    arrival_tolerance_minutes: 10,
    responsible_name: "Responsable",
    ...extra,
  };
}

function session(id: string, assignmentId: string, checkIn: string, checkOut: string | null = null, extra: Partial<OwnSession> = {}): OwnSession {
  return {
    id,
    assignment_id: assignmentId,
    check_in_at: checkIn,
    check_out_at: checkOut,
    record_status: "vigente",
    check_in_method: "propio",
    check_out_method: checkOut ? "propio" : null,
    supersedes_id: null,
    ...extra,
  };
}

const yesterday = row("ayer", "2026-10-16T15:00:00Z", "2026-10-16T21:00:00Z");
const today = row("hoy", "2026-10-17T13:00:00Z", "2026-10-17T21:00:00Z");
const soon = row("pronto", "2026-10-17T17:00:00Z", "2026-10-17T23:00:00Z"); // inicia en 60 min
const tomorrow = row("manana", "2026-10-18T13:00:00Z", "2026-10-18T21:00:00Z");

describe("buildMyShifts / pickFeatured", () => {
  it("con una entrada olvidada en otra guardia: destaca la de hoy y avisa de la otra", () => {
    const views = buildMyShifts([yesterday, today, tomorrow], [session("s1", "ayer", "2026-10-16T15:02:00Z")], NOW, RULES);
    const featured = pickFeatured(views);
    expect(featured?.row.assignment_id).toBe("hoy");
    expect(featured?.canCheckIn).toBe(false);
    expect(featured?.checkInBlock).toBe("open_elsewhere");
    expect(checkInBlockText(featured!)).toMatch(/entrada abierta en otra guardia/);

    const other = openElsewhere(views, "hoy");
    expect(other?.row.assignment_id).toBe("ayer");
    // Pasó el margen (240 min) tras el término: la salida requiere revisión.
    expect(other?.canCheckOut).toBe(false);
    expect(other?.checkOutBlock).toBe("needs_review");
    expect(checkOutBlockText(other!)).toMatch(/requiere revisión/);
    expect(other?.summary.status).toBe("registro_incompleto");

    expect(registrableViews(views).map((v) => v.row.assignment_id)).toEqual(["ayer"]);
    // El texto de la entrada no contradice que la salida requiere revisión.
    expect(other?.checkInBlock).toBe("already_open");
    expect(checkInBlockText(other!)).toMatch(/requiere revisión/);
    expect(checkInBlockText(other!)).not.toMatch(/Registra tu salida al terminar/);
  });

  it("sin entradas abiertas: se puede registrar la guardia en curso y la que abre su ventana", () => {
    const views = buildMyShifts([today, soon, tomorrow], [], NOW, RULES);
    expect(pickFeatured(views)?.row.assignment_id).toBe("hoy");
    expect(views.find((v) => v.row.assignment_id === "hoy")?.canCheckIn).toBe(true);
    expect(views.find((v) => v.row.assignment_id === "pronto")?.canCheckIn).toBe(true);
    const tm = views.find((v) => v.row.assignment_id === "manana")!;
    expect(tm.canCheckIn).toBe(false);
    expect(tm.checkInBlock).toBe("not_yet_open");
    // Abre 120 min antes de las 06:00 locales del 18 → 04:00.
    expect(checkInBlockText(tm)).toContain("04:00");
    expect(registrableViews(views).map((v) => v.row.assignment_id)).toEqual(["hoy", "pronto"]);
    expect(upcomingViews(views, "hoy").map((v) => v.row.assignment_id)).toEqual(["pronto", "manana"]);
  });

  it("con entrada abierta en la guardia en curso: habilita salida y bloquea otra entrada", () => {
    const views = buildMyShifts([today, soon], [session("s2", "hoy", "2026-10-17T13:04:00Z")], NOW, RULES);
    const featured = pickFeatured(views)!;
    expect(featured.row.assignment_id).toBe("hoy");
    expect(featured.canCheckOut).toBe(true);
    expect(featured.checkInBlock).toBe("already_open");
    expect(featured.summary.status).toBe("en_servicio");
    const next = views.find((v) => v.row.assignment_id === "pronto")!;
    expect(next.checkInBlock).toBe("open_elsewhere");
    expect(openElsewhere(views, "hoy")).toBeNull();
  });

  it("destaca una guardia terminada con entrada abierta (dentro del margen) para registrar la salida", () => {
    const ended = row("termino", "2026-10-17T07:00:00Z", "2026-10-17T15:00:00Z"); // terminó hace 60 min
    const views = buildMyShifts([ended, tomorrow], [session("s3", "termino", "2026-10-17T07:01:00Z")], NOW, RULES);
    const featured = pickFeatured(views)!;
    expect(featured.row.assignment_id).toBe("termino");
    expect(featured.canCheckOut).toBe(true);
    expect(featured.timing).toBe("terminada");
  });

  it("permite salida y regreso: tras una salida se puede registrar otra entrada", () => {
    const views = buildMyShifts([today], [session("s4", "hoy", "2026-10-17T13:00:00Z", "2026-10-17T14:00:00Z")], NOW, RULES);
    expect(views[0].canCheckIn).toBe(true);
    expect(views[0].canCheckOut).toBe(false);
    expect(views[0].checkOutBlock).toBe("no_open_session");
  });

  it("ignora sesiones corregidas o anuladas para decidir si hay entrada abierta", () => {
    const views = buildMyShifts(
      [today],
      [session("s5", "hoy", "2026-10-17T13:00:00Z", null, { record_status: "corregido" })],
      NOW,
      RULES,
    );
    expect(views[0].openSession).toBeNull();
    expect(views[0].canCheckIn).toBe(true);
  });

  it("bloquea la entrada en guardias canceladas, ausencias y guardias terminadas", () => {
    const views = buildMyShifts(
      [
        row("cancelada", "2026-10-17T13:00:00Z", "2026-10-17T21:00:00Z", { shift_status: "cancelada" }),
        row("ausencia", "2026-10-17T13:00:00Z", "2026-10-17T21:00:00Z", { assignment_status: "ausencia_justificada" }),
        row("vieja", "2026-10-17T05:00:00Z", "2026-10-17T12:00:00Z"),
      ],
      [],
      NOW,
      RULES,
    );
    const by = Object.fromEntries(views.map((v) => [v.row.assignment_id, v]));
    expect(by.cancelada.checkInBlock).toBe("cancelled");
    expect(by.ausencia.checkInBlock).toBe("inactive");
    expect(checkInBlockText(by.ausencia)).toContain("Ausencia justificada");
    expect(by.vieja.checkInBlock).toBe("ended");
    expect(pickFeatured(views)).toBeNull();
    expect(recentViews(views, null).map((v) => v.row.assignment_id)).toEqual(["vieja"]);
  });
});

describe("solicitud de corrección", () => {
  const assignmentId = "71ee77ad-676f-4fe3-b3e1-3f29c8f4df2c";
  const sessionId = "09f38663-9135-4e0f-b846-eaf6a865d47a";

  it("lee el FormData y valida el motivo (mínimo 5 caracteres)", () => {
    const fd = new FormData();
    fd.set("assignmentId", assignmentId);
    fd.set("sessionId", sessionId);
    fd.set("checkIn", "2026-10-17T06:00");
    fd.set("reason", "  ok ");
    const parsed = parseCorrection(correctionFromFormData(fd));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.fieldErrors.reason).toMatch(/mínimo 5/);
  });

  it("rechaza identificadores y fechas con formato inválido", () => {
    const parsed = parseCorrection({ assignmentId: "x", sessionId: "", checkIn: "17/10/2026 06:00", checkOut: "", reason: "Olvidé registrar" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.fieldErrors.assignmentId).toBeDefined();
      expect(parsed.fieldErrors.checkIn).toBe("Fecha y hora inválidas.");
    }
  });

  it("convierte las horas capturadas en la zona de la sede a UTC", () => {
    const parsed = parseCorrection({ assignmentId, sessionId, checkIn: "2026-10-17T06:05", checkOut: "", reason: "Llegué antes y no registré" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = resolveCorrection(parsed.input, MZT, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkInAt?.toISOString()).toBe("2026-10-17T13:05:00.000Z");
      expect(r.checkOutAt).toBeNull();
      expect(r.sessionId).toBe(sessionId);
    }
    // Misma hora local en Bahía de Banderas (UTC−6) = otra hora UTC.
    const bb = resolveCorrection(parsed.input, "America/Bahia_Banderas", NOW);
    expect(bb.ok && bb.checkInAt?.toISOString()).toBe("2026-10-17T12:05:00.000Z");
  });

  it("sin registro previo exige entrada y salida", () => {
    const parsed = parseCorrection({ assignmentId, sessionId: "", checkIn: "2026-10-17T06:00", checkOut: "", reason: "No pude registrar" });
    if (!parsed.ok) throw new Error("debe ser válido");
    const r = resolveCorrection(parsed.input, MZT, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.checkOut).toBe("Indica la hora de salida.");
  });

  it("rechaza salida anterior a la entrada, horas futuras y solicitudes vacías", () => {
    const base = { assignmentId, sessionId, reason: "Corrección necesaria" };
    const order = parseCorrection({ ...base, checkIn: "2026-10-17T08:00", checkOut: "2026-10-17T07:00" });
    if (!order.ok) throw new Error("debe ser válido");
    const r1 = resolveCorrection(order.input, MZT, NOW);
    expect(!r1.ok && r1.fieldErrors.checkOut).toBe("La salida debe ser posterior a la entrada.");

    const future = parseCorrection({ ...base, checkIn: "2026-10-17T10:00", checkOut: "" }); // 10:00 local > 09:00
    if (!future.ok) throw new Error("debe ser válido");
    const r2 = resolveCorrection(future.input, MZT, NOW);
    expect(!r2.ok && r2.fieldErrors.checkIn).toBe("No se pueden solicitar horas futuras.");

    const empty = parseCorrection({ ...base, checkIn: "", checkOut: "" });
    if (!empty.ok) throw new Error("debe ser válido");
    const r3 = resolveCorrection(empty.input, MZT, NOW);
    expect(!r3.ok && r3.message).toMatch(/al menos la hora/);
  });
});
