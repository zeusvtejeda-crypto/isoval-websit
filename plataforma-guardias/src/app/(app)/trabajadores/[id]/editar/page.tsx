import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageFacility, requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid, matchUsualShift } from "@/lib/validation/worker";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { WorkerForm, type WorkerFormDefaults } from "../../_components/worker-form";
import { saveWorker } from "../../actions";
import { getWorkerDetail, getWorkerFormCatalogs, getWorkerPrivate } from "../../_lib/queries";

export const metadata = { title: "Editar trabajador" };

export default async function EditarTrabajadorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireManager();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const worker = await getWorkerDetail(supabase, id);
  if (!worker) notFound();

  const back = (
    <nav aria-label="Ruta" className="mb-2 text-sm">
      <Link href={`/trabajadores/${worker.id}`} className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
        ← Ficha de {worker.full_name}
      </Link>
    </nav>
  );

  if (!canManageFacility(user, worker.facility_id)) {
    return (
      <>
        {back}
        <PageHeader title="Editar trabajador" />
        <EmptyState
          title="No puedes editar este registro"
          description="Solo administración y la coordinación de la sede de adscripción pueden modificarlo."
          action={<LinkButton href={`/trabajadores/${worker.id}`}>Volver a la ficha</LinkButton>}
        />
      </>
    );
  }

  const currentFacility = worker.facility
    ? {
        id: worker.facility.id,
        official_name: worker.facility.active ? worker.facility.official_name : `${worker.facility.official_name} (inactiva)`,
        timezone: worker.facility.timezone,
        state_id: worker.facility.state_id,
        municipality_id: worker.facility.municipality_id,
        is_demo: worker.facility.is_demo,
      }
    : null;
  const [privateData, catalogs] = await Promise.all([getWorkerPrivate(supabase, id), getWorkerFormCatalogs(supabase, user, currentFacility)]);

  const defaults: WorkerFormDefaults = {
    full_name: worker.full_name,
    state_id: String(worker.state_id),
    municipality_id: worker.municipality_id ? String(worker.municipality_id) : "",
    facility_id: worker.facility_id ?? "",
    area: worker.area ?? "",
    position: worker.position ?? "",
    usual_shift: matchUsualShift(worker.usual_shift) ?? worker.usual_shift ?? "",
    active: worker.active,
    employee_number: privateData?.employee_number ?? "",
    phone: privateData?.phone ?? "",
  };

  return (
    <>
      {back}
      <PageHeader title="Editar trabajador" description={`${worker.full_name} · ${worker.internal_code}`} />
      <div className="max-w-3xl space-y-4">
        <Card>
          <WorkerForm
            action={saveWorker}
            workerId={worker.id}
            defaults={defaults}
            states={catalogs.states.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }))}
            municipalities={catalogs.municipalities.map((m) => ({ id: m.id, state_id: m.state_id, name: m.name }))}
            facilities={catalogs.facilities.map((f) => ({ id: f.id, official_name: f.official_name }))}
            allFacilities={user.isAdmin}
            showPrivate
            cancelHref={`/trabajadores/${worker.id}`}
          />
        </Card>
      </div>
    </>
  );
}
