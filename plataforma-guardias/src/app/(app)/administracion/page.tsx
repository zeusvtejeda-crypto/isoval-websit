import type { Metadata } from "next";
import Link from "next/link";
import { ROLE_LABELS, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adminPanelCards, panelDescription } from "@/lib/admin/panel";
import { readPrivacyNotice } from "@/lib/admin/settings";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/states";

export const metadata: Metadata = { title: "Administración" };

/** Avisos para administración (si la consulta falla, simplemente no se muestran). */
async function adminNotices(): Promise<{ privacyPending: boolean; demoRows: number }> {
  try {
    const supabase = await createClient();
    const [settingRes, demoRes] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "privacy_notice").maybeSingle(),
      supabase.from("facilities").select("id", { count: "exact", head: true }).eq("is_demo", true),
    ]);
    return {
      privacyPending: !settingRes.error && readPrivacyNotice(settingRes.data?.value).legal_review_status !== "aprobado",
      demoRows: demoRes.error ? 0 : (demoRes.count ?? 0),
    };
  } catch {
    return { privacyPending: false, demoRows: 0 };
  }
}

export default async function AdministracionPage() {
  const user = await requireStaff();
  const cards = adminPanelCards(user.role);
  const notices = user.isAdmin ? await adminNotices() : null;
  const noScope = !user.isAdmin && user.facilityIds.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Administración" description={`${panelDescription(user.role)} Rol: ${ROLE_LABELS[user.role]}.`} />

      {notices?.privacyPending ? (
        <Alert tone="warning" title="Aviso de privacidad pendiente de revisión jurídica">
          El texto público es un borrador.{" "}
          <Link href="/administracion/configuracion#aviso" className="font-semibold underline underline-offset-2">
            Revisar en Configuración
          </Link>
        </Alert>
      ) : null}
      {notices && notices.demoRows > 0 ? (
        <Alert tone="info" title="Hay datos de demostración">
          Existen {notices.demoRows} {notices.demoRows === 1 ? "instalación" : "instalaciones"} de demostración.{" "}
          <Link href="/administracion/configuracion#demostracion" className="font-semibold underline underline-offset-2">
            Eliminarlos antes de usar datos reales
          </Link>
        </Alert>
      ) : null}
      {noScope ? (
        <Alert tone="warning" title="Sin sedes asignadas">
          Tu cuenta no tiene sedes asignadas; las herramientas no mostrarán información hasta que administración te asigne sedes.
        </Alert>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Herramientas de administración">
        {cards.map((card) => (
          <li key={card.key}>
            <Link
              href={card.href}
              className="flex h-full min-h-24 flex-col justify-center rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm hover:border-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-700"
            >
              <span className="text-lg font-semibold text-brand-900">{card.title}</span>
              <span className="mt-1 text-sm text-gray-600">{card.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
