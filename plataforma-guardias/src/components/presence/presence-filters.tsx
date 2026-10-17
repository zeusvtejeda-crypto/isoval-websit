import Form from "next/form";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { SHIFT_PERIOD_FILTERS, SHIFT_PERIOD_LABELS, type ShiftPeriodFilter } from "@/lib/presence/periods";

/** Filtros GET del tablero «Quién está aquí» (funciona también sin JavaScript). */
export function PresenceFilters({
  facilities,
  facilityId,
  day,
  period,
}: {
  facilities: { id: string; official_name: string }[];
  facilityId: string | null;
  day: string;
  period: ShiftPeriodFilter;
}) {
  return (
    <Form action="/en-servicio" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1.4fr_auto] lg:items-end">
      <Field label="Sede" htmlFor="sede">
        <Select id="sede" name="sede" defaultValue={facilityId ?? ""}>
          <option value="">Todas mis sedes</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.official_name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Fecha" htmlFor="fecha" hint="Día en la zona de cada sede.">
        <Input id="fecha" name="fecha" type="date" defaultValue={day} />
      </Field>
      <Field label="Turno" htmlFor="turno" hint="Según la hora local de inicio.">
        <Select id="turno" name="turno" defaultValue={period}>
          {SHIFT_PERIOD_FILTERS.map((p) => (
            <option key={p} value={p}>
              {SHIFT_PERIOD_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <Button type="submit" className="flex-1 lg:flex-none">
          Aplicar filtros
        </Button>
        <Link href="/en-servicio" className={buttonClasses("outline", "md", "flex-1 lg:flex-none")}>
          Hoy
        </Link>
      </div>
    </Form>
  );
}
