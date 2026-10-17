import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import type { FacilityOption } from "@/lib/data/catalogs";
import { timezoneLabel } from "@/lib/shifts/format";

/**
 * Paso previo al formulario: elegir la sede (GET, funciona sin JavaScript).
 * La sede determina la zona horaria y la lista de responsables.
 */
export function FacilityPicker({
  action,
  facilities,
  selectedId,
  cancelHref,
  keep = {},
}: {
  action: string;
  facilities: FacilityOption[];
  selectedId?: string | null;
  cancelHref: string;
  /** Parámetros que se conservan (p. ej. la fecha elegida en el calendario). */
  keep?: Record<string, string>;
}) {
  return (
    <form method="get" action={action} className="space-y-4 rounded-[--radius-card] border border-gray-200 bg-white p-4 sm:p-5">
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Field label="Sede" htmlFor="pick-sede" required hint="Solo aparecen las sedes que puedes gestionar. Las horas se capturan en la zona de la sede.">
        <Select id="pick-sede" name="sede" required defaultValue={selectedId ?? ""}>
          <option value="" disabled>
            Elige la sede…
          </option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.official_name} · {timezoneLabel(f.timezone)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Continuar</Button>
        <Link href={cancelHref} className={buttonClasses("outline")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
