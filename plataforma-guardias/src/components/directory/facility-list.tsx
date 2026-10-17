import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { buildDirectionsLinks } from "@/lib/directory/directions";
import { hasCoordinates, type LookupMaps } from "@/lib/directory/search";
import type { DirectoryFacility } from "@/lib/directory/types";
import { CategoryTag, DemoBadge, VerificationBadge } from "./facility-badges";

/**
 * Lista de instalaciones. Componente sin estado: se renderiza en el servidor
 * y funciona sin JavaScript y sin el mapa.
 */
export function FacilityList({
  facilities,
  maps,
  onShowOnMap,
}: {
  facilities: DirectoryFacility[];
  maps: LookupMaps;
  /** Si se indica (y el mapa está disponible), agrega el botón «Ver en el mapa». */
  onShowOnMap?: (id: string) => void;
}) {
  return (
    <ul className="space-y-3" aria-label="Instalaciones">
      {facilities.map((f) => (
        <FacilityListItem key={f.id} facility={f} maps={maps} onShowOnMap={onShowOnMap} />
      ))}
    </ul>
  );
}

function FacilityListItem({
  facility: f,
  maps,
  onShowOnMap,
}: {
  facility: DirectoryFacility;
  maps: LookupMaps;
  onShowOnMap?: (id: string) => void;
}) {
  const category = f.categoryId != null ? maps.categories.get(f.categoryId) : undefined;
  const state = f.stateId != null ? maps.states.get(f.stateId) : undefined;
  const municipality = f.municipalityId != null ? maps.municipalities.get(f.municipalityId) : undefined;
  const located = hasCoordinates(f);
  const place = [municipality?.name, state?.name].filter(Boolean).join(", ");
  const directions = buildDirectionsLinks({
    latitude: f.latitude,
    longitude: f.longitude,
    name: f.name,
    address: f.address,
    municipality: municipality?.name,
    state: state?.name,
  });
  const href = `/directorio/${f.id}`;

  return (
    <li className="rounded-card border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold leading-snug text-gray-900">
        <Link href={href} className="text-brand-900 underline-offset-2 hover:underline">
          {f.name}
        </Link>
      </h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <CategoryTag name={category?.name ?? null} color={category?.color} />
        <VerificationBadge verified={f.verified} />
        {f.isDemo ? <DemoBadge /> : null}
      </div>
      <dl className="mt-2 space-y-0.5 text-sm text-gray-800">
        {f.unitKey ? (
          <div>
            <dt className="inline text-gray-600">Clave de unidad: </dt>
            <dd className="inline font-medium">{f.unitKey}</dd>
          </div>
        ) : null}
        {place ? (
          <div>
            <dt className="inline text-gray-600">Municipio y estado: </dt>
            <dd className="inline">{place}</dd>
          </div>
        ) : null}
        {f.address ? (
          <div>
            <dt className="inline text-gray-600">Dirección: </dt>
            <dd className="inline">{f.address}</dd>
          </div>
        ) : null}
      </dl>
      {!located ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700">
          <Badge tone="muted">Sin coordenadas</Badge>
          <span>No aparece en el mapa; solo en esta lista.</span>
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={href} className={buttonClasses("primary", "md")} aria-label={`Ver ficha de ${f.name}`}>
          Ver ficha
        </Link>
        {directions ? (
          <a
            href={directions.google}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses("outline", "md")}
            aria-label={`Cómo llegar a ${f.name} (se abre en otra pestaña)`}
          >
            Cómo llegar
          </a>
        ) : null}
        {onShowOnMap && located ? (
          <button
            type="button"
            onClick={() => onShowOnMap(f.id)}
            className={buttonClasses("ghost", "md")}
            aria-label={`Ver en el mapa: ${f.name}`}
          >
            Ver en el mapa
          </button>
        ) : null}
      </div>
    </li>
  );
}
