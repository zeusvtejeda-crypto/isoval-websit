import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CATALOGS_PATH,
  catalogsHref,
  filterMunicipalities,
  isRepeatedName,
  municipalityFullCode,
  parseCatalogFilters,
  pluralEs,
  repeatedNames,
  stateCode,
  type MunicipalityRow,
} from "@/lib/admin/catalogs";
import { loadStateMunicipalities, loadStatesOverview, type StateOverview } from "@/lib/admin/catalogs-server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState } from "@/components/ui/states";
import { CatalogFiltersForm } from "./_components/catalog-filters";
import { StateCoverageSwitch, StateTimezoneForm } from "./_components/state-forms";
import { MunicipalityTimezoneEditor, NewMunicipalityForm } from "./_components/municipality-forms";

export const metadata: Metadata = { title: "Catálogos geográficos" };

type SearchParams = Record<string, string | string[] | undefined>;

const linkClass = "inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2";

const AUDIT_NOTE = "Los cambios en entidades y municipios quedan en la bitácora (visible solo para administración).";

function StateItem({ state }: { state: StateOverview }) {
  return (
    <li className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,1.6fr)] lg:items-start">
      <div className="min-w-0">
        <p className="font-semibold text-gray-900">
          <span className="font-mono text-gray-600">{stateCode(state.id)}</span> · {state.name}{" "}
          <span className="text-sm font-normal text-gray-500">({state.abbreviation})</span>
        </p>
        <p className="text-sm text-gray-700">
          <Link href={catalogsHref({ stateId: state.id })} className={linkClass}>
            {pluralEs(state.municipalities, "municipio", "municipios")}
          </Link>
          <span className="text-gray-600"> · {pluralEs(state.facilities, "instalación registrada", "instalaciones registradas")}</span>
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-600">Cobertura activa</p>
        <StateCoverageSwitch stateId={state.id} stateName={state.name} enabled={state.enabled} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-600">Zona horaria por omisión</p>
        <StateTimezoneForm stateId={state.id} stateName={state.name} value={state.default_timezone} />
      </div>
    </li>
  );
}

function StatesView({ states }: { states: StateOverview[] }) {
  return (
    <Card>
      <CardHeader
        title="Entidades federativas"
        description="Las entidades con cobertura activa aparecen primero en los formularios de instalaciones y trabajadores. Desactivar la cobertura no oculta ni elimina instalaciones."
      />
      <p className="mb-3 text-sm text-gray-700">
        La zona horaria por omisión se sugiere al registrar instalaciones nuevas en la entidad; las instalaciones ya registradas conservan la suya.
      </p>
      {states.length === 0 ? (
        <EmptyState title="No hay entidades en el catálogo" description="El catálogo se carga con las migraciones de la base de datos." />
      ) : (
        <ul className="divide-y divide-gray-200 rounded-card border border-gray-200" aria-label="Entidades federativas">
          {states.map((s) => (
            <StateItem key={s.id} state={s} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-gray-600">{AUDIT_NOTE}</p>
    </Card>
  );
}

function MunicipalityItem({ m, state, repeated }: { m: MunicipalityRow; state: StateOverview; repeated: boolean }) {
  return (
    <li className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1.2fr)] sm:items-start">
      <p className="font-mono text-lg font-semibold text-gray-900">
        <span className="sr-only">Clave INEGI </span>
        {m.inegi_code}
      </p>
      <div className="min-w-0">
        <p className="font-medium text-gray-900">{m.name}</p>
        <p className="text-xs text-gray-600">Clave geoestadística {municipalityFullCode(m.state_id, m.inegi_code)}</p>
        {repeated ? (
          <Badge tone="info" className="mt-1">
            Nombre repetido en la entidad: distínguelo por la clave {m.inegi_code}
          </Badge>
        ) : null}
      </div>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <p className="text-xs font-medium text-gray-600 sm:sr-only">Zona horaria</p>
        <MunicipalityTimezoneEditor
          stateId={state.id}
          stateTimezone={state.default_timezone}
          municipality={{ id: m.id, name: m.name, inegiCode: m.inegi_code, timezone: m.timezone }}
        />
      </div>
    </li>
  );
}

function MunicipalitiesView({ state, municipalities, q }: { state: StateOverview; municipalities: MunicipalityRow[]; q: string }) {
  const repeated = repeatedNames(municipalities);
  const visible = filterMunicipalities(municipalities, q);
  const ownTz = municipalities.filter((m) => m.timezone).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`${stateCode(state.id)} · ${state.name}`}
          description={`${pluralEs(state.municipalities, "municipio", "municipios")} · ${pluralEs(state.facilities, "instalación registrada", "instalaciones registradas")}.`}
        />
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div>
            <p className="text-xs font-medium text-gray-600">Cobertura activa</p>
            <StateCoverageSwitch stateId={state.id} stateName={state.name} enabled={state.enabled} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-600">Zona horaria por omisión de la entidad</p>
            <StateTimezoneForm stateId={state.id} stateName={state.name} value={state.default_timezone} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Municipios"
          description={
            <>
              {q
                ? `${visible.length} de ${municipalities.length} coinciden con «${q}».`
                : `${pluralEs(municipalities.length, "municipio", "municipios")}, por clave INEGI.`}{" "}
              {ownTz > 0 ? `${pluralEs(ownTz, "tiene", "tienen")} zona horaria propia; el resto usa la de la entidad.` : "Todos usan la zona horaria de la entidad."}
            </>
          }
        />
        {repeated.size > 0 ? (
          <Alert tone="info" title="Hay nombres repetidos" className="mb-3">
            En esta entidad hay municipios oficiales con el mismo nombre. Identifícalos siempre por su clave INEGI.
          </Alert>
        ) : null}
        {municipalities.length === 0 ? (
          <EmptyState title="Esta entidad no tiene municipios" description="Agrega el primero con el formulario de abajo." />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Ningún municipio coincide con la búsqueda"
            description="Busca por nombre (sin importar acentos) o por clave INEGI."
            action={
              <Link href={catalogsHref({ stateId: state.id })} className={linkClass}>
                Ver todos los municipios de {state.name}
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-gray-200 rounded-card border border-gray-200" aria-label={`Municipios de ${state.name}`}>
            {visible.map((m) => (
              <MunicipalityItem key={m.id} m={m} state={state} repeated={isRepeatedName(repeated, m)} />
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-gray-600">
          Cambiar la zona de un municipio solo afecta la sugerencia para instalaciones nuevas; las ya registradas conservan la suya. {AUDIT_NOTE}
        </p>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader
          title={`Agregar municipio a ${state.name}`}
          description="Úsalo solo si el INEGI publica un municipio nuevo. La clave INEGI no se repite dentro de la entidad."
        />
        <NewMunicipalityForm stateId={state.id} stateName={state.name} stateTimezone={state.default_timezone} />
      </Card>
    </div>
  );
}

export default async function CatalogosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const supabase = await createClient();
  const filters = parseCatalogFilters(await searchParams);
  const states = await loadStatesOverview(supabase);
  const selected = filters.stateId ? (states.find((s) => s.id === filters.stateId) ?? null) : null;
  const municipalities = selected ? await loadStateMunicipalities(supabase, selected.id) : [];
  const totalMunicipalities = states.reduce((n, s) => n + s.municipalities, 0);
  const enabledCount = states.filter((s) => s.enabled).length;

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 flex flex-wrap gap-x-4 text-sm">
        <Link href="/administracion" className={linkClass}>
          ← Administración
        </Link>
        {selected ? (
          <Link href={CATALOGS_PATH} className={linkClass}>
            Todas las entidades
          </Link>
        ) : null}
      </nav>
      <PageHeader
        title={selected ? `Municipios de ${selected.name}` : "Catálogos geográficos"}
        description="Entidades federativas y municipios del Marco Geoestadístico del INEGI. Ubican instalaciones y trabajadores y sugieren su zona horaria."
      />

      <div className="space-y-4">
        {filters.stateId && !selected ? (
          <Alert tone="warning" title="Entidad no encontrada">
            La clave {filters.stateId} no corresponde a ninguna entidad del catálogo. Elige otra en la lista.
          </Alert>
        ) : null}

        <p className="text-sm text-gray-700">
          {pluralEs(states.length, "entidad", "entidades")} · {pluralEs(totalMunicipalities, "municipio", "municipios")} ·{" "}
          {pluralEs(enabledCount, "entidad con cobertura activa", "entidades con cobertura activa")}.
        </p>

        <CatalogFiltersForm filters={filters} states={states.map((s) => ({ id: s.id, name: s.name }))} />

        {selected ? <MunicipalitiesView state={selected} municipalities={municipalities} q={filters.q} /> : <StatesView states={states} />}
      </div>
    </>
  );
}
