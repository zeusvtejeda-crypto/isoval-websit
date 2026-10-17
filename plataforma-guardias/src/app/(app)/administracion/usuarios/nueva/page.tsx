import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin, type AppRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { USERS_BASE_PATH } from "@/lib/admin/accounts";
import { facilityChoices, facilityNameMap, loadAllFacilities, loadWorkerOptions, roleOptions } from "@/lib/admin/accounts-server";
import { isGuid } from "@/lib/admin/audit-filters";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { CreateAccountForm } from "../_components/account-forms";

export const metadata: Metadata = { title: "Crear cuenta" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NuevaCuentaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const supabase = await createClient();
  const sp = await searchParams;
  const rawWorker = Array.isArray(sp.trabajador) ? sp.trabajador[0] : sp.trabajador;

  const facilities = await loadAllFacilities(supabase);
  const workerOptions = await loadWorkerOptions(supabase, facilityNameMap(facilities));
  // Alta desde la ficha de un trabajador: ?trabajador=<id>
  const prefill = isGuid(rawWorker) ? workerOptions.find((w) => w.id === rawWorker.toLowerCase()) : undefined;
  const role: AppRole = "trabajador";

  return (
    <>
      <nav aria-label="Ruta" className="mb-2 flex flex-wrap gap-x-4 text-sm">
        <Link href="/administracion" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          ← Administración
        </Link>
        <Link href={USERS_BASE_PATH} className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          Usuarios y permisos
        </Link>
      </nav>
      <PageHeader title="Crear cuenta" description="La cuenta se crea con el correo confirmado y una contraseña temporal. No se envían correos automáticos." />
      {rawWorker && !prefill ? (
        <Alert tone="warning" className="mb-4" title="No se pudo preseleccionar el trabajador">
          El trabajador indicado no existe, está inactivo o ya tiene una cuenta de acceso.
        </Alert>
      ) : null}
      <Card className="max-w-3xl">
        <CreateAccountForm
          roleOptions={roleOptions()}
          workerOptions={workerOptions}
          facilityChoices={facilityChoices(facilities)}
          defaults={{ email: "", display_name: prefill?.fullName ?? "", role, worker_id: prefill?.id ?? null }}
        />
      </Card>
    </>
  );
}
