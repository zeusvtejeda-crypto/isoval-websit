import L from "leaflet";

/*
 * leaflet.markercluster extiende el objeto global «L». Leaflet ya lo define al
 * cargarse, pero se asegura aquí antes de importar el complemento.
 */
if (typeof window !== "undefined") {
  const w = window as unknown as { L?: typeof L };
  if (!w.L) w.L = L;
}

export default L;
