import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Disclaimer } from "@/components/layout/disclaimer";
import { Alert } from "@/components/ui/states";

export const metadata: Metadata = { title: "Aviso de privacidad" };

type Notice = { title?: string; body?: string; legal_review_status?: string; responsible?: string | null; contact?: string | null };

export default async function PrivacyPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("value, updated_at").eq("key", "privacy_notice").maybeSingle();
  const notice = (data?.value ?? {}) as Notice;
  const pendingReview = notice.legal_review_status !== "aprobado";

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <Link href="/" className="text-sm font-medium text-brand-800 underline">
          Volver
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-gray-900">{notice.title ?? "Aviso de privacidad"}</h1>
        {pendingReview ? (
          <Alert tone="warning" className="mt-4" title="Pendiente de revisión jurídica">
            Este texto es un borrador configurable y no constituye un aviso de privacidad definitivo.
          </Alert>
        ) : null}
        <div className="mt-4 whitespace-pre-line rounded-2xl bg-white p-5 text-gray-800 ring-1 ring-gray-200">
          {notice.body ?? "El aviso de privacidad aún no se ha configurado."}
        </div>
        {notice.responsible || notice.contact ? (
          <p className="mt-4 text-sm text-gray-700">
            {notice.responsible ? <>Responsable: {notice.responsible}. </> : null}
            {notice.contact ? <>Contacto: {notice.contact}</> : null}
          </p>
        ) : null}
        {data?.updated_at ? (
          <p className="mt-2 text-xs text-gray-500">Última actualización: {new Date(data.updated_at).toLocaleDateString("es-MX")}</p>
        ) : null}
      </main>
      <Disclaimer />
    </div>
  );
}
