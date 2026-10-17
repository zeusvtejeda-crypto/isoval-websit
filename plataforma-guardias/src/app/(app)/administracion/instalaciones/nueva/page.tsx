import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCategories, getMunicipalities, getStates } from "@/lib/data/catalogs";
import {
  DEFAULT_FACILITY_STATE_ID,
  FACILITIES_BASE_PATH,
  TOLERANCE_DEFAULT,
  defaultTimezoneFor,
  todayYmd,
} from "@/lib/validation/facility";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { FacilityForm, type FacilityFormDefaults } from "../_components/facility-form";
import { saveFacility } from "../actions";

export const metadata = { title: "Nueva instalación" };

export default async function NuevaInstalacionPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [categories, states, municipalities] = await Promise.all([getCategories(supabase), getStates(supabase), getMunicipalities(supabase)]);

  const back = (
    <nav aria-label="Ruta" className="mb-2 text-sm">
      <Link href={FACILITIES_BASE_PATH} className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
        ← Instalaciones
      </Link>
    </nav>
  );

  const activeCategories = categories.filter((c) => c.active);
  if (activeCategories.length === 0) {
    return (
      <>
        {back}
        <PageHeader title="Nueva instalación" />
        <EmptyState
          title="No hay categorías activas"
          description="Para registrar una instalación primero crea o activa al menos una categoría."
          action={<LinkButton href="/administracion/categorias">Ir a categorías</LinkButton>}
        />
      </>
    );
  }

  const defaultState = states.find((s) => s.id === DEFAULT_FACILITY_STATE_ID) ?? states.find((s) => s.enabled) ?? states[0];
  const defaults: FacilityFormDefaults = {
    official_name: "",
    unit_key: "",
    category_id: "",
    description: "",
    state_id: defaultState ? String(defaultState.id) : "",
    municipality_id: "",
    address: "",
    latitude: "",
    longitude: "",
    phone: "",
    schedule: "",
    services: "",
    services_verified: false,
    source: "",
    source_url: "",
    last_verified_at: "",
    verification_status: "pendiente",
    notes: "",
    timezone: defaultTimezoneFor(defaultState?.default_timezone),
    arrival_tolerance_minutes: String(TOLERANCE_DEFAULT),
    is_public: true,
    active: true,
    is_demo: false,
  };

  return (
    <>
      {back}
      <PageHeader title="Nueva instalación" description="Los campos con * son obligatorios. La fuente de información es obligatoria." />
      <Card className="max-w-3xl">
        <FacilityForm
          action={saveFacility}
          defaults={defaults}
          categories={categories.map((c) => ({ id: c.id, name: c.name, active: c.active }))}
          states={states.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled, default_timezone: s.default_timezone }))}
          municipalities={municipalities.map((m) => ({ id: m.id, state_id: m.state_id, name: m.name, timezone: m.timezone }))}
          today={todayYmd()}
          cancelHref={FACILITIES_BASE_PATH}
        />
      </Card>
    </>
  );
}
