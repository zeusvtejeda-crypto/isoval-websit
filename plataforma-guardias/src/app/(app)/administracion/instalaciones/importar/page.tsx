import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/data/catalogs";
import { FACILITIES_BASE_PATH, MEXICO_TIMEZONES, OFFICIAL_SOURCES_NOTICE, TOLERANCE_DEFAULT, TOLERANCE_MAX } from "@/lib/validation/facility";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { Table, Td, Th } from "@/components/ui/table";
import { FacilityImportForm } from "../_components/import-form";
import { processFacilityImport } from "./actions";

export const metadata = { title: "Importar instalaciones" };

const COLUMNS: { name: string; required?: boolean; description: string }[] = [
  {
    name: "identificador_interno",
    description: "Solo para actualizar una instalación existente (INS-…). Déjalo vacío para crear: la plataforma lo asigna.",
  },
  { name: "nombre_oficial", required: true, description: "Como aparece en la fuente oficial (3 a 300 caracteres)." },
  { name: "clave_unidad", description: "Clave oficial si existe. No puede repetirse; si ya existe, se actualiza esa instalación." },
  { name: "categoria", required: true, description: "Identificador (slug) o nombre de la categoría, sin importar acentos ni mayúsculas." },
  { name: "descripcion", description: "Opcional." },
  { name: "estado", required: true, description: "Nombre, abreviatura o clave INEGI (Nayarit, NAY o 18)." },
  { name: "municipio", required: true, description: "Nombre (o clave INEGI de 3 dígitos) dentro del estado." },
  { name: "direccion", description: "Opcional." },
  { name: "latitud", description: "Decimal entre 14 y 33. Captura latitud y longitud juntas, o ninguna." },
  { name: "longitud", description: "Decimal negativo entre −119 y −86." },
  { name: "telefono", description: "Teléfono institucional de la instalación (nunca personal)." },
  { name: "horario", description: "Opcional, por ejemplo «Lunes a viernes de 8:00 a 20:00»." },
  { name: "servicios", description: "Separados por «;» o «|» (o uno por línea dentro de la celda)." },
  { name: "servicios_verificados", description: "«sí» o «no». Solo los verificados se muestran en el directorio público." },
  { name: "fuente", required: true, description: "Fuente de información oficial consultada. Obligatoria en cada fila." },
  { name: "url_fuente", description: "Dirección completa (https://…)." },
  { name: "fecha_verificacion", description: "AAAA-MM-DD o DD/MM/AAAA. No puede ser futura." },
  { name: "estado_verificacion", description: "«verificado» o «pendiente» (por omisión). «verificado» exige fecha de verificación." },
  { name: "observaciones", description: "Se muestran en la ficha pública. Sin datos personales." },
  { name: "zona_horaria", description: "Zona de México (lista abajo). Vacía: la del municipio o la del estado." },
  { name: "tolerancia_minutos", description: `Tolerancia de llegada: entero de 0 a ${TOLERANCE_MAX}. Vacía: ${TOLERANCE_DEFAULT} en altas.` },
];

export default async function ImportarInstalacionesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const categories = await getCategories(supabase);

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 text-sm">
        <Link href={FACILITIES_BASE_PATH} className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Instalaciones
        </Link>
      </nav>
      <PageHeader
        title="Importar instalaciones"
        description="Carga un archivo CSV o Excel. Primero se valida y se muestra qué pasará con cada fila; nada se guarda hasta que pulses «Importar»."
        actions={
          <a href="/plantillas/instalaciones.csv" download className={buttonClasses("outline")}>
            Descargar plantilla CSV
          </a>
        }
      />

      <div className="space-y-4">
        <Alert tone="warning" title="Fuentes oficiales">
          {OFFICIAL_SOURCES_NOTICE}
        </Alert>

        <Card>
          <CardHeader title="1. Elige el archivo y valida" description="Después de validar, revisa la vista previa y pulsa «Importar»." />
          <FacilityImportForm action={processFacilityImport} />
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
            <li>
              Duplicados en el archivo: misma clave de unidad, mismo identificador interno o mismo nombre oficial en el mismo municipio. Contra lo
              registrado: clave de unidad, identificador interno o mismo nombre en el mismo estado y municipio (si hay varias unidades con ese nombre, la
              fila debe indicar su clave de unidad o su identificador interno).
            </li>
            <li>En actualizaciones, las celdas opcionales vacías conservan el valor registrado. Nombre, categoría, estado, municipio y fuente se exigen siempre.</li>
            <li>Cada cambio queda en la bitácora con el motivo «Importación: nombre del archivo».</li>
            <li>Las instalaciones nuevas se crean activas y visibles en el directorio público; puedes ocultarlas o desactivarlas después.</li>
            <li>La fila 1 es la de encabezados. Las filas completamente vacías se omiten y no cuentan en la numeración de la vista previa.</li>
            <li>Si editas en Excel, guarda como «Libro de Excel (.xlsx)» o «CSV UTF-8» para conservar los acentos.</li>
          </ul>
        </Card>

        <details className="rounded-card border border-gray-200 bg-white p-4 sm:p-5">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-gray-900">Categorías registradas para la columna «categoria»</summary>
          <Table caption="Categorías registradas" className="mt-3">
            <thead>
              <tr>
                <Th>Identificador (slug)</Th>
                <Th>Nombre</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories.map((c) => (
                <tr key={c.id}>
                  <Td className="whitespace-nowrap font-mono text-sm">{c.slug}</Td>
                  <Td>{c.name}</Td>
                  <Td>{c.active ? <Badge tone="success">Activa</Badge> : <Badge tone="muted">Inactiva (no admite altas)</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </details>

        <details className="rounded-card border border-gray-200 bg-white p-4 sm:p-5">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-gray-900">Zonas horarias válidas para «zona_horaria»</summary>
          <Table caption="Zonas horarias de México" className="mt-3">
            <thead>
              <tr>
                <Th>Valor</Th>
                <Th>Descripción</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MEXICO_TIMEZONES.map((t) => (
                <tr key={t.value}>
                  <Td className="whitespace-nowrap font-mono text-sm">{t.value}</Td>
                  <Td>{t.label}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </details>
      </div>
    </>
  );
}
