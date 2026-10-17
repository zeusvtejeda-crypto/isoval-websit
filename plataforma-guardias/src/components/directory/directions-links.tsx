import { buttonClasses } from "@/components/ui/button";
import { buildDirectionsLinks, type DirectionsTarget } from "@/lib/directory/directions";

/**
 * Botones «Cómo llegar»: Google Maps, app de mapas del teléfono (geo:) y
 * OpenStreetMap. Sin coordenadas se busca por la dirección.
 */
export function DirectionsLinks({ target }: { target: DirectionsTarget }) {
  const links = buildDirectionsLinks(target);
  if (!links) {
    return <p className="text-gray-700">No hay coordenadas ni dirección registradas para calcular la ruta.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
        <a href={links.google} target="_blank" rel="noopener noreferrer" className={buttonClasses("primary", "lg", "text-center")}>
          Cómo llegar (Google Maps)
        </a>
        <a href={links.geo} className={buttonClasses("outline", "lg", "text-center")}>
          Abrir en app de mapas (Android)
        </a>
        <a href={links.openStreetMap} target="_blank" rel="noopener noreferrer" className={buttonClasses("outline", "lg", "text-center")}>
          Ruta en OpenStreetMap
        </a>
      </div>
      <p className="text-sm text-gray-600">
        {links.byCoordinates
          ? "La ruta se calcula hacia las coordenadas registradas. «Abrir en app de mapas» funciona en teléfonos Android."
          : "Esta instalación no tiene coordenadas: la app de mapas buscará la dirección registrada, que puede ser imprecisa."}{" "}
        La plataforma no solicita ni guarda tu ubicación.
      </p>
    </div>
  );
}
