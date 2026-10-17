import type { CategoryOption, DirectoryFacility } from "@/lib/directory/types";

/** Solicitud para centrar el mapa en una instalación (seq permite repetirla). */
export type MapFocusRequest = { id: string; seq: number };

export type FacilityMapProps = {
  /** Instalaciones a mostrar; las que no tienen coordenadas se ignoran. */
  facilities: DirectoryFacility[];
  categories: CategoryOption[];
  /** Nombre accesible de la región del mapa. */
  label: string;
  focus?: MapFocusRequest | null;
  /** Se llama cuando el mapa quedó listo. */
  onReady?: () => void;
  /** Enlace «Ver ficha» en la ventana emergente (no aplica dentro de la ficha). */
  showDetailLink?: boolean;
  /** Zoom máximo al encuadrar los resultados. */
  maxFitZoom?: number;
  className?: string;
};
