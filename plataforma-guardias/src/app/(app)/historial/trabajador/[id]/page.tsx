import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AssignmentWithAttendance } from "@/lib/attendance/load";
import { ASSIGNMENT_STATUS_LABELS, ATTENDANCE_STATUS_TONE, INCIDENT_LABELS, afterPreposition } from "@/lib/attendance/labels";
import { DEFAULT_TIMEZONE, formatDateTime, formatDuration, todayInTz } from "@/lib/time";
import { isGuid, parseReportFilters, readParam, type RawParams, type ReportFilters } from "@/lib/reports/params";
import { getProfileNames, getWorkerProfileIds, loadIncidentNotes, loadReport, type IncidentNoteRow } from "@/lib/reports/load";
import { loadCorrections } from "@/lib/reports/corrections-load";
import { reportTotals } from "@/lib/reports/rows";
import { dayLabel, GAP_LABEL } from "@/lib/reports/document";
import { actorLabel, type ActorContext } from "@/lib/reports/actors";
import { ONLY_STARTED_NOTICE, PRESENCE_NOTICE } from "@/lib/reports/texts";
import { PageHeader } from "@/components/ui/page-header";
import { LastUpdated } from "@/components/layout/connection-status";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, EmptyState } from "@/components/ui/states";
import { ReportTotals } from "../../_components/totals-grid";
import { ExportLinks } from "../../_components/export-links";
import { SessionHistory } from "./_components/session-history";
import { CorrectionCard } from "../../../correcciones/_components/correction-card";

export const metadata: Metadata = { title: "Historial del trabajador" };

type WorkerHeader = {
  id: string;
  full_name: string;
  internal_code: string;
  active: boolean;
  facility: { id: string; official_name: string } | null;
  state: { name: string } | null;
};

/** Días por omisión del historial individual. */
const WORKER_DEFAULT_DAYS = 30;

function AssignmentStatusNote({ item, actors, tz }: { item: AssignmentWithAttendance; actors: ActorContext; tz: string }) {
  const a = item.assignment;
  // «Asignado» con motivo: el estado se restableció (p. ej., al aprobar una corrección de una inasistencia).
  if (a.status === "asignado" && !a.status_reason) return null;
  return (
    <p className="text-sm text-gray-700">
      {a.status === "asignado" ? "Estado restablecido a «Asignado»" : ASSIGNMENT_STATUS_LABELS[a.status]}
      {a.status_reason ? `: ${a.status_reason}` : ""}
      {a.status_changed_by ? ` · Registrado por ${afterPreposition(actorLabel(a.status_changed_by, actors))}` : ""}
      {a.status_changed_at ? ` el ${formatDateTime(a.status_changed_at, tz)}` : ""}
    </p>
  );
}

export default async function HistorialTrabajadorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawParams> }) {
  const user = await requireStaff();
  const { id: rawId } = await params;
  if (!isGuid(rawId)) notFound();
  const id = rawId.toLowerCase();

  const supabase = await createClient();
  const { data: worker, error: workerError } = await supabase
    .from("workers")
    .select(
      "id, full_name, internal_code, active, facility:facilities!workers_facility_id_fkey(id, official_name), state:states!workers_state_id_fkey(name)",
    )
    .eq("id", id)
    .maybeSingle<WorkerHeader>();
  if (workerError) throw new Error(workerError.message);
  // RLS: si la cuenta no puede ver a la persona, no existe para ella.
  if (!worker) notFound();

  const sp = await searchParams;
  const now = new Date();
  const today = todayInTz(DEFAULT_TIMEZONE, now);
  // Esta vista solo filtra por periodo: se ignoran otros parámetros para no
  // mostrar avisos de filtros que aquí no existen.
  const parsed = parseReportFilters({ desde: readParam(sp, "desde"), hasta: readParam(sp, "hasta") }, today, {
    defaultDays: WORKER_DEFAULT_DAYS,
  });
  const filters: ReportFilters = {
    desde: parsed.filters.desde,
    hasta: parsed.filters.hasta,
    facilityId: null,
    stateId: null,
    workerId: id,
    attendance: "todas",
    incident: "",
  };

  const [report, corrections, workerProfiles] = await Promise.all([
    loadReport(supabase, filters, now),
    loadCorrections(supabase, { status: "todas", workerId: id, limit: 100 }),
    getWorkerProfileIds(supabase, [id]),
  ]);

  const byAssignment = new Map<string, AssignmentWithAttendance>();
  for (const s of report.shifts) for (const a of s.assignments) byAssignment.set(a.assignment.id, a);

  // Más recientes primero en la vista individual (orden por fecha, no por desempeño).
  const rows = report.rows.slice().reverse();
  const assignmentIds = rows.map((r) => r.assignmentId);
  const notes = await loadIncidentNotes(supabase, assignmentIds);
  const notesByAssignment = new Map<string, IncidentNoteRow[]>();
  for (const n of notes) notesByAssignment.set(n.assignment_id, [...(notesByAssignment.get(n.assignment_id) ?? []), n]);

  const actorIds: Array<string | null> = [];
  for (const r of rows) {
    const item = byAssignment.get(r.assignmentId);
    if (!item) continue;
    actorIds.push(item.assignment.status_changed_by);
    for (const s of item.sessions) actorIds.push(s.check_in_by, s.check_out_by, s.status_changed_by);
  }
  for (const n of notes) actorIds.push(n.created_by);
  for (const c of corrections.items) actorIds.push(c.requested_by, c.reviewed_by);
  const names = await getProfileNames(supabase, actorIds);
  const workerProfileId = workerProfiles[id] ?? null;
  const actors: ActorContext = { currentUserId: user.id, names, workerProfileId };

  const totals = reportTotals(rows);
  const pendingByAssignment = new Set(corrections.items.filter((c) => c.status === "pendiente").map((c) => c.assignment_id));
  // Mismo contenido que la vista: todas las guardias de la persona, incluidas canceladas.
  const exportFilters: Partial<ReportFilters> = { desde: filters.desde, hasta: filters.hasta, workerId: id, attendance: filters.attendance };

  return (
    <div className="space-y-5">
      <PageHeader
        title={worker.full_name}
        description={
          <>
            Sede de adscripción: {worker.facility?.official_name ?? "Sin sede asignada"}
            {worker.state ? ` · ${worker.state.name}` : ""} · Clave interna {worker.internal_code}
            {!worker.active ? " · Registro inactivo" : ""}
          </>
        }
        actions={
          <Link href={`/historial?${new URLSearchParams({ desde: filters.desde, hasta: filters.hasta }).toString()}`} className={buttonClasses("outline")}>
            Volver al historial
          </Link>
        }
      />
      <LastUpdated at={now.toISOString()} timeZone={DEFAULT_TIMEZONE} />

      <Card>
        <Form action={`/historial/trabajador/${id}`} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Desde" htmlFor="desde" required>
            <Input id="desde" name="desde" type="date" defaultValue={filters.desde} max={today} required />
          </Field>
          <Field label="Hasta" htmlFor="hasta" required>
            <Input id="hasta" name="hasta" type="date" defaultValue={filters.hasta} required />
          </Field>
          <Button type="submit" className="w-full sm:w-auto">
            Aplicar periodo
          </Button>
        </Form>
        <div className="mt-4 border-t border-gray-100 pt-4">
          <ExportLinks filters={exportFilters} />
        </div>
        {parsed.notices.length ? (
          <Alert tone="info" title="Periodo ajustado" className="mt-3">
            {parsed.notices.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </Alert>
        ) : null}
      </Card>

      <section aria-labelledby="totales" className="space-y-2">
        <h2 id="totales" className="text-lg font-semibold text-gray-900">
          Totales del {dayLabel(filters.desde)} al {dayLabel(filters.hasta)}
        </h2>
        <ReportTotals totals={totals} />
      </section>

      <section aria-labelledby="guardias" className="space-y-3">
        <div>
          <h2 id="guardias" className="text-lg font-semibold text-gray-900">
            Guardias del periodo
          </h2>
          <p className="text-sm text-gray-600">
            De la más reciente a la más antigua. {ONLY_STARTED_NOTICE}
          </p>
          <p className="text-sm font-medium text-gray-800">{PRESENCE_NOTICE}</p>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="Sin guardias en este periodo" description="Cambia las fechas para consultar otro periodo." />
        ) : (
          rows.map((r) => {
            const item = byAssignment.get(r.assignmentId);
            const assignmentNotes = notesByAssignment.get(r.assignmentId) ?? [];
            return (
              <Card key={r.assignmentId}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize text-gray-600">{r.dateLabel}</p>
                    <h3 className="text-lg font-semibold text-gray-900">{r.facilityName}</h3>
                    <p className="text-gray-800">
                      {r.scheduleLabel} <span className="text-sm text-gray-600">({r.timeZone}, {r.zoneOffset})</span>
                    </p>
                    <p className="text-sm text-gray-600">Punto de reunión: {r.meetingPoint}</p>
                    {r.substituteForName ? <p className="text-sm text-gray-700">Sustituye a: {r.substituteForName}</p> : null}
                    {item ? <AssignmentStatusNote item={item} actors={actors} tz={r.timeZone} /> : null}
                    {item?.assignment.notes?.trim() ? (
                      <p className="whitespace-pre-line text-sm text-gray-700">Notas de la asignación: {item.assignment.notes.trim()}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge tone={ATTENDANCE_STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
                    {pendingByAssignment.has(r.assignmentId) ? <Badge tone="warning">Corrección pendiente</Badge> : null}
                    <Link href={`/guardias/${r.shiftId}`} className="inline-flex min-h-11 items-center font-semibold text-brand-800 underline underline-offset-2">
                      Ver guardia
                    </Link>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  {(
                    [
                      ["Programado", formatDuration(r.scheduledMinutes)],
                      ["Dentro del horario", formatDuration(r.withinScheduleMinutes)],
                      ["Fuera del horario", formatDuration(r.outsideScheduleMinutes)],
                      ["Total registrado", formatDuration(r.totalMinutes)],
                      ["Diferencia", formatDuration(r.differenceMinutes)],
                      ["Retraso", r.lateMinutes == null ? "—" : formatDuration(r.lateMinutes)],
                      ["Salida anticipada", r.earlyLeaveMinutes == null ? "—" : formatDuration(r.earlyLeaveMinutes)],
                      ["Permanencia adicional", formatDuration(r.extraStayMinutes)],
                      [GAP_LABEL, formatDuration(r.gapMinutes)],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-gray-600">{k}</dt>
                      <dd className="font-semibold text-gray-900">{v}</dd>
                    </div>
                  ))}
                </dl>
                {r.openSession ? (
                  <p className="mt-2 text-sm text-gray-700">Hay una entrada sin salida: no suma tiempo registrado hasta que se cierre o se corrija.</p>
                ) : null}

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-2 font-semibold text-gray-900">Registros y versiones</h4>
                    {item ? <SessionHistory sessions={item.sessions} timeZone={r.timeZone} actors={actors} /> : null}
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold text-gray-900">Incidencias y justificaciones</h4>
                    {r.summary.incidents.length === 0 && assignmentNotes.length === 0 ? (
                      <p className="text-sm text-gray-600">Sin incidencias.</p>
                    ) : (
                      <ul className="space-y-2">
                        {r.summary.incidents.map((inc) => {
                          const note = assignmentNotes.find((n) => n.incident_type === inc.type);
                          return (
                            <li key={inc.type} className="rounded-xl border border-gray-200 p-3">
                              <Badge tone={inc.type === "registro_incompleto" ? "warning" : "neutral"}>
                                {INCIDENT_LABELS[inc.type]}
                                {inc.minutes != null ? `: ${formatDuration(inc.minutes)}` : ""}
                              </Badge>
                              {note ? (
                                <p className="mt-1 text-sm text-gray-800">
                                  {note.justified ? "Justificada" : "Nota sin justificar"}: {note.note}
                                  <span className="block text-xs text-gray-600">
                                    {actorLabel(note.created_by, actors)} · {formatDateTime(note.updated_at, r.timeZone)}
                                  </span>
                                </p>
                              ) : (
                                <p className="mt-1 text-sm text-gray-600">Sin justificación registrada.</p>
                              )}
                            </li>
                          );
                        })}
                        {assignmentNotes
                          .filter((n) => !r.summary.incidents.some((i) => i.type === n.incident_type))
                          .map((n) => (
                            <li key={n.id} className="rounded-xl border border-dashed border-gray-300 p-3">
                              <Badge tone="muted">{INCIDENT_LABELS[n.incident_type]} (ya no se calcula)</Badge>
                              <p className="mt-1 text-sm text-gray-800">
                                {n.justified ? "Justificada" : "Nota sin justificar"}: {n.note}
                                <span className="block text-xs text-gray-600">
                                  {actorLabel(n.created_by, actors)} · {formatDateTime(n.updated_at, r.timeZone)}
                                </span>
                              </p>
                            </li>
                          ))}
                      </ul>
                    )}
                    <p className="mt-2 text-xs text-gray-600">Las incidencias son señales para revisión; no generan sanciones automáticas.</p>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </section>

      <section aria-labelledby="solicitudes" className="space-y-3">
        <CardHeader
          title={<span id="solicitudes">Solicitudes de corrección</span>}
          description="Todas las solicitudes de esta persona (cualquier fecha). El registro original siempre se conserva."
          actions={
            // Salvo administración, nadie revisa solicitudes sobre su propia asistencia.
            user.canManage && (user.isAdmin || user.workerId !== id) && corrections.items.some((c) => c.status === "pendiente") ? (
              <Link href="/correcciones" className={buttonClasses("outline")}>
                Revisar pendientes
              </Link>
            ) : null
          }
        />
        {corrections.items.length === 0 ? (
          <EmptyState title="Sin solicitudes de corrección" description="Esta persona no tiene solicitudes registradas que puedas ver." />
        ) : (
          <>
            {corrections.items.map((c) => (
              <CorrectionCard key={c.id} item={c} actors={actors} workerProfileIds={workerProfiles} showWorker={false} />
            ))}
            {corrections.truncated ? <p className="text-sm text-gray-600">Se muestran las 100 solicitudes más recientes.</p> : null}
          </>
        )}
      </section>
    </div>
  );
}
