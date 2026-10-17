import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadMyShifts } from "@/lib/presence/my-shifts";
import { checkInBlockText, registrableViews } from "@/lib/presence/worker";
import { NOT_LINKED_MESSAGE } from "@/lib/presence/texts";
import { DEFAULT_TIMEZONE, formatShiftRange } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses, LinkButton } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { AttendanceButtons } from "@/components/attendance/attendance-buttons";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { LastUpdated } from "@/components/layout/connection-status";
import { buttonsPropsFor, myShiftStatus } from "@/components/attendance/my-shift";

export const metadata: Metadata = { title: "Registrar entrada o salida" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RegistroPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();

  if (!user.workerId) {
    return (
      <>
        <PageHeader title="Registrar entrada o salida" />
        <Alert tone="warning" title="Cuenta sin vincular">
          {NOT_LINKED_MESSAGE}
        </Alert>
      </>
    );
  }

  const sp = await searchParams;
  const wanted = typeof sp.asignacion === "string" ? sp.asignacion : null;

  const supabase = await createClient();
  const { views, loadedAt } = await loadMyShifts(supabase, user.workerId);
  const candidates = registrableViews(views);
  const selected = candidates.find((v) => v.row.assignment_id === wanted) ?? candidates[0] ?? null;
  const others = candidates.filter((v) => v.row.assignment_id !== selected?.row.assignment_id);
  const next = selected ? null : (views.find((v) => v.active && v.timing === "proxima") ?? null);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Registrar entrada o salida"
        description="La hora que cuenta es la del servidor al recibir tu registro, no la de tu teléfono."
      />
      <LastUpdated at={loadedAt.toISOString()} timeZone={(selected ?? next)?.row.facility_timezone ?? DEFAULT_TIMEZONE} />

      <Card>
        {selected ? (
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={myShiftStatus(selected).tone}>{myShiftStatus(selected).label}</Badge>
            </div>
            <h2 className="mt-2 text-xl font-bold text-gray-900">{selected.row.facility_name}</h2>
            <p className="text-lg text-gray-800">{formatShiftRange(selected.row.starts_at, selected.row.ends_at, selected.row.facility_timezone)}</p>
            <p className="text-gray-700">
              Punto de reunión: {selected.row.meeting_point}
              {selected.row.assigned_point ? ` · Punto asignado: ${selected.row.assigned_point}` : ""}
            </p>
            <p className="text-sm text-gray-500">Hora de la sede ({selected.row.facility_timezone})</p>
          </div>
        ) : (
          <div className="mb-4 space-y-3">
            <EmptyState
              title="No hay guardias abiertas para registro en este momento"
              description={
                next
                  ? `Tu próxima guardia: ${next.row.facility_name} · ${formatShiftRange(next.row.starts_at, next.row.ends_at, next.row.facility_timezone)}. ${checkInBlockText(next) ?? ""}`
                  : "No tienes guardias en curso ni próximas en los siguientes 14 días."
              }
              action={
                <LinkButton href="/mi-guardia" variant="outline">
                  Ver mi guardia
                </LinkButton>
              }
            />
          </div>
        )}
        {/* Posición fija: el resultado del último envío se conserva tras actualizar la página. */}
        <AttendanceButtons {...buttonsPropsFor(selected)} />
      </Card>

      {/* Registro con código QR (opcional): el código lo muestra coordinación en el punto de reunión. */}
      <Alert tone="info" title="¿Te mostraron un código QR? Escanéalo con la cámara de tu teléfono">
        Se abrirá la página para registrar con el código de tu guardia.{" "}
        <Link href="/registro/qr" className="font-semibold underline">
          Cómo funciona
        </Link>
        . El código QR no prueba presencia física.
      </Alert>

      {others.length ? (
        <Card>
          <CardHeader title="Otras guardias disponibles para registrar" description="Elige la guardia correcta antes de registrar." />
          <ul className="divide-y divide-gray-100">
            {others.map((v) => (
              <li key={v.row.assignment_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{v.row.facility_name}</p>
                  <p className="text-gray-700">{formatShiftRange(v.row.starts_at, v.row.ends_at, v.row.facility_timezone)}</p>
                  <p className="text-sm text-gray-600">Punto de reunión: {v.row.meeting_point}</p>
                </div>
                <Link href={`/registro?asignacion=${encodeURIComponent(v.row.assignment_id)}`} className={buttonClasses("outline", "lg")}>
                  Elegir esta guardia
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
