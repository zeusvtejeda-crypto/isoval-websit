import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DemoBanner } from "@/components/layout/disclaimer";
import { Card, CardHeader } from "@/components/ui/card";
import { CategoryTag, DemoBadge, VerificationBadge } from "@/components/directory/facility-badges";
import { DirectionsLinks } from "@/components/directory/directions-links";
import { FacilityMiniMap } from "@/components/directory/facility-mini-map";
import { formatCoordinates } from "@/lib/directory/directions";
import { formatDateOnly, safeExternalUrls, telHref } from "@/lib/directory/format";
import { toDirectoryFacilityFromDetail } from "@/lib/directory/mappers";
import { loadFacilityDetail } from "@/lib/directory/queries";
import { formatDateTime } from "@/lib/time";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const data = await loadFacilityDetail(id);
  return { title: data ? data.facility.name : "Instalación no encontrada" };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b border-gray-100 py-2.5 last:border-b-0 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm font-medium text-gray-600">{label}</dt>
      <dd className="break-words text-gray-900">{children}</dd>
    </div>
  );
}

const Missing = ({ children = "Sin dato registrado" }: { children?: ReactNode }) => <span className="text-gray-500">{children}</span>;

/** Ficha pública de una instalación. Solo datos de public_facilities. */
export default async function FichaInstalacionPage({ params }: { params: Params }) {
  const { id } = await params;
  const data = await loadFacilityDetail(id);
  if (!data) notFound();
  const { facility: f, category, state, municipality } = data;

  const sourceUrls = safeExternalUrls(f.sourceUrl);
  const phoneHref = telHref(f.phone);
  const verifiedOn = formatDateOnly(f.lastVerifiedAt);
  const coordinates = f.latitude != null && f.longitude != null ? formatCoordinates(f.latitude, f.longitude) : null;

  return (
    <div className="space-y-5">
      {f.isDemo ? <DemoBanner /> : null}

      <nav aria-label="Ruta de navegación">
        <Link href="/directorio" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Volver al directorio
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{f.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <CategoryTag name={category?.name ?? null} color={category?.color} />
          <VerificationBadge verified={f.verificationStatus === "verificado"} />
          {f.isDemo ? <DemoBadge /> : null}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Datos de la instalación" />
            <dl>
              <Row label="Identificador interno">{f.internalCode}</Row>
              <Row label="Nombre oficial">{f.name}</Row>
              {f.unitKey ? <Row label="Clave de unidad">{f.unitKey}</Row> : null}
              <Row label="Categoría">{category?.name ?? <Missing>Sin categoría</Missing>}</Row>
              <Row label="Descripción">{f.description ?? <Missing />}</Row>
              <Row label="Estado">{state?.name ?? <Missing />}</Row>
              <Row label="Municipio">{municipality?.name ?? <Missing />}</Row>
              <Row label="Dirección">{f.address ?? <Missing />}</Row>
              <Row label="Coordenadas">
                {coordinates ?? <Missing>Sin coordenadas (no aparece en el mapa)</Missing>}
              </Row>
              {f.phone ? (
                <Row label="Teléfono de la instalación">
                  {phoneHref ? (
                    <a href={phoneHref} className="font-medium text-brand-800 underline underline-offset-2">
                      {f.phone}
                    </a>
                  ) : (
                    f.phone
                  )}
                </Row>
              ) : null}
              {f.schedule ? <Row label="Horario">{f.schedule}</Row> : null}
              <Row label="Servicios">
                {!f.servicesVerified ? (
                  <Missing>Servicios no verificados</Missing>
                ) : f.services.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-5">
                    {f.services.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <Missing>Sin servicios registrados</Missing>
                )}
              </Row>
              <Row label="Observaciones">{f.notes ?? <Missing>Sin observaciones</Missing>}</Row>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Procedencia de la información" />
            <dl>
              <Row label="Fuente de información">
                <span className="block">{f.source}</span>
                {sourceUrls.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {sourceUrls.map((url, i) => (
                      <li key={url}>
                        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-medium text-brand-800 underline underline-offset-2">
                          {sourceUrls.length > 1 ? `Consultar fuente ${i + 1}` : "Consultar fuente"}
                          <span className="sr-only"> (se abre en otra pestaña): {new URL(url).hostname}</span>
                        </a>
                        <span className="ml-1 text-sm text-gray-500">({new URL(url).hostname})</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Row>
              <Row label="Estado de verificación">
                <VerificationBadge verified={f.verificationStatus === "verificado"} />
              </Row>
              <Row label="Última verificación">{verifiedOn ?? <Missing>Sin verificar</Missing>}</Row>
              {f.updatedAt ? <Row label="Última actualización del registro">{formatDateTime(f.updatedAt, f.timezone)}</Row> : null}
            </dl>
            {f.verificationStatus !== "verificado" ? (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-200">
                Datos pendientes de verificación: confirma con la fuente antes de acudir.
              </p>
            ) : null}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Cómo llegar" />
            <DirectionsLinks
              target={{
                latitude: f.latitude,
                longitude: f.longitude,
                name: f.name,
                address: f.address,
                municipality: municipality?.name,
                state: state?.name,
              }}
            />
          </Card>
          {coordinates ? (
            <Card>
              <CardHeader title="Ubicación en el mapa" />
              <FacilityMiniMap facility={toDirectoryFacilityFromDetail(f)} category={category} />
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
