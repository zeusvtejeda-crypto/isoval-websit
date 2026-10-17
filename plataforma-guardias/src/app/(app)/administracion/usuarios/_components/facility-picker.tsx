"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { facilityChoiceLabel, normalizeSearch, type FacilityChoice } from "@/lib/admin/accounts";

/**
 * Casillas de sedes asignadas con búsqueda. Las casillas ocultas por la
 * búsqueda siguen enviándose, así que filtrar no pierde la selección.
 */
export function FacilityPicker({
  idPrefix,
  choices,
  defaultSelected,
  error,
  onSelectionChange,
}: {
  idPrefix: string;
  choices: FacilityChoice[];
  defaultSelected: string[];
  error?: string | null;
  /** Avisa la selección nueva (p. ej. para pedir el motivo del cambio). */
  onSelectionChange?: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelected));
  const [query, setQuery] = useState("");
  const indexed = useMemo(() => choices.map((c) => ({ choice: c, text: normalizeSearch(c.name) })), [choices]);
  const needle = normalizeSearch(query);
  const visibleIds = new Set(indexed.filter((i) => !needle || i.text.includes(needle)).map((i) => i.choice.id));
  // Nombres de las sedes marcadas (en el orden de la lista), aunque la búsqueda las oculte.
  const selectedChoices = choices.filter((c) => selected.has(c.id));
  const errorId = `${idPrefix}-facilities-error`;

  function update(next: Set<string>) {
    setSelected(next);
    onSelectionChange?.([...next]);
  }

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    update(next);
  }

  return (
    <fieldset className="space-y-2" aria-describedby={error ? errorId : undefined}>
      <legend className="text-sm font-medium text-gray-800">
        Sedes asignadas<span className="text-red-700"> *</span>
      </legend>
      <p className="text-sm text-gray-600">Coordinación y auditoría solo ven y gestionan las sedes que marques aquí.</p>
      {choices.length === 0 ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
          No hay instalaciones activas.{" "}
          <Link href="/administracion/instalaciones" className="font-semibold underline">
            Registra una instalación
          </Link>{" "}
          antes de asignar sedes.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {choices.length > 6 ? (
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder="Buscar sede"
                aria-label="Buscar sede"
                autoComplete="off"
                className="max-w-sm"
              />
            ) : null}
            <span className="text-sm font-medium text-gray-700" aria-live="polite">
              {selected.size} {selected.size === 1 ? "sede seleccionada" : "sedes seleccionadas"}
            </span>
            {selected.size > 0 ? (
              <button type="button" onClick={() => update(new Set())} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50">
                Quitar todas
              </button>
            ) : null}
          </div>
          {selectedChoices.length > 0 ? (
            <ul aria-label="Sedes seleccionadas" className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {selectedChoices.map((c) => (
                <li key={c.id} className="inline-flex items-center rounded-full bg-brand-50 pl-3 text-sm text-brand-900 ring-1 ring-inset ring-brand-200">
                  <span className="py-1">{facilityChoiceLabel(c)}</span>
                  <button
                    type="button"
                    onClick={() => toggle(c.id, false)}
                    aria-label={`Quitar ${c.name}`}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg leading-none hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-brand-700"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2">
            {choices.map((c) => {
              const id = `${idPrefix}-facility-${c.id}`;
              return (
                <label key={c.id} htmlFor={id} className={visibleIds.has(c.id) ? "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-gray-50" : "hidden"}>
                  <input
                    id={id}
                    type="checkbox"
                    name="facility_ids"
                    value={c.id}
                    checked={selected.has(c.id)}
                    onChange={(e) => toggle(c.id, e.currentTarget.checked)}
                    className="size-5 shrink-0 rounded border-gray-400 text-brand-800 focus:ring-brand-700"
                  />
                  <span className="min-w-0 flex-1">{facilityChoiceLabel(c)}</span>
                  {c.isDemo ? <Badge tone="warning">Demostración</Badge> : null}
                </label>
              );
            })}
            {visibleIds.size === 0 ? <p className="px-2 py-3 text-sm text-gray-600">Ninguna sede coincide con la búsqueda.</p> : null}
          </div>
        </>
      )}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
