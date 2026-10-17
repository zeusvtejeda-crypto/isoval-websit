import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageFacility, requireManager } from "@/lib/auth";
import { friendlyDbError } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { getSettingNumber } from "@/lib/data/catalogs";
import { isGuid } from "@/lib/shifts/filters";
import { shiftDisplayTitle, timezoneLabel } from "@/lib/shifts/format";
import { DEFAULT_TIMEZONE, formatDateTime, formatShiftRange } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { QrDisplay } from "@/components/qr/qr-display";
import { issueQrCode } from "./actions";

export const metadata: Metadata = { title: "Código QR de registro" };

type ShiftRow = {
  id: string;
  facility_id: string;
  status: "programada" | "en_curso" | "finalizada" | "cancelada";
  starts_at: string;
  ends_at: string;
  meeting_point: string;
  title: string | null;
  cancel_reason: string | null;
  facility: { official_name: string; timezone: string } | null;
};

export default async function GuardiaQrPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireManager();
  const { id } = await params;
  if (!isGuid(id)) notFound();

  const supabase = await createClient();
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("id, facility_id, status, starts_at, ends_at, meeting_point, title, cancel_reason, facility:facilities!shifts_facility_id_fkey(official_name, timezone)")
    .eq("id", id)
    .maybeSingle<ShiftRow>();
  if (error) throw new Error(friendlyDbError(error, "No se pudo cargar la guardia."));
  if (!shift) notFound();

  const title = shiftDisplayTitle(shift);
  const back = (
    <Link href={`/guardias/${shift.id}`} className={buttonClasses("outline")}>
      Salir de la pantalla del código
    </Link>
  );

  if (!canManageFacility(user, shift.facility_id)) {
    return (
      <>
        <PageHeader title="Código QR de registro" description={title} actions={back} />
        <Alert tone="error" title="Sin permiso para esta sede">
          Solo la coordinación de la sede o administración pueden mostrar el código de registro de esta guardia.
        </Alert>
      </>
    );
  }

  if (shift.status === "cancelada") {
    return (
      <>
        <PageHeader title="Código QR de registro" description={title} actions={back} />
        <Alert tone="error" title="Guardia cancelada">
          No se pueden mostrar códigos de registro de una guardia cancelada.
          {shift.cancel_reason ? ` Motivo: ${shift.cancel_reason}` : ""}
        </Alert>
      </>
    );
  }

  const tz = shift.facility?.timezone ?? DEFAULT_TIMEZONE;
  const [windowBefore, grace] = await Promise.all([
    getSettingNumber(supabase, "attendance", "checkin_window_before_minutes", 120),
    getSettingNumber(supabase, "attendance", "open_session_grace_minutes", 240),
  ]);
  const opensAt = new Date(Date.parse(shift.starts_at) - windowBefore * 60_000);
  const closesAt = new Date(Date.parse(shift.ends_at) + grace * 60_000);
  const windowText = `El código se puede mostrar del ${formatDateTime(opensAt, tz)} al ${formatDateTime(closesAt, tz)} (hora de la sede). Las entradas solo se aceptan hasta el término de la guardia (${formatDateTime(shift.ends_at, tz)}).`;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Código QR de registro"
        description="Muestra esta pantalla en el punto de reunión. Cada persona asignada lo escanea con su teléfono y registra con su propia cuenta."
        actions={back}
      />
      <QrDisplay
        shiftId={shift.id}
        issueAction={issueQrCode}
        details={{
          title,
          facilityName: shift.facility?.official_name ?? "Sede no visible",
          meetingPoint: shift.meeting_point,
          schedule: formatShiftRange(shift.starts_at, shift.ends_at, tz),
          zone: timezoneLabel(tz),
        }}
        windowText={windowText}
      />
      <Alert tone="info" title="Cómo funciona" className="mt-4">
        <p>El código cambia cada pocos minutos y el servidor lo valida al registrar. Una captura o foto deja de servir al caducar.</p>
        <p>Solo pueden usarlo las personas asignadas a esta guardia, con su propia cuenta. El registro queda con método «Código QR».</p>
        <p>{windowText}</p>
      </Alert>
    </div>
  );
}
