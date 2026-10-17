import Link from "next/link";
import type { ReactNode } from "react";
import { CORRECTION_STATUS_LABELS, afterPreposition, type Tone } from "@/lib/attendance/labels";
import { DEFAULT_TIMEZONE, formatDateTime, formatShiftRange } from "@/lib/time";
import { actorLabel, type ActorContext } from "@/lib/reports/actors";
import { correctionContext, describeCorrection } from "@/lib/reports/corrections";
import type { CorrectionListItem } from "@/lib/reports/corrections-load";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";

export const CORRECTION_TONE: Record<keyof typeof CORRECTION_STATUS_LABELS, Tone> = {
  pendiente: "warning",
  aprobada: "success",
  rechazada: "danger",
};

function TimeCell({ value, empty }: { value: string | null; empty: string }) {
  return value ? <span className="text-gray-900">{value}</span> : <span className="text-gray-500">{empty}</span>;
}

/**
 * Solicitud de corrección: horas actuales vs solicitadas (zona de la sede),
 * motivo, quién la pidió y cuándo, y el resultado de la revisión.
 */
export function CorrectionCard({
  item,
  actors,
  workerProfileIds,
  showWorker = true,
  children,
}: {
  item: CorrectionListItem;
  actors: Pick<ActorContext, "currentUserId" | "names">;
  /** Cuenta de acceso de cada trabajador (para «la propia persona»). */
  workerProfileIds: Record<string, string>;
  showWorker?: boolean;
  /** Formulario de revisión (solo pendientes y con permiso). */
  children?: ReactNode;
}) {
  const tz = item.facility?.timezone ?? DEFAULT_TIMEZONE;
  const view = describeCorrection(item, item.session, tz, correctionContext(item));
  const shift = item.assignment?.shift ?? null;
  const ctx: ActorContext = { ...actors, workerProfileId: workerProfileIds[item.worker_id] ?? null };

  return (
    <article className="rounded-card border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {showWorker ? (
            <h3 className="text-lg font-semibold text-gray-900">
              {item.worker ? (
                <Link href={`/historial/trabajador/${item.worker.id}`} className="text-brand-900 underline-offset-2 hover:underline">
                  {item.worker.full_name}
                </Link>
              ) : (
                "Persona no visible"
              )}
            </h3>
          ) : null}
          <p className="text-gray-800">{item.facility?.official_name ?? "Sede"}</p>
          {shift ? (
            <p className="text-sm text-gray-700">
              Guardia:{" "}
              <Link href={`/guardias/${shift.id}`} className="font-medium text-brand-800 underline underline-offset-2">
                {formatShiftRange(shift.starts_at, shift.ends_at, tz)}
              </Link>
              {` · ${shift.title ?? shift.meeting_point}`}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={CORRECTION_TONE[item.status]}>{CORRECTION_STATUS_LABELS[item.status]}</Badge>
          <span className="text-xs text-gray-600">{view.kind === "ajuste" ? "Ajuste de un registro" : "Registro nuevo (faltó registrar)"}</span>
        </div>
      </div>

      <div className="relative mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Horas actuales y solicitadas, en la zona horaria de la sede</caption>
          <thead>
            <tr className="text-gray-600">
              <th scope="col" className="py-1 pr-3 font-medium">
                <span className="sr-only">Concepto</span>
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Entrada
              </th>
              <th scope="col" className="py-1 font-medium">
                Salida
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <th scope="row" className="py-1.5 pr-3 font-medium text-gray-700">
                {item.status === "pendiente" ? "Registro actual" : "Registro original"}
              </th>
              <td className="py-1.5 pr-3">
                <TimeCell value={view.current.checkIn} empty={view.kind === "nuevo" ? "Sin registro" : "—"} />
              </td>
              <td className="py-1.5">
                <TimeCell value={view.current.checkOut} empty={view.kind === "nuevo" ? "Sin registro" : "Sin salida"} />
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-1.5 pr-3 font-medium text-gray-700">
                Solicitado
              </th>
              <td className="py-1.5 pr-3 font-semibold">
                <TimeCell value={view.requested.checkIn} empty="Sin cambio" />
              </td>
              <td className="py-1.5 font-semibold">
                <TimeCell value={view.requested.checkOut} empty="Sin cambio" />
              </td>
            </tr>
            {item.status === "pendiente" ? (
              <tr>
                <th scope="row" className="py-1.5 pr-3 font-medium text-gray-700">
                  Quedaría si se aprueba
                </th>
                <td className="py-1.5 pr-3">
                  <TimeCell value={view.result.checkIn} empty="—" />
                </td>
                <td className="py-1.5">
                  <TimeCell value={view.result.checkOut} empty="Sin salida" />
                </td>
              </tr>
            ) : null}
            {item.status === "aprobada" && item.resulting ? (
              <tr>
                <th scope="row" className="py-1.5 pr-3 font-medium text-gray-700">
                  Registro resultante
                </th>
                <td className="py-1.5 pr-3">{formatDateTime(item.resulting.check_in_at, tz)}</td>
                <td className="py-1.5">{item.resulting.check_out_at ? formatDateTime(item.resulting.check_out_at, tz) : "Sin salida"}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-gray-500">Horas en la zona horaria de la sede ({tz}).</p>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <p className="text-gray-800">
          <span className="font-medium">Motivo:</span> {item.reason}
        </p>
        <p className="text-gray-600">
          Solicitada por {afterPreposition(actorLabel(item.requested_by, ctx))} el {formatDateTime(item.created_at, tz)}
        </p>
        {item.status !== "pendiente" ? (
          <p className="text-gray-600">
            {item.status === "aprobada" ? "Aprobada" : "Rechazada"} por {afterPreposition(actorLabel(item.reviewed_by, ctx))}
            {item.reviewed_at ? ` el ${formatDateTime(item.reviewed_at, tz)}` : ""}
          </p>
        ) : null}
        {item.review_notes ? (
          <p className="text-gray-800">
            <span className="font-medium">Notas de revisión:</span> {item.review_notes}
          </p>
        ) : null}
      </div>

      {item.status === "pendiente" && view.revertNote ? (
        <Alert tone="info" title="Aprobar revierte el estado de la asignación" className="mt-3">
          <p>{view.revertNote}</p>
        </Alert>
      ) : null}

      {item.status === "pendiente" && view.warnings.length ? (
        <Alert tone="warning" className="mt-3">
          {view.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Alert>
      ) : null}

      {children ? <div className="mt-4 border-t border-gray-100 pt-4">{children}</div> : null}
    </article>
  );
}
