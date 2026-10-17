import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_STATE_ID, firstParam, type RawSearchParams } from "@/lib/validation/worker";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { WorkerForm, type WorkerFormDefaults } from "../_components/worker-form";
import { saveWorker } from "../actions";
import { getWorkerFormCatalogs } from "../_lib/queries";

export const metadata = { title: "Nuevo trabajador" };

export default async function NuevoTrabajadorPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireManager();
  const supabase = await createClient();
  const sp = await searchParams;
  const { states, municipalities, facilities } = await getWorkerFormCatalogs(supabase, user);

  if (!user.isAdmin && facilities.length === 0) {
    return (
      <>
        <PageHeader title="Nuevo trabajador" />
        <EmptyState
          title="Sin sedes asignadas"
          description="Para registrar trabajadores necesitas al menos una sede asignada. Pide a administración que te asigne una."
        />
      </>
    );
  }

  const requested = firstParam(sp.sede);
  const preselected = facilities.find((f) => f.id === requested) ?? (!user.isAdmin && facilities.length === 1 ? facilities[0] : undefined);
  const defaultState = states.some((s) => s.id === DEFAULT_STATE_ID) ? DEFAULT_STATE_ID : (states[0]?.id ?? DEFAULT_STATE_ID);
  const stateId = preselected?.state_id ?? defaultState;

  const defaults: WorkerFormDefaults = {
    full_name: "",
    state_id: String(stateId),
    municipality_id: "",
    facility_id: preselected?.id ?? "",
    area: "",
    position: "",
    usual_shift: "",
    active: true,
    employee_number: "",
    phone: "",
  };

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 text-sm">
        <Link href="/trabajadores" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Trabajadores
        </Link>
      </nav>
      <PageHeader title="Nuevo trabajador" description="Registro en el directorio privado. Los campos con * son obligatorios." />
      <Card className="max-w-3xl">
        <WorkerForm
          action={saveWorker}
          defaults={defaults}
          states={states.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }))}
          municipalities={municipalities.map((m) => ({ id: m.id, state_id: m.state_id, name: m.name }))}
          facilities={facilities.map((f) => ({ id: f.id, official_name: f.official_name }))}
          allowNoFacility={user.isAdmin}
          showPrivate
          cancelHref="/trabajadores"
        />
      </Card>
    </>
  );
}
