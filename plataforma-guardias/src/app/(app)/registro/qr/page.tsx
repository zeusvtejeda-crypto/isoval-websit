import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { NOT_LINKED_MESSAGE } from "@/lib/presence/texts";
import { QR_EXPIRED_HINT, QR_NOT_PRESENCE, classifyContextError, formatClockSeconds, readQrParam } from "@/lib/qr/core";
import { parseQrContext } from "@/lib/qr/rpc";
import { timezoneLabel } from "@/lib/shifts/format";
import { DEFAULT_TIMEZONE, formatShiftRange } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { QrAttendance } from "@/components/qr/qr-attendance";

export const metadata: Metadata = { title: "Registro con código QR" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TITLE = "Registro con código QR";

function HowTo({ invalid }: { invalid: boolean }) {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={TITLE} description="Registra tu entrada o salida con el código que muestra coordinación en el punto de reunión." />
      {invalid ? (
        <Alert tone="error" title="El enlace no contiene un código válido">
          El código está incompleto o se copió mal. Vuelve a escanear el código QR que se muestra en el punto de reunión.
        </Alert>
      ) : null}
      <Card>
        <h2 className="text-lg font-semibold text-gray-900">Cómo registrar con código QR</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-base text-gray-800">
          <li>Pide a coordinación que muestre el código QR de tu guardia en el punto de reunión.</li>
          <li>Abre la cámara de tu teléfono y apunta al código (no hace falta otra aplicación).</li>
          <li>Toca el enlace que aparece. Se abrirá esta página con los datos de tu guardia; si te lo pide, inicia sesión con tu cuenta.</li>
          <li>Revisa la guardia y toca «Registrar entrada con código QR» o «Registrar salida con código QR».</li>
        </ol>
        <p className="mt-3 text-gray-700">El código caduca en unos 2 minutos; mientras siga vigente, otra persona podría reenviarlo. {QR_NOT_PRESENCE}</p>
        <div className="mt-4">
          <LinkButton href="/registro" variant="outline" size="lg">
            Registrar sin código
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}

export default async function RegistroQrPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const param = readQrParam(sp.c);
  if (param.kind !== "ok") return <HowTo invalid={param.kind === "invalid"} />;

  if (!user.workerId) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader title={TITLE} />
        <Alert tone="warning" title="Cuenta sin vincular">
          {NOT_LINKED_MESSAGE}
        </Alert>
      </div>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("qr_token_context", { p_token: param.token });

  if (error) {
    const kind = classifyContextError(error);
    const message = friendlyDbError(error, "No se pudo validar el código QR.");
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader title={TITLE} />
        {kind === "expired" ? (
          <Alert tone="error" title="El código QR caducó o no es válido">
            <p>{message}</p>
            <p className="text-base font-semibold">{QR_EXPIRED_HINT}</p>
          </Alert>
        ) : kind === "not_assigned" ? (
          <Alert tone="error" title="No estás asignado a esta guardia">
            <p>{message}</p>
            <p>Revisa que sea el código de tu guardia o consulta con coordinación.</p>
          </Alert>
        ) : kind === "not_linked" ? (
          <Alert tone="warning" title="Cuenta sin vincular">
            {NOT_LINKED_MESSAGE}
          </Alert>
        ) : (
          <Alert tone="error" title="No se pudo validar el código">
            <p>{message}</p>
            <p>Vuelve a escanear el código. Si el problema continúa, registra desde «Registrar entrada o salida».</p>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/registro" variant="outline" size="lg">
            Registrar sin código
          </LinkButton>
          <LinkButton href="/mi-guardia" variant="outline" size="lg">
            Ver mi guardia
          </LinkButton>
        </div>
      </div>
    );
  }

  const ctx = parseQrContext(data);
  if (!ctx) throw new Error("El servidor devolvió datos incompletos del código QR.");

  const tz = ctx.facilityTimezone ?? DEFAULT_TIMEZONE;
  const facility = ctx.facilityName ?? "Sede";
  const title = ctx.shiftTitle ?? ctx.meetingPoint;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={TITLE} description="La hora que cuenta es la del servidor al recibir tu registro, no la de tu teléfono." />
      <Card>
        <div className="mb-4">
          <p className="text-sm font-medium text-gray-600">Guardia</p>
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          <dl className="mt-2 space-y-1 text-base text-gray-800">
            <div>
              <dt className="inline font-medium text-gray-600">Sede: </dt>
              <dd className="inline">{facility}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-gray-600">Punto de reunión: </dt>
              <dd className="inline">{ctx.meetingPoint}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-gray-600">Horario: </dt>
              <dd className="inline">{formatShiftRange(ctx.startsAt, ctx.endsAt, tz)}</dd>
            </div>
          </dl>
          <p className="text-sm text-gray-500">Hora de la sede ({timezoneLabel(tz)})</p>
          {ctx.expiresAt ? (
            <p className="mt-2 text-sm text-gray-700">
              Este código vence a las {formatClockSeconds(ctx.expiresAt, tz)} (hora del servidor, zona de la sede). Si caduca antes de registrar,{" "}
              {QR_EXPIRED_HINT.charAt(0).toLowerCase()}
              {QR_EXPIRED_HINT.slice(1)}
            </p>
          ) : null}
        </div>
        {ctx.canRegister ? (
          <QrAttendance
            assignmentId={ctx.assignmentId}
            qrToken={param.token}
            hasOpenSession={ctx.hasOpenSession}
            timeZone={tz}
            label={`${facility} · ${ctx.meetingPoint}`}
          />
        ) : (
          <Alert tone="warning" title="No es posible registrar con este código">
            {ctx.blockedReason} Si crees que es un error, avisa a coordinación.
          </Alert>
        )}
      </Card>
    </div>
  );
}
