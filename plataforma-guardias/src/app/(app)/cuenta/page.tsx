import type { Metadata } from "next";
import { requireUser, ROLE_LABELS } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function CuentaPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Mi cuenta" description="Datos de tu cuenta de acceso." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Datos" />
          <dl className="space-y-2">
            <div>
              <dt className="text-sm text-gray-600">Nombre visible</dt>
              <dd className="font-medium">{user.displayName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-600">Correo</dt>
              <dd className="font-medium">{user.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-600">Rol</dt>
              <dd className="font-medium">{ROLE_LABELS[user.role]}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-gray-600">Para cambiar tu nombre, rol o sedes asignadas, contacta a administración.</p>
        </Card>
        <Card>
          <CardHeader title="Cambiar contraseña" description="Mínimo 12 caracteres." />
          <PasswordForm />
        </Card>
      </div>
    </>
  );
}
