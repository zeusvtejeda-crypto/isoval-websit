"use client";

import { useMemo } from "react";
import type { CategoryOption, DirectoryFacility } from "@/lib/directory/types";
import { MapNoScript, MapPanel } from "./map-panel";

/** Mapa pequeño de la ficha (una sola instalación). Si falla, la ficha sigue completa. */
export function FacilityMiniMap({ facility, category }: { facility: DirectoryFacility; category: CategoryOption | null }) {
  const facilities = useMemo(() => [facility], [facility]);
  const categories = useMemo(() => (category ? [category] : []), [category]);
  return (
    <>
      <MapNoScript />
      <MapPanel
        facilities={facilities}
        categories={categories}
        label={`Mapa con la ubicación de ${facility.name}`}
        showDetailLink={false}
        maxFitZoom={16}
        className="h-72"
      />
    </>
  );
}
