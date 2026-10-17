import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCategories, getMunicipalities, getStates } from "@/lib/data/catalogs";
import { formatDateTime } from "@/lib/time";
import { FACILITIES_BASE_PATH, firstParam, isUuid, osmLink, servicesToText, todayYmd, type RawSearchParams } from "@/lib/validation/facility";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { FacilityForm, type FacilityFormDefaults } from "../../_components/facility-form";
import { FacilityActiveForm, FacilityDeleteForm } from "../../_components/facility-actions";
import { ActiveBadge, DataKindBadge, PublicBadge, VerificationBadge } from "../../_components/facility-badges";
import { deleteFacility, saveFacility, setFacilityActive } from "../../actions";
import { countFacilityRelations, describeRelations, getFacility } from "../../_lib/queries";

export const metadata = { title: "Editar instalación" };

export default async function EditarInstalacionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const facility = await getFacility(supabase, id);
  if (!facility) notFound();

  const [categories, states, municipalities, relations] = await Promise.all([
    getCategories(supabase),
    getStates(supabase),
    getMunicipalities(supabase),
    countFacilityRelations(supabase, id),
  ]);
  const relationList = describeRelations(relations);
  const saved = firstParam(sp.guardado);

  const defaults: FacilityFormDefaults = {
    official_name: facility.official_name,
    unit_key: facility.unit_key ?? "",
    category_id: String(facility.category_id),
    description: facility.description ?? "",
    state_id: String(facility.state_id),
    municipality_id: facility.municipality_id ? String(facility.municipality_id) : "",
    address: facility.address ?? "",
    latitude: facility.latitude === null ? "" : String(facility.latitude),
    longitude: facility.longitude === null ? "" : String(facility.longitude),
    phone: facility.phone ?? "",
    schedule: facility.schedule ?? "",
    services: servicesToText(facility.services),
    services_verified: facility.services_verified,
    source: facility.source,
    source_url: facility.source_url ?? "",
    last_verified_at: facility.last_verified_at ?? "",
    verification_status: facility.verification_status,
    notes: facility.notes ?? "",
    timezone: facility.timezone,
    arrival_tolerance_minutes: String(facility.arrival_tolerance_minutes),
    is_public: facility.is_public,
    active: facility.active,
    is_demo: facility.is_demo,
  };

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 text-sm">
        <Link href={FACILITIES_BASE_PATH} className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Instalaciones
        </Link>
      </nav>
      <PageHeader title="Editar instalación" description={`${facility.official_name} · ${facility.internal_code}`} />

      <div className="max-w-3xl space-y-4">
        {saved === "alta" ? <Alert tone="success">Instalación registrada. Puedes seguir editándola aquí.</Alert> : null}
        {saved === "cambios" ? <Alert tone="success">Cambios guardados. Quedaron en la bitácora con el motivo indicado.</Alert> : null}

        <Card>
          <div className="flex flex-wrap gap-1.5">
            <ActiveBadge active={facility.active} />
            <VerificationBadge status={facility.verification_status} />
            <DataKindBadge isDemo={facility.is_demo} />
            <PublicBadge isPublic={facility.is_public} active={facility.active} />
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Identificador interno</dt>
              <dd className="font-mono text-gray-900">{facility.internal_code}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Última modificación</dt>
              <dd className="text-gray-900">
                {formatDateTime(facility.updated_at, facility.timezone)} <span className="text-gray-500">(hora de la sede)</span>
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {facility.is_public && facility.active ? (
              <Link href={`/directorio/${facility.id}`} className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
                Ver ficha pública
              </Link>
            ) : (
              <span className="inline-flex min-h-11 items-center text-gray-600">Sin ficha pública (oculta o inactiva)</span>
            )}
            {facility.latitude !== null && facility.longitude !== null ? (
              <a
                href={osmLink(facility.latitude, facility.longitude)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2"
              >
                Ver punto en OpenStreetMap (abre otra pestaña)
              </a>
            ) : null}
          </div>
        </Card>

        <Card>
          <FacilityForm
            key={facility.updated_at}
            action={saveFacility}
            facilityId={facility.id}
            defaults={defaults}
            categories={categories.map((c) => ({ id: c.id, name: c.name, active: c.active }))}
            states={states.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled, default_timezone: s.default_timezone }))}
            municipalities={municipalities.map((m) => ({ id: m.id, state_id: m.state_id, name: m.name, timezone: m.timezone }))}
            today={todayYmd()}
            cancelHref={FACILITIES_BASE_PATH}
          />
        </Card>

        <Card>
          <CardHeader
            title={facility.active ? "Desactivar instalación" : "Reactivar instalación"}
            description={
              facility.active
                ? "Recomendado en lugar de borrar: conserva el historial de guardias y asistencias."
                : "La instalación volverá a estar disponible para nuevas guardias y, si es visible, en el directorio."
            }
          />
          <FacilityActiveForm action={setFacilityActive} facilityId={facility.id} active={facility.active} />
        </Card>

        <Card className="border-red-200">
          <CardHeader title="Eliminar definitivamente" description="Solo es posible si la instalación no tiene ningún registro relacionado." />
          {relationList.length > 0 ? (
            <Alert tone="warning" title="No se puede eliminar">
              Tiene {relationList.join(", ")}. Desactívala en su lugar: el historial se conserva.
            </Alert>
          ) : (
            <FacilityDeleteForm action={deleteFacility} facilityId={facility.id} />
          )}
        </Card>
      </div>
    </>
  );
}
