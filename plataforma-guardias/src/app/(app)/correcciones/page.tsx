import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { canManageFacility, requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFacilityOptions } from "@/lib/data/catalogs";
import {
  OWN_REVIEW_MESSAGE,
  correctionContext,
  describeCorrection,
  ownReviewBlock,
  parseCorrectionTab,
  parseReviewResult,
  type CorrectionTab,
} from "@/lib/reports/corrections";
import { countPendingCorrections, loadCorrection, loadCorrections } from "@/lib/reports/corrections-load";
import { getProfileNames, getWorkerProfileIds } from "@/lib/reports/load";
import { isGuid, readParam, type RawParams } from "@/lib/reports/params";
import { PRESENCE_NOTICE } from "@/lib/reports/texts";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { Alert, EmptyState } from "@/components/ui/states";
import { LastUpdated } from "@/components/layout/connection-status";
import { CorrectionCard } from "./_components/correction-card";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Solicitudes de corrección" };

const LIMIT = 200;

function tabHref(tab: CorrectionTab, sede: string | null) {
  const sp = new URLSearchParams({ pestana: tab });
  if (sede) sp.set("sede", sede);
  return `/correcciones?${sp.toString()}`;
}

export default async function CorreccionesPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const user = await requireManager();
  const sp = await searchParams;
  const tab = parseCorrectionTab(readParam(sp, "pestana"));
  const rawSede = readParam(sp, "sede");
  const sede = rawSede && isGuid(rawSede) ? rawSede.toLowerCase() : null;
  const reviewedId = readParam(sp, "revisada");
  const result = parseReviewResult(readParam(sp, "resultado"));
  const reverted = result === "aprobada" && readParam(sp, "revertida") === "1";

  const supabase = await createClient();
  const [list, pendingCount, facilities, reviewed] = await Promise.all([
    loadCorrections(supabase, { status: tab === "pendientes" ? "pendiente" : "revisadas", facilityId: sede, limit: LIMIT }),
    countPendingCorrections(supabase, sede),
    getFacilityOptions(supabase, user.isAdmin ? null : user.facilityIds),
    reviewedId && isGuid(reviewedId) && result ? loadCorrection(supabase, reviewedId) : Promise.resolve(null),
  ]);

  const items = list.items;
  const [names, workerProfileIds] = await Promise.all([
    getProfileNames(
      supabase,
      items.flatMap((c) => [c.requested_by, c.reviewed_by]),
    ),
    getWorkerProfileIds(
      supabase,
      items.map((c) => c.worker_id),
    ),
  ]);
  const actors = { currentUserId: user.id, names };
  const generatedAt = new Date().toISOString();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Solicitudes de corrección"
        description="Revisa las solicitudes de corrección de registros de entrada y salida de tus sedes. Al aprobar, el registro original se conserva y se crea una versión corregida."
      />

      {reviewed && result ? (
        <Alert tone={result === "aprobada" ? "success" : "info"} title={result === "aprobada" ? "Solicitud aprobada" : "Solicitud rechazada"}>
          <p>
            {reviewed.worker?.full_name ?? "La persona"} · {reviewed.facility?.official_name ?? "Sede"}.{" "}
            {result === "aprobada"
              ? reverted
                ? "La asignación volvió a «Asignado» y se agregó el registro solicitado; el cambio de estado queda en la bitácora."
                : "Se creó la versión corregida del registro; la versión original queda en el historial."
              : "El registro no cambió. La persona verá tus notas de revisión."}
          </p>
          <p className="mt-1">
            <Link href={tabHref("revisadas", sede)} className="font-semibold underline underline-offset-2">
              Ver en revisadas
            </Link>
            {reviewed.worker ? (
              <>
                {" · "}
                <Link href={`/historial/trabajador/${reviewed.worker.id}`} className="font-semibold underline underline-offset-2">
                  Ver historial de la persona
                </Link>
              </>
            ) : null}
          </p>
        </Alert>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <nav aria-label="Pestañas de solicitudes" className="flex flex-wrap gap-2">
            {(
              [
                ["pendientes", `Pendientes (${pendingCount})`],
                ["revisadas", "Revisadas"],
              ] as const
            ).map(([value, label]) => (
              <Link
                key={value}
                href={tabHref(value, sede)}
                aria-current={tab === value ? "page" : undefined}
                className={buttonClasses(tab === value ? "primary" : "outline", "md")}
              >
                {label}
              </Link>
            ))}
          </nav>
          <Form action="/correcciones" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="pestana" value={tab} />
            <Field label="Sede" htmlFor="sede" className="min-w-60">
              <Select id="sede" name="sede" defaultValue={sede ?? ""}>
                <option value="">Todas mis sedes</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.official_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
          </Form>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">
            {tab === "pendientes" ? "De la más antigua a la más reciente." : "Revisadas recientemente, de la más reciente a la más antigua."} Horas en la zona horaria de cada sede.
          </p>
          <LastUpdated at={generatedAt} timeZone={DEFAULT_TIMEZONE} />
        </div>
        <p className="mt-1 text-sm text-gray-600">{PRESENCE_NOTICE}</p>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title={tab === "pendientes" ? "No hay solicitudes pendientes" : "Aún no hay solicitudes revisadas"}
          description={
            tab === "pendientes"
              ? "Cuando una persona solicite corregir un registro de sus sedes, aparecerá aquí."
              : "Las solicitudes aprobadas o rechazadas aparecerán aquí."
          }
          action={
            tab === "pendientes" ? (
              <Link href={tabHref("revisadas", sede)} className={buttonClasses("outline")}>
                Ver revisadas
              </Link>
            ) : (
              <Link href={tabHref("pendientes", sede)} className={buttonClasses("outline")}>
                Ver pendientes
              </Link>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const tz = item.facility?.timezone ?? DEFAULT_TIMEZONE;
            const inScope = item.status === "pendiente" && canManageFacility(user, item.facility_id);
            // Separación de funciones: salvo administración, nadie revisa lo propio (la base de datos lo rechaza).
            const ownBlock = inScope ? ownReviewBlock(item, { id: user.id, workerId: user.workerId, isAdmin: user.isAdmin }) : null;
            const view = describeCorrection(item, item.session, tz, correctionContext(item));
            return (
              <CorrectionCard key={item.id} item={item} actors={actors} workerProfileIds={workerProfileIds}>
                {inScope && ownBlock ? (
                  <div className="space-y-1 text-sm text-gray-800">
                    <p className="font-medium">
                      {ownBlock === "own_request" ? "Tú enviaste esta solicitud." : "Esta solicitud es sobre tu propia asistencia."}
                    </p>
                    <p>{OWN_REVIEW_MESSAGE}.</p>
                  </div>
                ) : inScope ? (
                  <>
                    {item.requested_by === user.id ? (
                      <p className="mb-3 text-sm text-amber-900">Tú enviaste esta solicitud; de ser posible, pide que la revise otra persona.</p>
                    ) : null}
                    <ReviewForm requestId={item.id} canApprove={view.canApprove} sede={sede} />
                  </>
                ) : item.status === "pendiente" ? (
                  <p className="text-sm text-gray-700">Esta solicitud es de una sede fuera de tu alcance de gestión; no puedes revisarla.</p>
                ) : null}
              </CorrectionCard>
            );
          })}
          {list.truncated ? (
            <p className="text-sm text-gray-600">
              Se muestran las primeras {LIMIT} solicitudes. Filtra por sede para ver otras.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
