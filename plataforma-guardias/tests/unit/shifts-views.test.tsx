import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { summarizeAttendance } from "@/lib/attendance/calc";
import type { AssignmentWithAttendance, SessionRow, ShiftRow, ShiftWithAttendance } from "@/lib/attendance/load";
import type { ActionResult } from "@/lib/actions";
import { ShiftCalendar } from "@/components/shifts/shift-calendar";
import { ShiftList } from "@/components/shifts/shift-list";
import { AssignmentCard, type AssignmentActions } from "@/components/shifts/assignment-card";

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
    coverage: { assigned: 1, inService: 0, minStaff: 2, maxStaff: 4, insufficient: true },
    ...overrides,
  };
}

const noop = async (): Promise<ActionResult> => ({ ok: true });
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
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Acciones de coordinación")).not.toBeInTheDocument();
    expect(screen.getByText(/Entrada registrada no equivale a presencia física verificada\./)).toBeInTheDocument();
  });
});
