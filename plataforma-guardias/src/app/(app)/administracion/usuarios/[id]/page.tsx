import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { USERS_BASE_PATH, accountStatus, isBanned, roleUsesFacilityScopes } from "@/lib/admin/accounts";
import { facilityChoices, facilityNameMap, loadAccountDetail, loadWorkerOptions, roleOptions } from "@/lib/admin/accounts-server";
import { AUDIT_PATH, isGuid } from "@/lib/admin/audit-filters";
import { DEFAULT_TIMEZONE, formatDateTime } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { RoleBadge, StatusBadge } from "../_components/account-badges";
import { EditAccountForm } from "../_components/account-forms";
import { AccountStatusForm } from "../_components/account-status-form";
import { ResetPasswordForm } from "../_components/reset-password-form";

export const metadata: Metadata = { title: "Cuenta de acceso" };

export default async function CuentaPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  const { id: rawId } = await params;
  if (!isGuid(rawId)) notFound();
  const id = rawId.toLowerCase();

  const supabase = await createClient();
  const detail = await loadAccountDetail(supabase, actor, id);
  if (!detail) notFound();
  const { row, facilityIds, facilities, authError } = detail;
  const workerOptions = await loadWorkerOptions(supabase, facilityNameMap(facilities), row.workerId);
  const now = new Date();
  const status = accountStatus(row, now);
  const isSelf = row.id === actor.id;

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
      <PageHeader
        title={row.displayName ?? row.email ?? "Cuenta de acceso"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-all">{row.email ?? "Correo no disponible"}</span>
            <RoleBadge role={row.role} />
            <StatusBadge row={row} now={now} />
            {isSelf ? <span className="text-sm font-medium text-gray-700">(tu cuenta)</span> : null}
          </span>
        }
      />

      <div className="space-y-4">
        {authError ? <Alert tone="warning" title="Sistema de acceso no disponible">{authError}</Alert> : null}
        {status.hint ? <Alert tone="warning">{status.hint}</Alert> : null}
        {row.role === "trabajador" && !row.workerId ? (
          <Alert tone="warning" title="Cuenta sin trabajador vinculado">
            Sin vínculo, la persona no verá guardias ni podrá registrar entradas y salidas.
          </Alert>
        ) : null}
        {roleUsesFacilityScopes(row.role) && facilityIds.length === 0 ? (
          <Alert tone="warning" title="Sin sedes asignadas">
            Con este rol, la cuenta no verá información hasta que le asignes al menos una sede.
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader title="Datos y permisos" description="Nombre visible, rol, trabajador vinculado y sedes asignadas." />
            <EditAccountForm
              userId={row.id}
              roleOptions={roleOptions()}
              workerOptions={workerOptions}
              facilityChoices={facilityChoices(facilities, facilityIds)}
              defaults={{ display_name: row.displayName ?? "", role: row.role, worker_id: row.workerId, facility_ids: facilityIds }}
              lockRole={isSelf}
            />
          </Card>

          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader
                title="Estado de la cuenta"
                description={row.active ? "Al desactivarla se bloquea el inicio de sesión. Sus registros se conservan." : "La cuenta está inactiva y no puede iniciar sesión."}
              />
              <AccountStatusForm userId={row.id} active={row.active} banned={isBanned(row.bannedUntil, now)} isSelf={isSelf} />
            </Card>

            <Card>
              <CardHeader title="Contraseña temporal" description="Restablece la contraseña si la persona la olvidó. La anterior deja de funcionar." />
              {authError && !row.email ? (
                <p className="text-sm text-gray-700">No disponible mientras el sistema de acceso no responda.</p>
              ) : (
                <ResetPasswordForm userId={row.id} email={row.email} />
              )}
            </Card>

            <Card>
              <CardHeader title="Actividad" />
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-gray-500">Alta de la cuenta</dt>
                  <dd>{formatDateTime(row.createdAt, DEFAULT_TIMEZONE)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Último inicio de sesión</dt>
                  <dd>{row.lastSignInAt ? formatDateTime(row.lastSignInAt, DEFAULT_TIMEZONE) : "Nunca"}</dd>
                </div>
              </dl>
              <Link
                href={`${AUDIT_PATH}?autor=${row.id}`}
                className="mt-3 inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2"
              >
                Ver cambios hechos por esta cuenta en la bitácora
              </Link>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
