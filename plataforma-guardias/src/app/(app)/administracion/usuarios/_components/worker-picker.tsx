"use client";

import { useMemo, useState } from "react";
import { Input, Select } from "@/components/ui/form";
import { normalizeSearch, workerOptionLabel, type WorkerOption } from "@/lib/admin/accounts";
import { invalidProps } from "@/lib/admin/use-action-form";

const MAX_SHOWN = 300;

/** Selector de trabajador con búsqueda (solo trabajadores activos sin cuenta). */
export function WorkerPicker({
  id,
  options,
  defaultValue,
  error,
}: {
  id: string;
  options: WorkerOption[];
  defaultValue?: string | null;
  error?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(defaultValue ?? "");
  const indexed = useMemo(
    () => options.map((o) => ({ option: o, text: normalizeSearch(`${o.fullName} ${o.internalCode} ${o.facilityName ?? ""}`) })),
    [options],
  );
  const needle = normalizeSearch(query);
  const matches = needle ? indexed.filter((i) => i.text.includes(needle)).map((i) => i.option) : options;
  const shown = matches.slice(0, MAX_SHOWN);
  const selected = options.find((o) => o.id === value);
  // La opción elegida siempre está presente aunque no coincida con la búsqueda.
  if (selected && !shown.some((o) => o.id === selected.id)) shown.unshift(selected);

  return (
    <div className="space-y-2">
      {options.length > 8 ? (
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Buscar por nombre, clave o sede"
          aria-label="Buscar trabajador"
          aria-controls={id}
          autoComplete="off"
        />
      ) : null}
      <Select id={id} name="worker_id" value={value} onChange={(e) => setValue(e.currentTarget.value)} {...invalidProps(error, id)}>
        <option value="">Sin trabajador vinculado</option>
        {shown.map((o) => (
          <option key={o.id} value={o.id}>
            {workerOptionLabel(o)}
          </option>
        ))}
      </Select>
      {needle ? (
        <p className="text-sm text-gray-600" aria-live="polite">
          {matches.length === 0
            ? "Sin coincidencias."
            : matches.length > MAX_SHOWN
              ? `${matches.length} coincidencias; se muestran las primeras ${MAX_SHOWN}. Escribe más para acotar.`
              : `${matches.length} ${matches.length === 1 ? "coincidencia" : "coincidencias"}.`}
        </p>
      ) : options.length > MAX_SHOWN ? (
        <p className="text-sm text-gray-600">Se muestran los primeros {MAX_SHOWN} de {options.length}; usa la búsqueda.</p>
      ) : null}
    </div>
  );
}
