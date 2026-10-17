"use client";

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "./facility-map.css";
import L from "./leaflet-setup";
import "leaflet.markercluster";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { buildDirectionsLinks } from "@/lib/directory/directions";
import { markerSvg } from "@/lib/directory/format";
import { mapViewConfig } from "@/lib/directory/map-config";
import { hasCoordinates } from "@/lib/directory/search";
import type { CategoryOption, DirectoryFacility } from "@/lib/directory/types";
import type { FacilityMapProps } from "./map-types";

/** Textos de los controles de Leaflet (por omisión vienen en inglés). */
const MAP_TEXTS = { zoomIn: "Acercar", zoomOut: "Alejar", closePopup: "Cerrar ventana" } as const;

/** Errores de teselas consecutivos (sin una carga correcta entre ellos) para avisar que el fondo no carga. */
const TILE_ERROR_LIMIT = 4;

const MAP_CONFIG = mapViewConfig();

function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  const size = count < 10 ? 38 : count < 100 ? 44 : 52;
  return L.divIcon({
    html: `<span aria-hidden="true">${count}</span><span class="dir-sr">Grupo de ${count} instalaciones; acercar</span>`,
    className: "dir-cluster",
    iconSize: L.point(size, size),
  });
}

function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** Ventana emergente construida con nodos DOM (sin HTML interpolado). */
function buildPopup(
  f: DirectoryFacility,
  category: CategoryOption | undefined,
  showDetailLink: boolean,
  navigate: (href: string) => void,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "dir-popup";

  const title = document.createElement("p");
  title.className = "dir-popup-title";
  title.textContent = f.name;
  root.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "dir-popup-meta";
  meta.textContent = [category?.name ?? "Sin categoría", f.unitKey ? `Clave ${f.unitKey}` : null].filter(Boolean).join(" · ");
  root.appendChild(meta);

  if (f.isDemo) {
    const demo = document.createElement("p");
    demo.className = "dir-popup-meta";
    demo.textContent = "Datos de demostración";
    root.appendChild(demo);
  }

  const actions = document.createElement("div");
  actions.className = "dir-popup-actions";

  if (showDetailLink) {
    const href = `/directorio/${f.id}`;
    const detail = document.createElement("a");
    detail.href = href;
    detail.className = "dir-popup-btn dir-popup-btn-primary";
    detail.textContent = "Ver ficha";
    detail.addEventListener("click", (e) => {
      if (!isPlainClick(e)) return;
      e.preventDefault();
      navigate(href);
    });
    actions.appendChild(detail);
  }

  const directions = buildDirectionsLinks({ latitude: f.latitude, longitude: f.longitude, name: f.name });
  if (directions) {
    const go = document.createElement("a");
    go.href = directions.google;
    go.target = "_blank";
    go.rel = "noopener noreferrer";
    go.className = "dir-popup-btn";
    go.textContent = "Cómo llegar";
    go.setAttribute("aria-label", `Cómo llegar a ${f.name} (se abre en otra pestaña)`);
    actions.appendChild(go);
  }

  root.appendChild(actions);
  return root;
}

function hasSize(el: HTMLElement): boolean {
  return el.clientWidth > 0 && el.clientHeight > 0;
}

/**
 * Mapa de instalaciones con Leaflet y agrupación de marcadores. Se carga solo
 * en el navegador (import dinámico con ssr:false) dentro de un límite de error.
 * Teselas y atribución desde publicEnv.map; la atribución de OpenStreetMap
 * siempre se conserva.
 */
export default function FacilityMap({
  facilities,
  categories,
  label,
  focus = null,
  onReady,
  showDetailLink = true,
  maxFitZoom = 15,
  className,
}: FacilityMapProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const pendingFitRef = useRef<L.LatLngBounds | null>(null);
  const [tilesFailing, setTilesFailing] = useState(false);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const located = useMemo(() => facilities.filter(hasCoordinates), [facilities]);

  const notifyReady = useEffectEvent(() => onReady?.());
  const fitOptions = useEffectEvent((): L.FitBoundsOptions => ({ padding: [36, 36], maxZoom: maxFitZoom }));

  // 1) Crear el mapa una sola vez.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { center, zoom, tileUrl, attribution } = MAP_CONFIG;
    const map = L.map(el, { center, zoom, scrollWheelZoom: false, zoomControl: false });
    L.control.zoom({ zoomInTitle: MAP_TEXTS.zoomIn, zoomOutTitle: MAP_TEXTS.zoomOut }).addTo(map);
    map.attributionControl.setPrefix(
      '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>',
    );

    // Si las teselas no cargan (sin conexión o proveedor caído) se avisa;
    // los marcadores y la lista siguen disponibles.
    let failedTiles = 0;
    let failing = false;
    const tiles = L.tileLayer(tileUrl, { attribution, maxZoom: 19 });
    tiles.on("tileload", () => {
      failedTiles = 0;
      if (failing) {
        failing = false;
        setTilesFailing(false);
      }
    });
    tiles.on("tileerror", () => {
      failedTiles += 1;
      if (!failing && failedTiles >= TILE_ERROR_LIMIT) {
        failing = true;
        setTilesFailing(true);
      }
    });
    tiles.addTo(map);

    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 48,
      disableClusteringAtZoom: 17,
      spiderfyOnMaxZoom: true,
      chunkedLoading: true,
      iconCreateFunction: clusterIcon,
    });
    map.addLayer(cluster);

    // Leaflet escribe «Close popup» en el botón de cerrar: se traduce al abrir.
    const translatePopup = (e: L.PopupEvent) => {
      const close = e.popup.getElement()?.querySelector(".leaflet-popup-close-button");
      if (close) {
        close.setAttribute("aria-label", MAP_TEXTS.closePopup);
        close.setAttribute("title", MAP_TEXTS.closePopup);
      }
    };
    map.on("popupopen", translatePopup);

    // La rueda del ratón solo hace zoom después de interactuar con el mapa.
    const enableWheel = () => map.scrollWheelZoom.enable();
    const disableWheel = () => map.scrollWheelZoom.disable();
    map.on("focus click", enableWheel);
    map.on("blur", disableWheel);

    // El panel puede estar oculto (pestañas en móvil): recalcular al mostrarse.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        map.invalidateSize();
        if (pendingFitRef.current && hasSize(el)) {
          map.fitBounds(pendingFitRef.current, fitOptions());
          pendingFitRef.current = null;
        }
      });
      observer.observe(el);
    }

    mapRef.current = map;
    clusterRef.current = cluster;
    const markers = markersRef.current;
    notifyReady();

    return () => {
      observer?.disconnect();
      map.off("focus click", enableWheel);
      map.off("blur", disableWheel);
      map.off("popupopen", translatePopup);
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      markers.clear();
    };
  }, []);

  // 2) Marcadores según los resultados filtrados.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    const el = containerRef.current;
    if (!map || !cluster || !el) return;

    cluster.clearLayers();
    markersRef.current.clear();
    const navigate = (href: string) => router.push(href);

    const markers = located.map((f) => {
      const category = f.categoryId != null ? categoryById.get(f.categoryId) : undefined;
      const title = category ? `${f.name} (${category.name})` : f.name;
      const marker = L.marker([f.latitude, f.longitude], {
        icon: L.divIcon({
          html: markerSvg(category?.color, title),
          className: "dir-marker",
          iconSize: [32, 42],
          iconAnchor: [16, 41],
          popupAnchor: [0, -36],
        }),
        title,
        keyboard: true,
        riseOnHover: true,
      });
      marker.bindPopup(() => buildPopup(f, category, showDetailLink, navigate), { maxWidth: 300, minWidth: 200 });
      markersRef.current.set(f.id, marker);
      return marker;
    });
    cluster.addLayers(markers);

    if (markers.length === 0) {
      pendingFitRef.current = null;
      map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
      return;
    }
    const bounds = L.latLngBounds(markers.map((m) => m.getLatLng()));
    if (hasSize(el)) {
      map.invalidateSize();
      map.fitBounds(bounds, fitOptions());
      pendingFitRef.current = null;
    } else {
      pendingFitRef.current = bounds;
    }
  }, [located, categoryById, showDetailLink, router]);

  // 3) Centrar una instalación pedida desde la lista.
  useEffect(() => {
    if (!focus) return;
    const map = mapRef.current;
    const cluster = clusterRef.current;
    const marker = markersRef.current.get(focus.id);
    if (!map || !cluster || !marker) return;
    map.invalidateSize();
    pendingFitRef.current = null;
    cluster.zoomToShowLayer(marker, () => marker.openPopup());
  }, [focus]);

  return (
    <div className={cn("relative overflow-hidden rounded-card border border-gray-200 bg-gray-100", className)}>
      <div ref={containerRef} role="region" aria-label={label} className="dir-map h-full w-full" />
      {tilesFailing ? (
        <div role="status" className="absolute inset-x-2 top-2 z-[1000] rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 shadow">
          No se pudieron cargar las imágenes del mapa. Los marcadores siguen visibles y la lista está disponible.
        </div>
      ) : null}
      {located.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center p-4">
          <p className="pointer-events-auto max-w-xs rounded-xl bg-white/95 px-4 py-3 text-center text-sm font-medium text-gray-800 shadow ring-1 ring-gray-200">
            {facilities.length === 0
              ? "No hay instalaciones que mostrar en el mapa con estos filtros."
              : "Ninguna de las instalaciones encontradas tiene coordenadas; consúltalas en la lista."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
