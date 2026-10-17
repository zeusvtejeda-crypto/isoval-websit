"use client";

import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { DemoBanner } from "@/components/layout/disclaimer";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import {
  DIRECTORY_PATH,
  EMPTY_FILTERS,
  LIST_STEP,
  directoryHref,
  hasActiveFilters,
  parseDirectoryParams,
  pluralize,
  reconcileFilters,
} from "@/lib/directory/params";
import {
  buildLookupMaps,
  buildSearchIndex,
  filterFacilities,
  hasCoordinates,
  mapLegend,
  municipalitiesForState,
} from "@/lib/directory/search";
import type { DirectoryFacility, DirectoryFilters, DirectoryLookups, DirectoryParams, DirectoryView } from "@/lib/directory/types";
import { CategoryTag } from "./facility-badges";
import { FacilityList } from "./facility-list";
import { MapNoScript, MapPanel, MapPlaceholder } from "./map-panel";
import type { MapFocusRequest } from "./map-types";

type ExplorerState = { filters: DirectoryFilters; view: DirectoryView; limit: number };

const VIEWS: Array<{ id: DirectoryView; label: string }> = [
  { id: "lista", label: "Lista" },
  { id: "mapa", label: "Mapa" },
];

const LABEL = "mb-1 block text-sm font-medium text-gray-800";
const MAP_SIZE = "h-[60dvh] min-h-80 lg:h-[calc(100dvh-2rem)] lg:max-h-[56rem]";
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}
const isDesktopNow = () => typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_QUERY).matches;
const noopSubscribe = () => () => {};

function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function stateFromParams(params: DirectoryParams, lookups: DirectoryLookups): ExplorerState {
  return {
    filters: reconcileFilters(params, lookups),
    view: params.vista,
    limit: Math.max(LIST_STEP, params.limite ?? LIST_STEP),
  };
}

/**
 * Estado inicial. Se lee de la URL del enrutador (useSearchParams): coincide con
 * la del servidor al hidratar y, al volver con «Atrás», trae los filtros más
 * recientes (escritos con history.replaceState) aunque la página venga de caché.
 * window.location no sirve aquí: en una navegación del cliente todavía tiene la
 * URL anterior durante el render.
 */
function initialState(
  routerParams: URLSearchParams | null,
  initial: DirectoryParams,
  lookups: DirectoryLookups,
): ExplorerState {
  return stateFromParams(routerParams ? parseDirectoryParams(routerParams) : initial, lookups);
}

export type DirectoryExplorerProps = {
  facilities: DirectoryFacility[];
  lookups: DirectoryLookups;
  initialParams: DirectoryParams;
};

/**
 * Búsqueda, filtros, lista y mapa del directorio público.
 * - Se renderiza en el servidor con los filtros de la URL: sin JavaScript el
 *   formulario GET, las pestañas y «Mostrar más» funcionan como enlaces.
 * - Con JavaScript filtra al instante y mantiene los filtros en la URL.
 * - La página le pasa una `key` distinta en cada render del servidor: una
 *   navegación real a /directorio (p. ej. el enlace «Directorio» del encabezado)
 *   reinicia los filtros en lugar de conservar los anteriores.
 */
export function DirectoryExplorer({ facilities, lookups, initialParams }: DirectoryExplorerProps) {
  const maps = useMemo(() => buildLookupMaps(lookups), [lookups]);
  const index = useMemo(() => buildSearchIndex(facilities, maps), [facilities, maps]);

  const routerParams = useSearchParams();
  const [state, setState] = useState<ExplorerState>(() => initialState(routerParams, initialParams, lookups));
  const [mapActivated, setMapActivated] = useState(() => state.view === "mapa");
  const [mapFailed, setMapFailed] = useState(false);
  const [focus, setFocus] = useState<MapFocusRequest | null>(null);
  const isDesktop = useSyncExternalStore(subscribeDesktop, isDesktopNow, () => false);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const resultsRef = useRef<HTMLParagraphElement>(null);
  const mapPanelRef = useRef<HTMLElement>(null);

  const { filters, view, limit } = state;
  const deferredFilters = useDeferredValue(filters);
  const results = useMemo(() => filterFacilities(index, deferredFilters), [index, deferredFilters]);
  const visible = results.slice(0, limit);
  const withoutCoords = useMemo(() => results.filter((f) => !hasCoordinates(f)).length, [results]);
  const legend = useMemo(() => mapLegend(results, maps.categories), [results, maps]);
  const showDemo = results.some((f) => f.isDemo);
  const active = hasActiveFilters(filters);
  const updating = deferredFilters !== filters;
  const mountMap = mapActivated || isDesktop;

  const categoryOptions = lookups.categories.filter((c) => c.active || c.slug === filters.categoria);
  const municipalityOptions = municipalitiesForState(lookups.municipalities, filters.estado);
  const groupMunicipalities = filters.estado == null && lookups.states.length > 1;

  function commit(next: ExplorerState) {
    setState(next);
    try {
      window.history.replaceState(null, "", directoryHref(next.filters, { vista: next.view, limite: next.limit }));
    } catch {
      // Si el navegador bloquea el historial, el filtrado sigue funcionando.
    }
  }

  function setFilters(patch: Partial<DirectoryFilters>) {
    commit({ ...state, filters: { ...filters, ...patch }, limit: LIST_STEP });
  }

  function onStateChange(value: string) {
    const estado = value ? Number(value) : null;
    const keep =
      filters.municipio != null && lookups.municipalities.some((m) => m.id === filters.municipio && m.stateId === estado);
    setFilters({ estado, municipio: keep ? filters.municipio : null });
  }

  function onMunicipalityChange(value: string) {
    const municipio = value ? Number(value) : null;
    const m = municipio != null ? lookups.municipalities.find((x) => x.id === municipio) : undefined;
    setFilters({ municipio, estado: m ? m.stateId : filters.estado });
  }

  function selectView(next: DirectoryView) {
    if (next === "mapa") setMapActivated(true);
    commit({ ...state, view: next });
  }

  function onTabClick(e: MouseEvent<HTMLAnchorElement>, next: DirectoryView) {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    selectView(next);
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLAnchorElement>) {
    let next: DirectoryView | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") next = view === "lista" ? "mapa" : "lista";
    else if (e.key === "Home") next = "lista";
    else if (e.key === "End") next = "mapa";
    if (!next) return;
    e.preventDefault();
    selectView(next);
    document.getElementById(`dir-tab-${next}`)?.focus();
  }

  function clearFilters(e: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    commit({ ...state, filters: EMPTY_FILTERS, limit: LIST_STEP });
    document.getElementById("dir-q")?.focus();
  }

  function showMore(e: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    commit({ ...state, limit: limit + LIST_STEP });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    // Con JavaScript el filtrado ya ocurrió: se lleva el foco al contador
    // (o, en la vista de mapa del teléfono, solo se oculta el teclado).
    e.preventDefault();
    if (view === "lista" || isDesktop) resultsRef.current?.focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  function showOnMap(id: string) {
    setMapActivated(true);
    setFocus((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
    if (isDesktop) mapPanelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    else commit({ ...state, view: "mapa" });
  }

  const countText = active
    ? pluralize(results.length, "instalación encontrada", "instalaciones encontradas")
    : pluralize(results.length, "instalación en el directorio", "instalaciones en el directorio");
  const notes: string[] = [];
  if (results.length > visible.length) notes.push(`Se muestran ${visible.length.toLocaleString("es-MX")} en la lista.`);
  if (withoutCoords > 0) {
    notes.push(
      withoutCoords === 1
        ? "1 no tiene coordenadas y aparece solo en la lista."
        : `${withoutCoords.toLocaleString("es-MX")} no tienen coordenadas y aparecen solo en la lista.`,
    );
  }

  return (
    <div className="space-y-4">
      {showDemo ? <DemoBanner /> : null}

      <form
        method="get"
        action={DIRECTORY_PATH}
        role="search"
        aria-label="Buscar instalaciones"
        onSubmit={onSubmit}
        className="rounded-card border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="sm:col-span-2 xl:col-span-1">
            <label htmlFor="dir-q" className={LABEL}>
              Buscar
            </label>
            <Input
              id="dir-q"
              name="q"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              maxLength={120}
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Nombre, clave, municipio, estado o dirección"
              aria-describedby="dir-q-hint"
            />
            <p id="dir-q-hint" className="mt-1 text-xs text-gray-500">
              No importan acentos ni mayúsculas.
            </p>
          </div>
          <div>
            <label htmlFor="dir-categoria" className={LABEL}>
              Categoría
            </label>
            <Select id="dir-categoria" name="categoria" value={filters.categoria} onChange={(e) => setFilters({ categoria: e.target.value })}>
              <option value="">Todas las categorías</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="dir-estado" className={LABEL}>
              Estado
            </label>
            <Select id="dir-estado" name="estado" value={filters.estado ?? ""} onChange={(e) => onStateChange(e.target.value)}>
              <option value="">Todos los estados</option>
              {lookups.states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="dir-municipio" className={LABEL}>
              Municipio
            </label>
            <Select
              id="dir-municipio"
              name="municipio"
              value={filters.municipio ?? ""}
              onChange={(e) => onMunicipalityChange(e.target.value)}
              aria-describedby="dir-municipio-hint"
            >
              <option value="">{filters.estado == null ? "Todos los municipios" : "Todos los del estado"}</option>
              {groupMunicipalities
                ? lookups.states.map((s) => (
                    <optgroup key={s.id} label={s.name}>
                      {municipalitiesForState(lookups.municipalities, s.id).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : municipalityOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
            </Select>
            <p id="dir-municipio-hint" className="mt-1 text-xs text-gray-500">
              Solo municipios con instalaciones registradas.
            </p>
          </div>
        </div>
        {view === "mapa" ? <input type="hidden" name="vista" value="mapa" /> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit">Buscar</Button>
          {active ? (
            <a href={directoryHref(EMPTY_FILTERS, { vista: view })} onClick={clearFilters} className={buttonClasses("outline")}>
              Quitar filtros
            </a>
          ) : null}
        </div>
      </form>

      <div role="tablist" aria-label="Forma de ver el directorio" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-200/70 p-1 lg:hidden">
        {VIEWS.map((v) => (
          <a
            key={v.id}
            id={`dir-tab-${v.id}`}
            role="tab"
            href={directoryHref(filters, { vista: v.id, limite: limit })}
            aria-selected={view === v.id}
            aria-controls={`dir-panel-${v.id}`}
            // Con JavaScript: foco itinerante (flechas). Sin JavaScript ambas
            // pestañas son enlaces normales y deben poder enfocarse.
            tabIndex={hydrated ? (view === v.id ? 0 : -1) : undefined}
            onClick={(e) => onTabClick(e, v.id)}
            onKeyDown={onTabKeyDown}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-lg px-3 font-semibold",
              view === v.id ? "bg-white text-brand-900 shadow-sm" : "text-gray-700 hover:bg-white/60",
            )}
          >
            {v.id === "lista" ? `${v.label} (${results.length.toLocaleString("es-MX")})` : v.label}
          </a>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <section
          id="dir-panel-lista"
          role="tabpanel"
          aria-labelledby="dir-tab-lista"
          className={cn(view === "lista" ? "block" : "hidden", "space-y-3 lg:block")}
        >
          <h2 className="sr-only">Lista de instalaciones</h2>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p
              id="resultados"
              ref={resultsRef}
              tabIndex={-1}
              role="status"
              aria-live="polite"
              className="text-lg font-semibold text-gray-900 focus:outline-none"
            >
              {countText}
            </p>
            {updating ? <span className="text-sm text-gray-500">Actualizando…</span> : null}
          </div>
          {notes.length > 0 ? <p className="text-sm text-gray-600">{notes.join(" ")}</p> : null}

          {results.length === 0 ? (
            <EmptyState
              title="No encontramos instalaciones"
              description={
                active
                  ? "Prueba con otras palabras o quita algunos filtros. La búsqueda no distingue acentos ni mayúsculas."
                  : "Todavía no hay instalaciones publicadas en el directorio."
              }
              action={
                active ? (
                  <a href={directoryHref(EMPTY_FILTERS, { vista: view })} onClick={clearFilters} className={buttonClasses("primary")}>
                    Quitar filtros
                  </a>
                ) : undefined
              }
            />
          ) : (
            <FacilityList facilities={visible} maps={maps} onShowOnMap={hydrated && !mapFailed ? showOnMap : undefined} />
          )}

          {results.length > visible.length ? (
            <a
              href={directoryHref(filters, { vista: view, limite: limit + LIST_STEP })}
              onClick={showMore}
              className={buttonClasses("outline", "lg", "w-full")}
            >
              Mostrar más resultados ({(results.length - visible.length).toLocaleString("es-MX")} restantes)
            </a>
          ) : null}
        </section>

        <section
          id="dir-panel-mapa"
          ref={mapPanelRef}
          role="tabpanel"
          aria-labelledby="dir-tab-mapa"
          className={cn(view === "mapa" ? "block" : "hidden", "lg:sticky lg:top-4 lg:block")}
        >
          <h2 className="sr-only">Mapa de instalaciones</h2>
          <MapNoScript />
          {mountMap ? (
            <MapPanel
              facilities={results}
              categories={lookups.categories}
              label="Mapa de las instalaciones encontradas"
              focus={focus}
              onError={() => setMapFailed(true)}
              onReset={() => setMapFailed(false)}
              className={MAP_SIZE}
            />
          ) : (
            <MapPlaceholder className={MAP_SIZE} text={hydrated ? "Cargando mapa…" : "El mapa se muestra al abrir esta vista."} />
          )}
          {legend.categories.length > 0 || legend.uncategorized ? (
            <ul aria-label="Leyenda del mapa: categorías" className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {legend.categories.map((c) => (
                <li key={c.id}>
                  <CategoryTag name={c.name} color={c.color} icon={c.icon} />
                </li>
              ))}
              {legend.uncategorized ? (
                <li>
                  <CategoryTag name={null} />
                </li>
              ) : null}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-gray-600">
            Los números agrupan instalaciones cercanas: toca uno para acercar. Las instalaciones sin coordenadas aparecen solo en la lista.
          </p>
        </section>
      </div>
    </div>
  );
}
