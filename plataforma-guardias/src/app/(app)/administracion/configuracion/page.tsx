import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LEGAL_REVIEW_LABELS } from "@/lib/admin/settings";
import { loadDemoCounts, loadSettings } from "@/lib/admin/settings-server";
import { DEFAULT_TIMEZONE, formatDateTime } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrivacyNoticeForm } from "./_components/privacy-form";
import { RetentionActions, RetentionSettingsForm } from "./_components/retention-forms";
import { AttendanceSettingsForm } from "./_components/attendance-form";
import { DemoDataPanel } from "./_components/demo-data-panel";

export const metadata: Metadata = { title: "Configuración" };

const SECTIONS = [
  { id: "aviso", label: "Aviso de privacidad" },
  { id: "conservacion", label: "Conservación de datos" },
  { id: "asistencia", label: "Registro de asistencia" },
  { id: "demostracion", label: "Datos de demostración" },
];

export default async function ConfiguracionPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [settings, demoCounts] = await Promise.all([loadSettings(supabase), loadDemoCounts(supabase)]);
  const pending = settings.privacy.legal_review_status !== "aprobado";

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 text-sm">
        <Link href="/administracion" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Administración
        </Link>
      </nav>
      <PageHeader title="Configuración" description="Parámetros generales de la plataforma. Los cambios quedan registrados en la bitácora." />

      <nav aria-label="Secciones de configuración" className="mb-4 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="inline-flex min-h-11 items-center rounded-xl border border-gray-300 bg-white px-3 text-sm font-medium hover:bg-gray-50">
            {s.label}
          </a>
        ))}
      </nav>

      <div className="space-y-6">
        <section id="aviso" aria-labelledby="aviso-titulo" className="scroll-mt-20">
          <Card>
            <CardHeader
              title={<span id="aviso-titulo">Aviso de privacidad</span>}
              description={
                <>
                  Texto público en /aviso-de-privacidad.
                  {settings.privacyUpdatedAt ? ` Última actualización: ${formatDateTime(settings.privacyUpdatedAt, DEFAULT_TIMEZONE)}.` : ""}
                </>
              }
              actions={<Badge tone={pending ? "warning" : "success"}>{LEGAL_REVIEW_LABELS[settings.privacy.legal_review_status]}</Badge>}
            />
            <PrivacyNoticeForm notice={settings.privacy} />
          </Card>
        </section>

        <section id="conservacion" aria-labelledby="conservacion-titulo" className="scroll-mt-20">
          <Card>
            <CardHeader
              title={<span id="conservacion-titulo">Conservación de datos</span>}
              description="Cuánto tiempo se conservan las guardias, sus registros y la bitácora. Guardar los periodos no elimina nada por sí solo."
            />
            <div className="space-y-6">
              <RetentionSettingsForm retention={settings.retention} />
              <div className="border-t border-gray-200 pt-4">
                <RetentionActions />
              </div>
            </div>
          </Card>
        </section>

        <section id="asistencia" aria-labelledby="asistencia-titulo" className="scroll-mt-20">
          <Card>
            <CardHeader
              title={<span id="asistencia-titulo">Registro de asistencia</span>}
              description="Reglas que aplican las funciones de entrada y salida con la hora del servidor."
            />
            <AttendanceSettingsForm settings={settings.attendance} />
            <ul className="mt-4 space-y-1 border-t border-gray-200 pt-3 text-sm text-gray-700">
              <li>Entrada registrada no equivale a presencia física verificada.</li>
              <li>Permanencia adicional = tiempo registrado adicional, no horas extra pagadas.</li>
            </ul>
          </Card>
        </section>

        <section id="demostracion" aria-labelledby="demostracion-titulo" className="scroll-mt-20">
          <Card>
            <CardHeader
              title={<span id="demostracion-titulo">Datos de demostración</span>}
              description="Registros ficticios marcados como demostración. Elimínalos antes de usar la plataforma con datos reales."
            />
            <DemoDataPanel counts={demoCounts} />
          </Card>
        </section>
      </div>
    </>
  );
}
