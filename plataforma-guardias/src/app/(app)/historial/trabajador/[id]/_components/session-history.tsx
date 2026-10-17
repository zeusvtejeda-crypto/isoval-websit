import type { SessionRow } from "@/lib/attendance/load";
import { METHOD_LABELS, RECORD_STATUS_LABELS, type Tone } from "@/lib/attendance/labels";
import { formatDateTime } from "@/lib/time";
import { actorLabel, type ActorContext } from "@/lib/reports/actors";
import { Badge } from "@/components/ui/badge";

const RECORD_TONE: Record<SessionRow["record_status"], Tone> = {
  vigente: "success",
  corregido: "muted",
  anulado: "muted",
};

/**
 * Sesiones de una asignación: vigentes y versiones corregidas o anuladas, con
 * quién registró o cambió cada una y por qué (trazabilidad).
 */
export function SessionHistory({ sessions, timeZone, actors }: { sessions: SessionRow[]; timeZone: string; actors: ActorContext }) {
  if (sessions.length === 0) return <p className="text-gray-600">Sin registros de entrada o salida.</p>;
  const sorted = sessions
    .slice()
    .sort((a, b) => Date.parse(a.check_in_at) - Date.parse(b.check_in_at) || a.created_at.localeCompare(b.created_at));
  return (
    <ul className="space-y-2">
      {sorted.map((s) => {
        const vigente = s.record_status === "vigente";
        return (
          <li
            key={s.id}
            className={vigente ? "rounded-xl border border-gray-200 p-3" : "rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-gray-700"}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={RECORD_TONE[s.record_status]}>{RECORD_STATUS_LABELS[s.record_status]}</Badge>
              {s.supersedes_id ? <Badge tone="info">Versión corregida de un registro anterior</Badge> : null}
            </div>
            <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-gray-600">Entrada</dt>
                <dd className={vigente ? "text-base text-gray-900" : "text-base line-through decoration-gray-400"}>
                  {formatDateTime(s.check_in_at, timeZone)}
                </dd>
                <dd className="text-gray-600">
                  {METHOD_LABELS[s.check_in_method]} · {actorLabel(s.check_in_by, actors, s.check_in_method)}
                </dd>
                {s.check_in_reason && s.check_in_method !== "propio" ? <dd className="text-gray-700">Motivo: {s.check_in_reason}</dd> : null}
              </div>
              <div>
                <dt className="font-medium text-gray-600">Salida</dt>
                <dd className={vigente ? "text-base text-gray-900" : "text-base line-through decoration-gray-400"}>
                  {s.check_out_at ? formatDateTime(s.check_out_at, timeZone) : "Sin salida (no suma tiempo registrado)"}
                </dd>
                {s.check_out_method ? (
                  <dd className="text-gray-600">
                    {METHOD_LABELS[s.check_out_method]} · {actorLabel(s.check_out_by, actors, s.check_out_method)}
                  </dd>
                ) : null}
                {s.check_out_reason && s.check_out_method && s.check_out_method !== "propio" && s.check_out_reason !== s.check_in_reason ? (
                  <dd className="text-gray-700">Motivo: {s.check_out_reason}</dd>
                ) : null}
              </div>
            </dl>
            {!vigente ? (
              <p className="mt-2 text-sm text-gray-800">
                {s.record_status === "corregido" ? "Corregido" : "Anulado"} por {actorLabel(s.status_changed_by, actors)}
                {s.status_changed_at ? ` el ${formatDateTime(s.status_changed_at, timeZone)}` : ""}
                {s.status_reason ? `. Motivo: ${s.status_reason}` : ""}
              </p>
            ) : null}
            {s.notes ? <p className="mt-1 text-sm text-gray-700">Nota: {s.notes}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
