import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuditEventCard } from "@/app/(app)/administracion/bitacora/_components/audit-event-card";
import {
  auditFieldChanges,
  auditSubject,
  collectRefIds,
  isRedacted,
  redactedFieldLabels,
  redactionNotice,
  type ValueContext,
} from "@/lib/admin/audit-diff";
import type { AuditEventRow } from "@/lib/admin/audit-server";

const TZ = "America/Mazatlan"; // UTC−7
const ADMIN = "11111111-1111-4111-8111-111111111111";
const WORKER = "7e509c97-e475-4621-a333-44087356ebb2";
const ROLE_LABELS = { admin: "Administración", coordinador: "Coordinación", trabajador: "Trabajador", auditor: "Auditoría" };
const ctx: ValueContext = { timeZone: TZ, roleLabels: ROLE_LABELS, refs: { worker: { [WORKER]: "Ana Pérez" } } };

function event(overrides: Partial<AuditEventRow>): AuditEventRow {
  return {
    id: 501,
    occurred_at: "2024-03-01T18:00:00Z",
    actor_id: ADMIN,
    actor_role: "admin",
    table_name: "worker_private",
    record_id: WORKER,
    action: "UPDATE",
    old_data: null,
    new_data: { redactado: "conservacion" },
    changed_fields: ["employee_number", "phone"],
    reason: "Actualización de contacto",
    facility_id: null,
    redacted_at: "2026-10-17T17:30:00Z",
    ...overrides,
  };
}

function renderCard(e: AuditEventRow) {
  return render(
    <ol>
      <AuditEventCard
        event={e}
        ctx={ctx}
        currentUserId="otra-cuenta"
        profileNames={{ [ADMIN]: "Admin Uno" }}
        facilityNames={{}}
        facilityTimezones={{}}
        roleLabels={ROLE_LABELS}
      />
    </ol>,
  );
}

describe("eventos de bitácora redactados por la política de conservación", () => {
  it("no muestran valores y explican qué se conserva", () => {
    const redacted = event({});
    expect(isRedacted(redacted)).toBe(true);
    expect(auditFieldChanges(redacted, ctx)).toEqual([]);
    expect(auditSubject(redacted, ctx)).toBeNull();
    expect(collectRefIds([redacted], "worker")).toEqual([]);
    expect(redactionNotice(redacted, TZ)).toBe("Contenido eliminado por la política de conservación (17/10/2026 10:30).");
    expect(redactedFieldLabels(redacted)).toEqual(["Teléfono", "Número de trabajador"]);
  });

  it("distingue la eliminación de datos de demostración", () => {
    const demo = event({ action: "INSERT", changed_fields: null, new_data: { redactado: "demostracion" } });
    expect(redactionNotice(demo, TZ)).toBe("Contenido eliminado al borrar los datos de demostración (17/10/2026 10:30).");
    expect(redactedFieldLabels(demo)).toEqual([]);
  });

  it("los eventos sin redactar no cambian", () => {
    const normal = event({
      redacted_at: null,
      old_data: { worker_id: WORKER, phone: "311 555 0101" },
      new_data: { worker_id: WORKER, phone: "311 555 0202" },
      changed_fields: ["phone"],
    });
    expect(isRedacted(normal)).toBe(false);
    expect(redactionNotice(normal, TZ)).toBeNull();
    expect(redactedFieldLabels(normal)).toEqual([]);
    expect(auditFieldChanges(normal, ctx)).toEqual([{ field: "phone", label: "Teléfono", before: "311 555 0101", after: "311 555 0202" }]);
  });

  it("la tarjeta muestra el aviso, el autor y los campos, sin valores ni motivo", () => {
    renderCard(event({ reason: null }));
    expect(screen.getByText("Contenido eliminado")).toBeInTheDocument();
    expect(screen.getByText("Contenido eliminado por la política de conservación (17/10/2026 10:30).")).toBeInTheDocument();
    expect(screen.getByText(/Se conservan el autor, la fecha, la acción y los campos que cambiaron\./)).toBeInTheDocument();
    expect(screen.getByText("Eliminado junto con el contenido")).toBeInTheDocument();
    expect(screen.getByText("Campos que cambiaron: Teléfono, Número de trabajador.")).toBeInTheDocument();
    expect(screen.getByText("Datos privados de trabajadores")).toBeInTheDocument();
    expect(screen.getByText("Modificación")).toBeInTheDocument();
    expect(screen.getByText(/Admin Uno/)).toBeInTheDocument();
    // Sin valores ni resumen de campos.
    expect(screen.queryByText(/311 555/)).not.toBeInTheDocument();
    expect(screen.queryByText(/campos? modificados?/)).not.toBeInTheDocument();
    expect(screen.queryByText("(vacío)")).not.toBeInTheDocument();
    // Los identificadores siguen disponibles.
    expect(screen.getByText("Ver identificadores del evento")).toBeInTheDocument();
    expect(screen.getByText(`Identificador del registro: ${WORKER}`)).toBeInTheDocument();
    expect(screen.getByText("Evento n.º 501")).toBeInTheDocument();
  });

  it("en un alta redactada no menciona campos cambiados", () => {
    renderCard(event({ action: "INSERT", changed_fields: null, table_name: "attendance_sessions", reason: null }));
    expect(screen.getByText(/Se conservan el autor, la fecha y la acción\./)).toBeInTheDocument();
    expect(screen.queryByText(/Campos que cambiaron/)).not.toBeInTheDocument();
  });

  it("un evento normal sigue mostrando el detalle de cambios", () => {
    renderCard(
      event({
        redacted_at: null,
        old_data: { worker_id: WORKER, phone: "311 555 0101" },
        new_data: { worker_id: WORKER, phone: "311 555 0202" },
        changed_fields: ["phone"],
      }),
    );
    expect(screen.queryByText("Contenido eliminado")).not.toBeInTheDocument();
    expect(screen.getByText("Ver 1 campo modificado")).toBeInTheDocument();
    expect(screen.getByText("311 555 0202")).toBeInTheDocument();
  });
});
