import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff, ROLE_LABELS } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadShiftsWithAttendance } from "@/lib/attendance/load";
import { friendlyDbError } from "@/lib/actions";
import { guardiasQuickLinkDescription, summarizeHome } from "@/lib/presence/home";
import { PRESENCE_DISCLAIMER } from "@/lib/presence/texts";
import { addDays } from "@/lib/presence/periods";
import { DEFAULT_TIMEZONE, formatLongDate, todayInTz } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { LastUpdated } from "@/components/layout/connection-status";

export const metadata: Metadata = { title: "Inicio" };

const DAY = 86_400_000;

function SummaryTile({ label, value, hint, href, attention }: { label: string; value: number; hint: string; href: string; attention?: boolean }) {
  return (
    <Link
      href={href}
      className={
        attention
          ? "block min-h-11 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 hover:bg-amber-100"
          : "block min-h-11 rounded-xl border border-gray-200 bg-white p-4 hover:bg-gray-50"
      }
    >
      <p className="text-sm text-gray-700">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-600">
        {attention ? <span className="font-semibold text-amber-900">Requiere atención · </span> : null}
        {hint}
      </p>
    </Link>
  );
}

function QuickLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className="flex min-h-16 flex-col justify-center rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-brand-700 hover:bg-brand-50">
      <span className="text-lg font-semibold text-brand-900">{title}</span>
      <span className="text-sm text-gray-600">{description}</span>
    </Link>
  );
}

export default async function InicioPage() {
  const user = await requireStaff();
  const supabase = await createClient();
  const now = new Date();
  const scope = user.isAdmin ? null : user.facilityIds;
  const noScope = scope !== null && scope.length === 0;

  // Una sola carga: últimos 7 días (registros incompletos) hasta mañana (guardias de hoy en cualquier zona).
  const [shifts, pendingRes] = await Promise.all([
    loadShiftsWithAttendance(supabase, {
      from: new Date(now.getTime() - 7 * DAY),
      to: new Date(now.getTime() + 2 * DAY),
      facilityIds: scope,
      now,
    }),
    noScope
      ? Promise.resolve({ count: 0, error: null })
      : (() => {
          let q = supabase.from("correction_requests").select("id", { count: "exact", head: true }).eq("status", "pendiente");
          if (scope) q = q.in("facility_id", scope);
          return q;
        })(),
  ]);
  if (pendingRes.error) throw new Error(friendlyDbError(pendingRes.error, "No se pudieron contar las solicitudes de corrección."));
  const summary = summarizeHome(shifts, now, 7);
  const pendingCorrections = pendingRes.count ?? 0;
  const today = todayInTz(DEFAULT_TIMEZONE, now);
  const incompleteHref = `/historial?${new URLSearchParams({ asistencia: "registro_incompleto", desde: addDays(today, -7), hasta: today }).toString()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inicio"
        description={
          <>
            Hola, {user.displayName ?? user.email ?? "usuario"} · {ROLE_LABELS[user.role]}. Resumen del{" "}
            {formatLongDate(now, DEFAULT_TIMEZONE)}.
          </>
        }
      />
      <LastUpdated at={now.toISOString()} timeZone={DEFAULT_TIMEZONE} />

      {noScope ? (
        <Alert tone="warning" title="Sin sedes asignadas">
          Tu cuenta no tiene sedes asignadas, por lo que no verás guardias ni registros. Pide a administración que te asigne sedes.
        </Alert>
      ) : null}

      <section aria-labelledby="resumen-hoy">
        <h2 id="resumen-hoy" className="mb-3 text-lg font-semibold text-gray-900">
          Resumen de hoy
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SummaryTile label="Guardias de hoy" value={summary.shiftsToday} hint={`${summary.shiftsInProgress} en curso ahora`} href="/guardias" />
          <SummaryTile label="Personas en servicio" value={summary.peopleInService} hint="Con entrada registrada y sin salida" href="/en-servicio" />
          <SummaryTile
            label="Cobertura insuficiente"
            value={summary.insufficientCoverage}
            hint="Guardias de hoy por debajo del mínimo"
            href="/en-servicio#cobertura"
            attention={summary.insufficientCoverage > 0}
          />
          {user.canManage ? (
            <SummaryTile
              label="Correcciones pendientes"
              value={pendingCorrections}
              hint="Solicitudes por revisar en tus sedes"
              href="/correcciones"
              attention={pendingCorrections > 0}
            />
          ) : null}
          <SummaryTile
            label="Registros incompletos"
            value={summary.incompleteRecent}
            hint={`Últimos 7 días · ${summary.noRecordsRecent} asignación(es) sin registros`}
            href={incompleteHref}
            attention={summary.incompleteRecent > 0}
          />
        </div>
        <p className="mt-2 text-sm text-gray-600">
          {PRESENCE_DISCLAIMER} Las señales son para revisión; no generan sanciones automáticas.
        </p>
      </section>

      <Card>
        <CardHeader title="Accesos rápidos" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLink href="/guardias" title="Guardias" description={guardiasQuickLinkDescription(user.canManage)} />
          <QuickLink href="/en-servicio" title="En servicio" description="Quién está aquí ahora" />
          <QuickLink href="/historial" title="Historial" description="Reportes y exportaciones" />
          {user.canManage ? <QuickLink href="/correcciones" title="Correcciones" description="Solicitudes de corrección de registros" /> : null}
          {user.workerId ? <QuickLink href="/mi-guardia" title="Mi guardia" description="Tu guardia y tus registros de entrada y salida" /> : null}
        </div>
      </Card>
    </div>
  );
}
