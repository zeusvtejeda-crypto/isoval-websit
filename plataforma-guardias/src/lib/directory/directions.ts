/**
 * Enlaces de «Cómo llegar». No se usa la ubicación del usuario: la app de mapas
 * elegida calcula la ruta desde donde la persona decida.
 */
export type DirectionsTarget = {
  latitude: number | null;
  longitude: number | null;
  name?: string | null;
  address?: string | null;
  municipality?: string | null;
  state?: string | null;
};

export type DirectionsLinks = {
  /** true si se usan coordenadas; false si se busca por dirección. */
  byCoordinates: boolean;
  google: string;
  /** Esquema geo: (abre la app de mapas en Android). */
  geo: string;
  openStreetMap: string;
};

/** Coordenada con máximo 6 decimales y sin ceros sobrantes: 21.509000 → "21.509". */
export function formatCoordinate(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** "21.509, -104.889" */
export function formatCoordinates(latitude: number, longitude: number): string {
  return `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`;
}

function validCoordinates(lat: number | null, lng: number | null): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/**
 * Texto de búsqueda cuando no hay coordenadas: dirección, municipio y estado
 * (o el nombre si no hay dirección), más «México».
 */
export function directionsQuery(target: DirectionsTarget): string | null {
  const address = target.address?.trim();
  const place = [target.municipality?.trim(), target.state?.trim()].filter((p): p is string => Boolean(p));
  const head = address || target.name?.trim();
  if (!head) return null;
  const lowerHead = head.toLowerCase();
  const parts = [head, ...place.filter((p) => !lowerHead.includes(p.toLowerCase()))];
  return [...parts, "México"].join(", ");
}

/** URLs para Google Maps, la app de mapas (geo:) y OpenStreetMap; null si no hay datos. */
export function buildDirectionsLinks(target: DirectionsTarget): DirectionsLinks | null {
  if (validCoordinates(target.latitude, target.longitude)) {
    const lat = formatCoordinate(target.latitude);
    const lng = formatCoordinate(target.longitude as number);
    const label = target.name?.trim();
    return {
      byCoordinates: true,
      google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
      geo: `geo:${lat},${lng}${label ? `?q=${lat},${lng}(${encodeURIComponent(label)})` : ""}`,
      openStreetMap: `https://www.openstreetmap.org/directions?to=${lat},${lng}`,
    };
  }
  const query = directionsQuery(target);
  if (!query) return null;
  const encoded = encodeURIComponent(query);
  return {
    byCoordinates: false,
    google: `https://www.google.com/maps/dir/?api=1&destination=${encoded}`,
    geo: `geo:0,0?q=${encoded}`,
    openStreetMap: `https://www.openstreetmap.org/search?query=${encoded}`,
  };
}
