import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadShiftsWithAttendance } from "@/lib/attendance/load";
import { totalize } from "@/lib/attendance/calc";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  ASSIGNMENT_STATUS_LABELS,
  CORRECTION_STATUS_LABELS,
  type Tone,
} from "@/lib/attendance/labels";
import { friendlyDbError } from "@/lib/actions";
import { DEFAULT_TIMEZONE, dayRangeUtc, formatDate, formatDateTime, formatShiftRange, formatTime, todayInTz } from "@/lib/time";
import { addDays, isIsoDay } from "@/lib/presence/periods";
import { EXTRA_TIME_NOTE, NOT_LINKED_MESSAGE, PRESENCE_DISCLAIMER } from "@/lib/presence/texts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, EmptyState } from "@/components/ui/states";
import { IncidentBadges, SessionVersions, SummaryMetrics, TotalsGrid } from "@/components/attendance/history";
import { CorrectionForm, type CorrectionSessionOption } from "./correction-form";

export const metadata: Metadata = { title: "Mi historial" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const MAX_RANGE_DAYS = 366;

const CORRECTION_TONE: Record<keyof typeof CORRECTION_STATUS_LABELS, Tone> = {
  pendiente: "warning",
  aprobada: "success",
  rechazada: "danger",
};

type CorrectionRow = {
  id: string;
  assignment_id: string;
  session_id: string | null;
  facility_id: string;
  requested_check_in_at: string | null;
  requested_check_out_at: string | null;
  reason: string;
  status: keyof typeof CORRECTION_STATUS_LABELS;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
};

function resolveRange(sp: Record<string, string | string[] | undefined>, today: string) {
  const notices: string[] = [];
  let desde = isIsoDay(sp.desde) ? sp.desde : addDays(today, -30);
  let hasta = isIsoDay(sp.hasta) ? sp.hasta : today;
  if ((sp.desde && !isIsoDay(sp.desde)) || (sp.hasta && !isIsoDay(sp.hasta))) notices.push("Alguna fecha no era válida; se usó el valor por omisión.");
  if (hasta < desde) {
    [desde, hasta] = [hasta, desde];
    notices.push("La fecha final era anterior a la inicial; se intercambiaron.");
  }
  if (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`) > MAX_RANGE_DAYS * 86_400_000) {
    desde = addDays(hasta, -MAX_RANGE_DAYS);
    notices.push(`El periodo máximo es de ${MAX_RANGE_DAYS} días; se ajustó la fecha inicial.`);
  }
  return { desde, hasta, notices };
}

export default async function MiHistorialPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();

  if (!user.workerId) {
    return (
      <>
        <PageHeader title="Mi historial" />
        <Alert tone="warning" title="Cuenta sin vincular">
          {NOT_LINKED_MESSAGE}
        </Alert>
      </>
    );
  }
  const workerId = user.workerId;

  const sp = await searchParams;
  const today = todayInTz(DEFAULT_TIMEZONE);
  const { desde, hasta, notices } = resolveRange(sp, today);
  const from = dayRangeUtc(desde, DEFAULT_TIMEZONE).start;
  const to = dayRangeUtc(hasta, DEFAULT_TIMEZONE).end;

  const now = new Date();
  const supabase = await createClient();
  const [shifts, correctionsRes] = await Promise.all([
    loadShiftsWithAttendance(supabase, { from, to, workerId, includeCancelled: true, now }),
    supabase
      .from("correction_requests")
      .select("id, assignment_id, session_id, facility_id, requested_check_in_at, requested_check_out_at, reason, status, review_notes, reviewed_at, created_at")
      .eq("worker_id", workerId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (correctionsRes.error) throw new Error(friendlyDbError(correctionsRes.error, "No se pudieron cargar tus solicitudes."));
  const corrections = (correctionsRes.data ?? []) as CorrectionRow[];

  // Sedes para mostrar las horas de las solicitudes en su zona.
  const facilities = new Map<string, { name: string; timezone: string }>();
  for (const s of shifts) if (s.facility) facilities.set(s.facility.id, { name: s.facility.official_name, timezone: s.facility.timezone });
  const missing = [...new Set(corrections.map((c) => c.facility_id))].filter((id) => !facilities.has(id));
  if (missing.length) {
    const { data } = await supabase.from("facilities").select("id, official_name, timezone").in("id", missing);
    for (const f of data ?? []) facilities.set(f.id, { name: f.official_name, timezone: f.timezone });
  }

  const pendingSessions = new Set(corrections.filter((c) => c.status === "pendiente" && c.session_id).map((c) => c.session_id as string));

  const items = shifts
    // Historial = guardias ya iniciadas; las próximas se consultan en «Mi guardia».
    .filter((s) => Date.parse(s.shift.starts_at) <= now.getTime())
    .flatMap((s) => {
      const mine = s.assignments.find((a) => a.assignment.worker_id === workerId);
      return mine ? [{ shift: s, mine }] : [];
    })
    .sort((a, b) => Date.parse(b.shift.shift.starts_at) - Date.parse(a.shift.shift.starts_at));
  const totals = totalize(items.map((i) => i.mine.summary));

  const exportQuery = (formato: "xlsx" | "pdf") =>
    `/api/exportar?${new URLSearchParams({ formato, trabajador: "yo", desde, hasta }).toString()}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mi historial"
        description="Tus guardias ya iniciadas, registros, tiempo registrado e incidencias. Horarios en la zona de cada sede. Las próximas guardias están en «Mi guardia»."
      />

      <Card>
        <Form action="/mi-historial" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Desde" htmlFor="desde" required>
            <Input id="desde" name="desde" type="date" defaultValue={desde} max={today} required />
          </Field>
          <Field label="Hasta" htmlFor="hasta" required>
            <Input id="hasta" name="hasta" type="date" defaultValue={hasta} required />
          </Field>
          <Button type="submit" size="md" className="w-full sm:w-auto">
            Aplicar filtro
          </Button>
        </Form>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={exportQuery("xlsx")} className={buttonClasses("outline", "md")}>
            Descargar Excel
          </a>
          <a href={exportQuery("pdf")} className={buttonClasses("outline", "md")}>
            Descargar PDF
          </a>
          <Link href="/mi-historial" className={buttonClasses("ghost", "md")}>
            Últimos 30 días
          </Link>
        </div>
        {notices.length ? (
          <Alert tone="info" className="mt-3">
            {notices.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </Alert>
        ) : null}
      </Card>

      <section aria-labelledby="totales">
        <h2 id="totales" className="mb-2 text-lg font-semibold text-gray-900">
          Totales del {formatDate(from, DEFAULT_TIMEZONE)} al {formatDate(dayRangeUtc(hasta, DEFAULT_TIMEZONE).start, DEFAULT_TIMEZONE)}
        </h2>
        <TotalsGrid totals={totals} />
      </section>

      <section aria-labelledby="guardias" className="space-y-3">
        <h2 id="guardias" className="text-lg font-semibold text-gray-900">
          Guardias del periodo
        </h2>
        <p className="text-sm text-gray-600">{PRESENCE_DISCLAIMER}</p>
        {items.length === 0 ? (
          <EmptyState title="Sin guardias en este periodo" description="Cambia las fechas para consultar otro periodo." />
        ) : (
          items.map(({ shift: item, mine }) => {
            const tz = item.facility?.timezone ?? DEFAULT_TIMEZONE;
            const cancelled = item.shift.status === "cancelada";
            const options: CorrectionSessionOption[] = mine.sessions
              .filter((s) => s.record_status === "vigente")
              .sort((a, b) => Date.parse(a.check_in_at) - Date.parse(b.check_in_at))
              .map((s) => ({
                id: s.id,
                label: `Entrada ${formatTime(s.check_in_at, tz)} · ${s.check_out_at ? `Salida ${formatTime(s.check_out_at, tz)}` : "sin salida"}`,
                pending: pendingSessions.has(s.id),
              }));
            const canRequest = !cancelled && mine.assignment.status !== "cancelado";
            return (
              <Card key={mine.assignment.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize text-gray-600">{formatDate(item.shift.starts_at, tz)}</p>
                    <h3 className="text-lg font-semibold text-gray-900">{item.facility?.official_name ?? "Sede"}</h3>
                    <p className="text-gray-800">{formatShiftRange(item.shift.starts_at, item.shift.ends_at, tz)}</p>
                    <p className="text-sm text-gray-600">
                      Punto de reunión: {item.shift.meeting_point}
                      {mine.assignment.assigned_point ? ` · Punto asignado: ${mine.assignment.assigned_point}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={ATTENDANCE_STATUS_TONE[mine.summary.status]}>{ATTENDANCE_STATUS_LABELS[mine.summary.status]}</Badge>
                    {mine.assignment.status !== "asignado" && mine.assignment.status_reason ? (
                      <span className="text-sm text-gray-600">
                        {ASSIGNMENT_STATUS_LABELS[mine.assignment.status]}: {mine.assignment.status_reason}
                      </span>
                    ) : null}
                    {cancelled && item.shift.cancel_reason ? <span className="text-sm text-gray-600">Motivo: {item.shift.cancel_reason}</span> : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-2 font-semibold text-gray-900">Registros</h4>
                    <SessionVersions sessions={mine.sessions} timeZone={tz} />
                  </div>
                  <div className="space-y-3">
                    <div>
                      <h4 className="mb-2 font-semibold text-gray-900">Tiempo registrado</h4>
                      <SummaryMetrics summary={mine.summary} />
                    </div>
                    <div>
                      <h4 className="mb-2 font-semibold text-gray-900">Incidencias</h4>
                      <IncidentBadges summary={mine.summary} />
                    </div>
                  </div>
                </div>

                {canRequest ? (
                  <details className="mt-4 rounded-xl border border-gray-200 px-3">
                    <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-brand-900">Solicitar corrección</summary>
                    <div className="pb-4 pt-1">
                      <CorrectionForm assignmentId={mine.assignment.id} timeZone={tz} sessions={options} />
                    </div>
                  </details>
                ) : null}
              </Card>
            );
          })
        )}
        {items.length ? <p className="text-sm text-gray-600">{EXTRA_TIME_NOTE}</p> : null}
      </section>

      <Card>
        <CardHeader title="Mis solicitudes de corrección" description="Coordinación revisa cada solicitud; el registro original se conserva." />
        {corrections.length === 0 ? (
          <p className="text-gray-600">No has enviado solicitudes de corrección.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {corrections.map((c) => {
              const f = facilities.get(c.facility_id);
              const tz = f?.timezone ?? DEFAULT_TIMEZONE;
              return (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-gray-900">{f?.name ?? "Sede"}</p>
                    <Badge tone={CORRECTION_TONE[c.status]}>{CORRECTION_STATUS_LABELS[c.status]}</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Enviada: {formatDateTime(c.created_at, tz)}</p>
                  <p className="text-gray-800">
                    {c.requested_check_in_at ? `Entrada propuesta: ${formatDateTime(c.requested_check_in_at, tz)}` : "Entrada sin cambio"}
                    {" · "}
                    {c.requested_check_out_at ? `Salida propuesta: ${formatDateTime(c.requested_check_out_at, tz)}` : "Salida sin cambio"}
                  </p>
                  <p className="text-sm text-gray-700">Motivo: {c.reason}</p>
                  {c.review_notes ? <p className="text-sm text-gray-700">Respuesta de coordinación: {c.review_notes}</p> : null}
                  {c.reviewed_at ? <p className="text-xs text-gray-500">Revisada: {formatDateTime(c.reviewed_at, tz)}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
