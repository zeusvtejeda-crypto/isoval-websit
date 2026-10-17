import { Badge } from "@/components/ui/badge";
import { auditFieldChanges, auditSubject, changesSummary, eventValueTimeZone, shortId, type ValueContext } from "@/lib/admin/audit-diff";
import { actorRoleLabel, auditActionLabel, auditActionTone, auditTableLabel } from "@/lib/admin/audit-labels";
import { actorDisplay } from "@/lib/admin/audit-filters";
import type { AuditEventRow } from "@/lib/admin/audit-server";
import { formatDateTime } from "@/lib/time";

export function AuditEventCard({
  event,
  ctx,
  currentUserId,
  profileNames,
  facilityNames,
  facilityTimezones,
  roleLabels,
}: {
  event: AuditEventRow;
  ctx: ValueContext;
  currentUserId: string;
  profileNames: Readonly<Record<string, string>>;
  facilityNames: Readonly<Record<string, string>>;
  facilityTimezones: Readonly<Record<string, string>>;
  roleLabels: Readonly<Record<string, string>>;
}) {
  // Fecha del evento: zona por omisión. Fechas del detalle (p. ej. horario de una guardia): zona de la sede.
  const valueTimeZone = eventValueTimeZone(event.facility_id, facilityTimezones, ctx.timeZone ?? "");
  const valueCtx: ValueContext = valueTimeZone ? { ...ctx, timeZone: valueTimeZone } : ctx;
  const changes = auditFieldChanges(event, valueCtx);
  const author = actorDisplay(event.actor_id, profileNames);
  const subject = auditSubject(event, ctx);
  const facility = event.facility_id ? (facilityNames[event.facility_id] ?? `Sede ${shortId(event.facility_id)}`) : null;

  return (
    <li className="rounded-[--radius-card] border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={auditActionTone(event.action)}>{auditActionLabel(event.action)}</Badge>
        <span className="font-semibold text-gray-900">{auditTableLabel(event.table_name)}</span>
        {subject ? <span className="break-words text-gray-700">· {subject}</span> : null}
      </div>
      <p className="mt-1 text-sm text-gray-600">
        <time dateTime={event.occurred_at}>{formatDateTime(event.occurred_at, ctx.timeZone)}</time>
      </p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">Autor</dt>
          <dd className="text-gray-900">
            {author}
            {event.actor_id === currentUserId ? " (tú)" : ""} <span className="text-gray-600">· {actorRoleLabel(event.actor_role, roleLabels)}</span>
          </dd>
        </div>
        {facility ? (
          <div>
            <dt className="text-gray-500">Sede</dt>
            <dd className="text-gray-900">{facility}</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="text-gray-500">Motivo</dt>
          <dd className="whitespace-pre-line break-words text-gray-900">{event.reason?.trim() ? event.reason : <span className="text-gray-500">Sin motivo registrado</span>}</dd>
        </div>
      </dl>
      <details className="group mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-lg font-medium text-brand-800 underline underline-offset-2">
          {changesSummary(event.action, changes.length)}
        </summary>
        {changes.length > 0 ? (
          <dl className="mt-1 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {changes.map((c) => (
              <div key={c.field} className="grid gap-1 px-3 py-2 sm:grid-cols-3 sm:gap-3">
                <dt className="text-sm font-medium text-gray-700">{c.label}</dt>
                <dd className="break-words text-sm text-gray-900 sm:col-span-2">
                  <span className="text-gray-600">{c.before}</span>
                  <span aria-hidden="true" className="px-1.5 text-gray-400">
                    →
                  </span>
                  <span className="sr-only"> cambió a </span>
                  <span className="font-medium">{c.after}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-1 text-sm text-gray-600">El evento no tiene campos que mostrar.</p>
        )}
        {changes.length > 0 && valueTimeZone && valueTimeZone !== ctx.timeZone ? (
          <p className="mt-2 text-xs text-gray-500">Fechas y horas del detalle en la zona de la sede ({valueTimeZone}).</p>
        ) : null}
        {event.record_id ? <p className="mt-2 text-xs text-gray-500">Identificador del registro: {event.record_id}</p> : null}
        <p className="text-xs text-gray-500">Evento n.º {event.id}</p>
      </details>
    </li>
  );
}
