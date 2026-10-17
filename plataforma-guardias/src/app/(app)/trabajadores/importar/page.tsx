import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { USUAL_SHIFT_OPTIONS } from "@/lib/validation/worker";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { Table, Td, Th } from "@/components/ui/table";
import { ImportForm } from "../_components/import-form";
import { processWorkerImport } from "./actions";
import { getManageableFacilityOptions } from "../_lib/queries";

export const metadata = { title: "Importar trabajadores" };

/** Máximo de instalaciones en la tabla de claves de referencia. */
const KEYS_LIMIT = 300;

const COLUMNS: { name: string; required?: boolean; description: string }[] = [
  { name: "nombre_completo", required: true, description: "Nombre y apellidos (3 a 200 caracteres)." },
  { name: "numero_trabajador", description: "Opcional y privado. Si ya existe, se actualiza a esa persona (o se omite en «solo crear»)." },
  { name: "estado", description: "Nombre, abreviatura o clave INEGI (Nayarit, NAY o 18). Vacío: el de la instalación o Nayarit." },
  { name: "municipio", description: "Nombre o clave INEGI de 3 dígitos; debe pertenecer al estado." },
  { name: "instalacion", description: "Clave de unidad, identificador interno (INS-…) o nombre oficial exacto." },
  { name: "area", description: "Opcional (máximo 120 caracteres)." },
  { name: "puesto", description: "Opcional (máximo 120 caracteres)." },
  { name: "turno_habitual", description: `Opcional: ${USUAL_SHIFT_OPTIONS.join(", ")}.` },
  { name: "telefono", description: "Opcional y privado: 7 a 20 caracteres con dígitos, espacios, +, paréntesis o guiones." },
  { name: "activo", description: "«sí» o «no». Vacío: sí (en altas) o sin cambio (en actualizaciones)." },
];

export default async function ImportarTrabajadoresPage() {
  const user = await requireManager();
  const supabase = await createClient();
  const facilities = await getManageableFacilityOptions(supabase, user);
  // Administración: instalaciones activas (sin lista de ids, que alargaría la URL);
  // coordinación: solo sus sedes (lista corta).
  let keysQuery = supabase
    .from("facilities")
    .select("id, internal_code, unit_key, official_name")
    .eq("active", true)
    .order("official_name")
    .limit(KEYS_LIMIT);
  if (!user.isAdmin) keysQuery = keysQuery.in("id", facilities.slice(0, KEYS_LIMIT).map((f) => f.id));
  const { data: keys } =
    facilities.length > 0 ? await keysQuery : { data: [] as { id: string; internal_code: string; unit_key: string | null; official_name: string }[] };

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 text-sm">
        <Link href="/trabajadores" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Trabajadores
        </Link>
      </nav>
      <PageHeader
        title="Importar trabajadores"
        description="Carga un archivo CSV o Excel. Primero se valida y se muestra qué pasará con cada fila; nada se guarda hasta que pulses «Importar»."
        actions={
          <a href="/plantillas/trabajadores.csv" download className={buttonClasses("outline")}>
            Descargar plantilla CSV
          </a>
        }
      />

      {!user.isAdmin && facilities.length === 0 ? (
        <EmptyState title="Sin sedes asignadas" description="Para importar trabajadores necesitas al menos una sede asignada. Pide a administración que te asigne una." />
      ) : (
        <div className="space-y-4">
          <Alert tone="info" title="Solo datos necesarios">
            No incluyas CURP, datos médicos, biométricos ni otras columnas innecesarias: las columnas no reconocidas se ignoran.
            {user.isAdmin ? null : " Solo puedes importar trabajadores a las sedes que coordinas; cada fila se valida."}
          </Alert>

          <Card>
            <CardHeader title="1. Elige el archivo y valida" description="Después de validar, revisa la vista previa y pulsa «Importar»." />
            <ImportForm action={processWorkerImport} />
          </Card>

          <Card>
            <CardHeader title="Columnas de la plantilla" description="La primera fila debe tener los encabezados. La fila de ejemplo de la plantilla se rechaza." />
            <Table caption="Columnas de la plantilla">
              <thead>
                <tr>
                  <Th>Columna</Th>
                  <Th>Contenido</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {COLUMNS.map((c) => (
                  <tr key={c.name}>
                    <Td className="whitespace-nowrap font-mono text-sm">
                      {c.name}
                      {c.required ? <span className="ml-1 font-sans text-red-700">(obligatoria)</span> : null}
                    </Td>
                    <Td>{c.description}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
              <li>Duplicados: número de trabajador repetido en el archivo o ya registrado, y mismo nombre en la misma sede.</li>
              <li>En actualizaciones, las celdas vacías conservan el valor registrado.</li>
              <li>Cada cambio queda en la bitácora con el motivo «Importación de archivo».</li>
              <li>La fila 1 es la de encabezados. Las filas completamente vacías se omiten y no cuentan en la numeración de la vista previa.</li>
              <li>Si editas en Excel, guarda como «Libro de Excel (.xlsx)» o «CSV UTF-8» para conservar los acentos.</li>
            </ul>
          </Card>

          {keys && keys.length > 0 ? (
            <details className="rounded-card border border-gray-200 bg-white p-4 sm:p-5">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-gray-900">
                Claves de {user.isAdmin ? "las instalaciones activas" : "tus sedes"} para la columna «instalacion»
              </summary>
              <Table caption="Claves de instalaciones" className="mt-3">
                <thead>
                  <tr>
                    <Th>Nombre oficial</Th>
                    <Th>Clave de unidad</Th>
                    <Th>Identificador interno</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {keys.map((f) => (
                    <tr key={f.id}>
                      <Td>{f.official_name}</Td>
                      <Td className="whitespace-nowrap">{f.unit_key ?? <span className="text-gray-500">—</span>}</Td>
                      <Td className="whitespace-nowrap font-mono text-sm">{f.internal_code}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {facilities.length > KEYS_LIMIT ? <p className="mt-2 text-sm text-gray-600">Se muestran las primeras {KEYS_LIMIT} instalaciones.</p> : null}
            </details>
          ) : null}
        </div>
      )}
    </>
  );
}
