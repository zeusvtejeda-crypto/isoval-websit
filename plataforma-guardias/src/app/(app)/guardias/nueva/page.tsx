import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInTz } from "@/lib/time";
import { isValidDay } from "@/lib/shifts/dates";
import { firstParam, type RawSearchParams } from "@/lib/shifts/filters";
import { getActiveWorkersOfFacility, getManageableFacilities } from "@/lib/shifts/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { buttonClasses } from "@/components/ui/button";
import { FacilityPicker } from "@/components/shifts/facility-picker";
import { ShiftForm } from "@/components/shifts/shift-form";
import { saveShift } from "../actions";

export const metadata = { title: "Nueva guardia" };

export default async function NuevaGuardiaPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireManager();
  const supabase = await createClient();
  const facilities = await getManageableFacilities(supabase, user);
  const sp = await searchParams;
  const rawDate = firstParam(sp.fecha);
  const requestedDate = isValidDay(rawDate) ? rawDate : null;

  if (facilities.length === 0) {
    return (
      <>
        <PageHeader title="Nueva guardia" />
        <EmptyState
          title="No tienes sedes para programar"
          description="Tu cuenta no tiene sedes asignadas con permiso de gestión. Pide a administración que te asigne una sede."
          action={
            <Link href="/guardias" className={buttonClasses("outline")}>
              Volver a guardias
            </Link>
          }
        />
      </>
    );
  }

  const requested = facilities.find((f) => f.id === firstParam(sp.sede)) ?? null;
  const facility = firstParam(sp.cambiar_sede) === "1" ? null : (requested ?? (facilities.length === 1 ? facilities[0] : null));

  if (!facility) {
    return (
      <>
        <PageHeader title="Nueva guardia" description="Paso 1 de 2: elige la sede de la guardia." />
        <FacilityPicker
          action="/guardias/nueva"
          facilities={facilities}
          selectedId={requested?.id}
          cancelHref="/guardias"
          keep={requestedDate ? { fecha: requestedDate } : {}}
        />
      </>
    );
  }

  const workers = await getActiveWorkersOfFacility(supabase, facility.id);
  const changeParams = new URLSearchParams({ cambiar_sede: "1", sede: facility.id });
  if (requestedDate) changeParams.set("fecha", requestedDate);

  return (
    <>
      <PageHeader title="Nueva guardia" description={facilities.length > 1 ? "Paso 2 de 2: datos de la guardia." : "Datos de la guardia."} />
      <Card>
        <ShiftForm
          action={saveShift}
          facility={{ id: facility.id, official_name: facility.official_name, timezone: facility.timezone }}
          workers={workers}
          defaults={{
            title: "",
            meeting_point: "",
            date: requestedDate ?? todayInTz(facility.timezone),
            start_time: "08:00",
            end_time: "14:00",
            responsible_worker_id: "",
            min_staff: "1",
            max_staff: "",
            instructions: "",
          }}
          cancelHref="/guardias"
          changeFacilityHref={facilities.length > 1 ? `/guardias/nueva?${changeParams.toString()}` : null}
        />
      </Card>
    </>
  );
}
