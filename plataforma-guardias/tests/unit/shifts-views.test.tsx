import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { summarizeAttendance } from "@/lib/attendance/calc";
import type { AssignmentWithAttendance, SessionRow, ShiftRow, ShiftWithAttendance } from "@/lib/attendance/load";
import type { ActionResult } from "@/lib/actions";
import { ShiftCalendar } from "@/components/shifts/shift-calendar";
import { ShiftList } from "@/components/shifts/shift-list";
import { AssignmentCard, type AssignmentActions } from "@/components/shifts/assignment-card";
import { OWN_RECORD_NOTICE, STALE_OPEN_NOTICE } from "@/lib/shifts/rules";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => cleanup());

const TZ = "America/Mazatlan";
const FACILITY = "d0000000-0000-4000-8000-000000000001";
const SHIFT = "d2000000-0000-4000-8000-000000000009";

const shiftRow: ShiftRow = {
  id: SHIFT,
  facility_id: FACILITY,
  title: "[DEMO] Guardia nocturna",
  meeting_point: "Acceso principal",
  // 22:00 del sábado 17 al 06:00 del domingo 18 (Mazatlán).
  starts_at: "2026-10-18T05:00:00Z",
  ends_at: "2026-10-18T13:00:00Z",
  responsible_worker_id: "w-resp",
  min_staff: 2,
  max_staff: 4,
  instructions: "Llevar gafete.",
  status: "programada",
  cancel_reason: null,
  is_demo: true,
  change_reason: null,
  created_by: null,
  updated_by: null,
  created_at: "2026-10-10T00:00:00Z",
  updated_at: "2026-10-10T00:00:00Z",
  effective_status: null,
};

function session(partial: Partial<SessionRow> & Pick<SessionRow, "id" | "check_in_at">): SessionRow {
  return {
    assignment_id: "a1",
    shift_id: SHIFT,
    worker_id: "w1",
    facility_id: FACILITY,
    check_out_at: null,
    check_in_method: "propio",
    check_out_method: null,
    check_in_by: "p-worker",
    check_out_by: null,
    check_in_reason: null,
    check_out_reason: null,
    check_in_request_id: `${partial.id}-req`,
    qr_check_in_token_id: null,
    qr_check_out_token_id: null,
    check_out_request_id: null,
    notes: null,
    record_status: "vigente",
    supersedes_id: null,
    status_reason: null,
    status_changed_by: null,
    status_changed_at: null,
    created_at: partial.check_in_at,
    ...partial,
  };
}

const sessions: SessionRow[] = [
  session({
    id: "s-original",
    check_in_at: "2026-10-18T05:20:00Z",
    check_out_at: "2026-10-18T13:30:00Z",
    check_out_method: "propio",
    check_out_by: "p-worker",
    record_status: "corregido",
    status_reason: "Hora de entrada mal capturada",
    status_changed_by: "p-coord",
    status_changed_at: "2026-10-18T14:00:00Z",
  }),
  session({
    id: "s-fixed",
    check_in_at: "2026-10-18T05:15:00Z",
    check_out_at: "2026-10-18T13:30:00Z",
    check_in_method: "correccion",
    check_out_method: "correccion",
    check_in_by: "p-coord",
    check_out_by: "p-coord",
    check_in_reason: "Hora de entrada mal capturada",
    supersedes_id: "s-original",
  }),
  session({
    id: "s-void",
    check_in_at: "2026-10-18T14:00:00Z",
    check_out_at: "2026-10-18T14:30:00Z",
    check_out_method: "propio",
    check_out_by: "p-worker",
    record_status: "anulado",
    status_reason: "Registro duplicado",
    status_changed_by: "p-coord",
    status_changed_at: "2026-10-18T15:00:00Z",
  }),
];

const now = new Date("2026-10-18T16:00:00Z");

function buildAssignment(): AssignmentWithAttendance {
  const summary = summarizeAttendance(
    { startsAt: shiftRow.starts_at, endsAt: shiftRow.ends_at, status: shiftRow.status },
    { status: "asignado", substituteForWorkerId: null },
    sessions.map((s) => ({
      id: s.id,
      checkInAt: s.check_in_at,
      checkOutAt: s.check_out_at,
      recordStatus: s.record_status,
      checkInMethod: s.check_in_method,
      checkOutMethod: s.check_out_method,
      supersedesId: s.supersedes_id,
    })),
    { toleranceMinutes: 10, now },
  );
  return {
    assignment: {
      id: "a1",
      shift_id: SHIFT,
      worker_id: "w1",
      assigned_point: null,
      substitute_for_worker_id: null,
      status: "asignado",
      status_reason: null,
      status_changed_by: null,
      status_changed_at: null,
      notes: null,
      change_reason: null,
      created_by: null,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    },
    worker: { id: "w1", full_name: "[DEMO] Ana López", internal_code: "TRA-000001", area: "Enfermería", position: null, facility_id: FACILITY },
    substituteFor: null,
    sessions,
    summary,
  };
}

function buildShift(overrides: Partial<ShiftWithAttendance> = {}): ShiftWithAttendance {
  return {
    shift: shiftRow,
    effectiveStatus: "finalizada",
    facility: { id: FACILITY, official_name: "[DEMO] Hospital A", timezone: TZ, arrival_tolerance_minutes: 10, state_id: 18, municipality_id: null },
    responsible: { id: "w-resp", full_name: "[DEMO] Responsable" },
    assignments: [buildAssignment()],
    coverage: { assigned: 1, inService: 0, attended: 0, minStaff: 2, maxStaff: 4, insufficient: true },
    ...overrides,
  };
}

function buildCustom(opts: {
  sessions?: SessionRow[];
  now?: Date;
  assignmentStatus?: AssignmentWithAttendance["assignment"]["status"];
  shiftStatus?: ShiftRow["status"];
  substitute?: { id: string; full_name: string } | null;
  substituteId?: string | null;
}): AssignmentWithAttendance {
  const base = buildAssignment();
  const list = opts.sessions ?? [];
  const assignmentStatus = opts.assignmentStatus ?? "asignado";
  const summary = summarizeAttendance(
    { startsAt: shiftRow.starts_at, endsAt: shiftRow.ends_at, status: opts.shiftStatus ?? shiftRow.status },
    { status: assignmentStatus, substituteForWorkerId: opts.substituteId ?? null },
    list.map((s) => ({
      id: s.id,
      checkInAt: s.check_in_at,
      checkOutAt: s.check_out_at,
      recordStatus: s.record_status,
      checkInMethod: s.check_in_method,
      checkOutMethod: s.check_out_method,
      supersedesId: s.supersedes_id,
    })),
    { toleranceMinutes: 10, openSessionGraceMinutes: 240, now: opts.now ?? now },
  );
  return {
    ...base,
    assignment: { ...base.assignment, status: assignmentStatus, substitute_for_worker_id: opts.substituteId ?? null },
    substituteFor: opts.substitute ?? null,
    sessions: list,
    summary,
  };
}

function cardProps(item: AssignmentWithAttendance, opts: { now?: Date; shiftStatus?: ShiftRow["status"] } = {}) {
  return {
    item,
    tz: TZ,
    zoneLabel: "Tiempo del Pacífico (Mazatlán), GMT-7",
    shift: { starts_at: shiftRow.starts_at, ends_at: shiftRow.ends_at, status: opts.shiftStatus ?? shiftRow.status },
    canManage: true,
    actions,
    names: {},
    currentUserId: "p-coord",
    workerProfileId: "p-worker",
    notes: [],
    corrections: [],
    requestId: "11111111-1111-4111-8111-111111111111",
    now: opts.now ?? now,
    checkInOpensAt: new Date("2026-10-18T03:00:00Z"),
    viewer: coordinator,
    openSessionGraceMinutes: 240,
  };
}

const noop = async (): Promise<ActionResult> => ({ ok: true });
/** Coordinación sin trabajador vinculado (no es su propia asistencia). */
const coordinator = { isAdmin: false, workerId: null };
const actions: AssignmentActions = { changeStatus: noop, remove: noop, correct: noop, voidSession: noop, manual: noop, incidentNote: noop };

describe("vistas de guardias", () => {
  it("calendario: la guardia nocturna aparece en su día de inicio con «+1 día»", () => {
    render(
      <ShiftCalendar
        items={[buildShift()]}
        days={["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]}
        today="2026-10-17"
        fallbackTz={TZ}
        showFacility
        newShiftHref={(day) => `/guardias/nueva?fecha=${day}`}
      />,
    );
    const saturday = screen.getByRole("heading", { name: /sáb 17 oct/ }).closest("li") as HTMLElement;
    expect(within(saturday).getByText("22:00 – 06:00 (+1 día)")).toBeInTheDocument();
    expect(within(saturday).getByText("Hoy")).toBeInTheDocument();
    expect(within(saturday).getByText("Cobertura insuficiente")).toBeInTheDocument();
    expect(within(saturday).getByText("Responsable: [DEMO] Responsable")).toBeInTheDocument();
    expect(within(saturday).getByText(/Asignados 1\/2 \(máx\. 4\) · En servicio 0/)).toBeInTheDocument();
    const sunday = screen.getByRole("heading", { name: /dom 18 oct/ }).closest("li") as HTMLElement;
    expect(within(sunday).getByText("Sin guardias")).toBeInTheDocument();
    expect(screen.getAllByText("+ Programar")).toHaveLength(7);
  });

  it("lista: muestra sede, horario, responsable, cobertura y estado con texto", () => {
    render(<ShiftList items={[buildShift()]} days={["2026-10-17", "2026-10-18"]} fallbackTz={TZ} />);
    expect(screen.getAllByText("[DEMO] Guardia nocturna").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/22:00 – 06:00 \(\+1 día\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("[DEMO] Responsable").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 asignado \(mín\. 2, máx\. 4\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finalizada").length).toBeGreaterThan(0);
  });

  it("asignación: todas las versiones de registros, métricas, incidencias y avisos obligatorios", () => {
    render(
      <AssignmentCard
        item={buildAssignment()}
        tz={TZ}
        zoneLabel="Tiempo del Pacífico (Mazatlán), GMT-7"
        shift={{ starts_at: shiftRow.starts_at, ends_at: shiftRow.ends_at, status: shiftRow.status }}
        canManage
        actions={actions}
        names={{ "p-coord": "Coordinación (demo)" }}
        currentUserId="p-admin"
        workerProfileId="p-worker"
        notes={[]}
        corrections={[]}
        requestId="11111111-1111-4111-8111-111111111111"
        now={now}
        checkInOpensAt={new Date("2026-10-18T03:00:00Z")}
        viewer={coordinator}
        openSessionGraceMinutes={240}
      />,
    );
    expect(screen.getByText(/Entrada registrada no equivale a presencia física verificada\./)).toBeInTheDocument();
    expect(screen.getByText("Permanencia adicional = tiempo registrado adicional, no horas extra pagadas.")).toBeInTheDocument();
    expect(screen.getByText("Corregido (versión original conservada)")).toBeInTheDocument();
    expect(screen.getByText("Anulado")).toBeInTheDocument();
    expect(screen.getAllByText("Vigente")).toHaveLength(1);
    expect(screen.getAllByText(/Registró: Coordinación \(demo\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Registró: La propia persona").length).toBeGreaterThan(0);
    expect(screen.getByText("Llegada tardía")).toBeInTheDocument();
    expect(screen.getAllByText("Corrección administrativa").length).toBeGreaterThanOrEqual(2); // método e incidencia
    expect(screen.getByText("Permanencia adicional (tiempo registrado adicional)")).toBeInTheDocument();
    // Programado 8 h; registrado 05:15–13:30 = 8 h 15 min.
    expect(screen.getByText("8 h 15 min")).toBeInTheDocument();
    expect(screen.getByText("+15 min")).toBeInTheDocument();
    // La guardia terminó: no se ofrece registrar entrada; sí el registro manual y no «quitar» (tiene registros).
    expect(screen.getByText(/La guardia ya terminó/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar registro manual" })).toBeInTheDocument();
    expect(screen.queryByText("Quitar asignación")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("11111111-1111-4111-8111-111111111111")).toBeInTheDocument();
  });

  it("asignación con solicitudes pendientes: enlace a revisión solo para gestión", () => {
    const pending = {
      id: "c1",
      assignment_id: "a1",
      session_id: "s-fixed",
      worker_id: "w1",
      facility_id: FACILITY,
      requested_by: "p-worker",
      requested_check_in_at: "2026-10-18T05:05:00Z",
      requested_check_out_at: null,
      reason: "Llegué antes",
      status: "pendiente" as const,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      resulting_session_id: null,
      created_at: "2026-10-18T15:00:00Z",
    };
    const props = {
      item: buildAssignment(),
      tz: TZ,
      zoneLabel: "Tiempo del Pacífico (Mazatlán), GMT-7",
      shift: { starts_at: shiftRow.starts_at, ends_at: shiftRow.ends_at, status: shiftRow.status },
      actions,
      names: {},
      currentUserId: "p-admin",
      workerProfileId: null,
      notes: [],
      corrections: [pending],
      requestId: "11111111-1111-4111-8111-111111111111",
      now,
      checkInOpensAt: new Date("2026-10-18T03:00:00Z"),
      correctionsHref: `/correcciones?sede=${FACILITY}`,
      viewer: coordinator,
      openSessionGraceMinutes: 240,
    };
    const { unmount } = render(<AssignmentCard {...props} canManage />);
    // 05:05 UTC = 22:05 del sábado 17 en Mazatlán.
    expect(screen.getByText(/Entrada solicitada: 17\/10\/2026 22:05/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revisar solicitudes en Correcciones" })).toHaveAttribute("href", `/correcciones?sede=${FACILITY}`);
    unmount();
    render(<AssignmentCard {...props} canManage={false} />);
    expect(screen.getByText(/Entrada solicitada/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Revisar solicitudes en Correcciones" })).not.toBeInTheDocument();
  });

  it("asignación en solo lectura (auditoría): sin formularios de acción", () => {
    render(
      <AssignmentCard
        item={buildAssignment()}
        tz={TZ}
        zoneLabel="Tiempo del Pacífico (Mazatlán), GMT-7"
        shift={{ starts_at: shiftRow.starts_at, ends_at: shiftRow.ends_at, status: shiftRow.status }}
        canManage={false}
        actions={actions}
        names={{}}
        currentUserId="p-auditor"
        workerProfileId={null}
        notes={[]}
        corrections={[]}
        requestId="11111111-1111-4111-8111-111111111111"
        now={now}
        checkInOpensAt={new Date("2026-10-18T03:00:00Z")}
        viewer={coordinator}
        openSessionGraceMinutes={240}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Acciones de coordinación")).not.toBeInTheDocument();
    expect(screen.getByText(/Entrada registrada no equivale a presencia física verificada\./)).toBeInTheDocument();
  });
  it("asignación: muestra el tiempo entre salida y regreso (no cuenta) junto a las métricas", () => {
    const gapSessions = [
      session({ id: "g1", check_in_at: "2026-10-18T05:00:00Z", check_out_at: "2026-10-18T07:00:00Z", check_out_method: "propio", check_out_by: "p-worker" }),
      session({ id: "g2", check_in_at: "2026-10-18T07:30:00Z", check_out_at: "2026-10-18T13:00:00Z", check_out_method: "propio", check_out_by: "p-worker" }),
    ];
    render(<AssignmentCard {...cardProps(buildCustom({ sessions: gapSessions }))} />);
    const metrics = screen.getByRole("region", { name: /Métricas de/ });
    expect(within(metrics).getByText(/Tiempo entre salida y regreso \(no cuenta\):/)).toHaveTextContent(
      "Tiempo entre salida y regreso (no cuenta): 30 min",
    );
    // Total sin contar el hueco: 2 h + 5 h 30 min.
    const total = within(metrics).getByText("Total registrado").closest("div") as HTMLElement;
    expect(total).toHaveTextContent("Total registrado7 h 30 min");
  });

  it("sustitución: se ve «Cubre a <nombre>»", () => {
    const { unmount } = render(
      <AssignmentCard {...cardProps(buildCustom({ substitute: { id: "w9", full_name: "[DEMO] Pedro Ruiz" }, substituteId: "w9" }))} />,
    );
    expect(screen.getByText("Cubre a [DEMO] Pedro Ruiz")).toBeInTheDocument();
    expect(screen.queryByText(/Sustituye a/)).not.toBeInTheDocument();
    unmount();
    render(<AssignmentCard {...cardProps(buildCustom({ substitute: null, substituteId: "w9" }))} />);
    expect(screen.getByText("Cubre a una persona no visible para tu cuenta")).toBeInTheDocument();
    cleanup();
    render(<AssignmentCard {...cardProps(buildCustom({}))} />);
    expect(screen.queryByText(/Cubre a/)).not.toBeInTheDocument();
  });

  it("entrada sin salida fuera del margen: no ofrece «Registrar salida» y destaca «Corregir registro»", () => {
    const open = [session({ id: "s-open", check_in_at: "2026-10-18T05:10:00Z" })];
    // Término 13:00 UTC + margen de 4 h = 17:00; ahora 18:00.
    const late = new Date("2026-10-18T18:00:00Z");
    const item = buildCustom({ sessions: open, now: late });
    expect(item.summary.status).toBe("registro_incompleto");
    render(<AssignmentCard {...cardProps(item, { now: late })} />);

    expect(screen.queryByText("Registrar salida por otra persona")).not.toBeInTheDocument();
    expect(screen.getByText(STALE_OPEN_NOTICE)).toBeInTheDocument();
    expect(screen.getByText(/requiere revisión/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a «Corregir registro»" })).toHaveAttribute("href", "#corregir-s-open");
    const details = document.getElementById("corregir-s-open") as HTMLElement;
    expect(details.tagName).toBe("DETAILS");
    expect(within(details).getByText("Falta la hora real de salida")).toBeInTheDocument();
    // La salida es obligatoria y no se precarga con la hora actual.
    const out = within(details).getByLabelText(/Salida correcta/);
    expect(out).toBeRequired();
    expect(out).toHaveValue("");
    expect(within(details).getByText("Indica la hora real en que terminó (no la hora actual).")).toBeInTheDocument();
  });

  it("entrada abierta dentro del margen: sí ofrece registrar la salida por otra persona", () => {
    const open = [session({ id: "s-open", check_in_at: "2026-10-18T05:10:00Z" })];
    const inGrace = new Date("2026-10-18T14:00:00Z");
    render(<AssignmentCard {...cardProps(buildCustom({ sessions: open, now: inGrace }), { now: inGrace })} />);
    expect(screen.getByText("Registrar salida por otra persona")).toBeInTheDocument();
    expect(screen.queryByText(STALE_OPEN_NOTICE)).not.toBeInTheDocument();
  });

  it("guardia cancelada con entrada abierta vencida: tampoco ofrece la salida ni el registro manual", () => {
    const open = [session({ id: "s-open", check_in_at: "2026-10-18T05:10:00Z" })];
    const late = new Date("2026-10-18T18:00:00Z");
    const item = buildCustom({ sessions: open, now: late, shiftStatus: "cancelada" });
    expect(item.summary.status).toBe("cancelada");
    render(<AssignmentCard {...cardProps(item, { now: late, shiftStatus: "cancelada" })} />);
    expect(screen.queryByText("Registrar salida por otra persona")).not.toBeInTheDocument();
    expect(screen.getByText(STALE_OPEN_NOTICE)).toBeInTheDocument();
    expect(screen.queryByText("Agregar registro manual")).not.toBeInTheDocument();
    expect(screen.getByText("La guardia está cancelada: no se agregan registros manuales.")).toBeInTheDocument();
  });

  it("asignación no activa: no ofrece el registro manual y explica por qué", () => {
    render(<AssignmentCard {...cardProps(buildCustom({ assignmentStatus: "cancelado" }))} />);
    expect(screen.queryByText("Agregar registro manual")).not.toBeInTheDocument();
    expect(screen.getByText("La asignación no está activa: para agregar registros, vuelve a ponerla como «Asignado».")).toBeInTheDocument();
  });

  it("propia asistencia: coordinación no ve corregir, anular, registro manual, cambiar estado ni justificar", () => {
    const pending = {
      id: "c1",
      assignment_id: "a1",
      session_id: "s-fixed",
      worker_id: "w1",
      facility_id: FACILITY,
      requested_by: "p-worker",
      requested_check_in_at: "2026-10-18T05:05:00Z",
      requested_check_out_at: null,
      reason: "Llegué antes",
      status: "pendiente" as const,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      resulting_session_id: null,
      created_at: "2026-10-18T15:00:00Z",
    };
    const base = { ...cardProps(buildAssignment()), corrections: [pending], correctionsHref: `/correcciones?sede=${FACILITY}` };
    const { unmount } = render(<AssignmentCard {...base} viewer={{ isAdmin: false, workerId: "w1" }} />);
    expect(screen.getByText(OWN_RECORD_NOTICE)).toBeInTheDocument();
    expect(screen.getByText("No puedes corregir tu propia asistencia; pide a otra persona de coordinación o a administración.")).toBeInTheDocument();
    for (const label of ["Corregir registro", "Anular registro", "Agregar registro manual", "Cambiar estado de la asignación", "Justificar"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: "Revisar solicitudes en Correcciones" })).not.toBeInTheDocument();
    // Los registros y las incidencias se siguen viendo.
    expect(screen.getByText("Llegada tardía")).toBeInTheDocument();
    unmount();

    // Administración sí puede, aunque sea su propia asignación.
    render(<AssignmentCard {...base} viewer={{ isAdmin: true, workerId: "w1" }} />);
    expect(screen.queryByText(OWN_RECORD_NOTICE)).not.toBeInTheDocument();
    expect(screen.getByText("Corregir registro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar registro manual" })).toBeInTheDocument();
    expect(screen.getByText("Cambiar estado de la asignación")).toBeInTheDocument();
    expect(screen.getAllByText("Justificar").length).toBeGreaterThan(0);
  });

  it("propia asistencia con entrada abierta: remite a «Mi guardia» en lugar de registrar por otra persona", () => {
    const open = [session({ id: "s-open", check_in_at: "2026-10-18T05:10:00Z" })];
    const during = new Date("2026-10-18T08:00:00Z");
    render(<AssignmentCard {...cardProps(buildCustom({ sessions: open, now: during }), { now: during })} viewer={{ isAdmin: false, workerId: "w1" }} />);
    expect(screen.queryByText("Registrar salida por otra persona")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mi guardia" })).toHaveAttribute("href", "/mi-guardia");
  });

  it("registro manual y corrección: límites de captura de la guardia ±12 h y nunca en el futuro", () => {
    render(<AssignmentCard {...cardProps(buildAssignment())} />);
    // Guardia 22:00 (17/10) – 06:00 (18/10) en Mazatlán; ahora 09:00 del 18/10.
    const manualIn = document.querySelector('input[name="check_in"][id^="m-in-"]') as HTMLInputElement;
    expect(manualIn).toHaveAttribute("min", "2026-10-17T10:00");
    expect(manualIn).toHaveAttribute("max", "2026-10-18T09:00");
    const correctIn = document.querySelector('input[name="check_in"][id^="c-in-"]') as HTMLInputElement;
    expect(correctIn).toHaveAttribute("min", "2026-10-17T10:00");
    expect(screen.getAllByText(/Las horas deben estar entre 17\/10\/2026 10:00 y 18\/10\/2026 18:00/).length).toBeGreaterThan(0);
  });
});
