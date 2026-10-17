import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  ASSIGNMENT_STATUS_LABELS,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  METHOD_LABELS,
  type Tone,
} from "@/lib/attendance/labels";
import { DEFAULT_TIMEZONE, formatShiftRange, formatTime } from "@/lib/time";
import type { MyShiftView, OwnSession } from "@/lib/presence/worker";
import { checkInBlockText, checkOutBlockText } from "@/lib/presence/worker";
import type { AttendanceButtonsProps } from "./attendance-buttons";

/** Estado legible de una guardia propia (siempre con texto). */
export function myShiftStatus(view: MyShiftView): { label: string; tone: Tone } {
  const { row, summary, timing } = view;
  if (row.shift_status === "cancelada" || row.assignment_status === "cancelado") {
    return { label: row.shift_status === "cancelada" ? "Guardia cancelada" : ASSIGNMENT_STATUS_LABELS.cancelado, tone: "muted" };
  }
  if (row.assignment_status !== "asignado") {
    return { label: ASSIGNMENT_STATUS_LABELS[row.assignment_status], tone: ATTENDANCE_STATUS_TONE[summary.status] };
  }
  switch (summary.status) {
    case "en_servicio":
      return { label: "En servicio (entrada registrada)", tone: "success" };
    case "finalizada":
      return { label: "Salida registrada", tone: "info" };
    case "pendiente":
      if (timing === "proxima") return { label: "Programada", tone: "neutral" };
      if (timing === "en_curso") return { label: "En curso, sin entrada registrada", tone: "warning" };
      return { label: "Sin registros (pendiente de revisión)", tone: "warning" };
    default:
      return { label: ATTENDANCE_STATUS_LABELS[summary.status], tone: ATTENDANCE_STATUS_TONE[summary.status] };
  }
}

export function shiftLabel(view: MyShiftView): string {
  return `${view.row.facility_name} · ${view.row.meeting_point}`;
}

/** Props para AttendanceButtons a partir de la vista (los textos de bloqueo vienen de la lógica pura). */
export function buttonsPropsFor(view: MyShiftView | null): Omit<AttendanceButtonsProps, "showCheckIn" | "showCheckOut" | "className"> {
  if (!view) {
    return { assignmentId: null, timeZone: DEFAULT_TIMEZONE, canCheckIn: false, canCheckOut: false };
  }
  return {
    assignmentId: view.row.assignment_id,
    timeZone: view.row.facility_timezone,
    label: shiftLabel(view),
    canCheckIn: view.canCheckIn,
    canCheckOut: view.canCheckOut,
    checkInDisabledReason: checkInBlockText(view),
    checkOutDisabledReason: checkOutBlockText(view),
  };
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="text-sm font-medium text-gray-600">{term}</dt>
      <dd className="text-base text-gray-900">{children}</dd>
    </div>
  );
}

export function sessionLine(s: Pick<OwnSession, "check_in_at" | "check_out_at">, tz: string): string {
  const inText = `Entrada ${formatTime(s.check_in_at, tz)}`;
  return s.check_out_at ? `${inText} · Salida ${formatTime(s.check_out_at, tz)}` : `${inText} · sin salida`;
}

/** Datos de la guardia del trabajador (sede, puntos, horario en zona de la sede, responsable, instrucciones). */
export function MyShiftDetails({ view }: { view: MyShiftView }) {
  const { row } = view;
  const tz = row.facility_timezone;
  const status = myShiftStatus(view);
  const vigentes = view.sessions.filter((s) => s.record_status === "vigente");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        {row.substitute_for_name ? <Badge tone="info">Sustitución</Badge> : null}
      </div>
      <dl className="mt-2 divide-y divide-gray-100">
        <Row term="Sede">{row.facility_name}</Row>
        {row.shift_title ? <Row term="Guardia">{row.shift_title}</Row> : null}
        <Row term="Punto de reunión">{row.meeting_point}</Row>
        <Row term="Punto asignado">{row.assigned_point || "Sin punto específico"}</Row>
        <Row term="Horario">
          {formatShiftRange(row.starts_at, row.ends_at, tz)}
          <span className="block text-sm text-gray-500">Hora de la sede ({tz})</span>
        </Row>
        <Row term="Responsable">{row.responsible_name || "Sin responsable asignado"}</Row>
        {row.substitute_for_name ? <Row term="Sustituye a">{row.substitute_for_name}</Row> : null}
        {row.instructions ? (
          <Row term="Instrucciones">
            <span className="whitespace-pre-line">{row.instructions}</span>
          </Row>
        ) : null}
        {vigentes.length ? (
          <Row term="Mis registros">
            <ul className="space-y-1">
              {vigentes.map((s) => (
                <li key={s.id}>
                  {sessionLine(s, tz)}
                  {s.check_in_method !== "propio" ? (
                    <span className="block text-sm text-gray-600">{METHOD_LABELS[s.check_in_method]}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
      </dl>
    </div>
  );
}

/** Renglón compacto para listas de asignaciones. */
export function MyShiftListItem({ view, action }: { view: MyShiftView; action?: ReactNode }) {
  const { row } = view;
  const status = myShiftStatus(view);
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-semibold text-gray-900">{formatShiftRange(row.starts_at, row.ends_at, row.facility_timezone)}</p>
        <p className="text-gray-700">
          {row.facility_name} · {row.meeting_point}
          {row.assigned_point ? ` · Punto: ${row.assigned_point}` : ""}
        </p>
        {row.responsible_name ? <p className="text-sm text-gray-600">Responsable: {row.responsible_name}</p> : null}
      </div>
      <div className="flex flex-col items-end gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        {action}
      </div>
    </li>
  );
}
