"use client";

import Link from "next/link";
import { useState } from "react";
import type { AppRole } from "@/lib/auth";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  EMAIL_MAX,
  REASON_MAX,
  REASON_MIN,
  ROLE_HINTS,
  USERS_BASE_PATH,
  reasonRequired,
  roleAllowsWorker,
  roleUsesFacilityScopes,
  type FacilityChoice,
  type WorkerOption,
} from "@/lib/admin/accounts";
import { invalidProps, useActionForm } from "@/lib/admin/use-action-form";
import { createAccount, updateAccount } from "../actions";
import { FacilityPicker } from "./facility-picker";
import { OneTimePassword } from "./one-time-password";
import { PasswordFields } from "./password-fields";
import { WorkerPicker } from "./worker-picker";

export type RoleOption = { value: AppRole; label: string };

type FieldsProps = {
  idPrefix: string;
  roleOptions: RoleOption[];
  workerOptions: WorkerOption[];
  facilityChoices: FacilityChoice[];
  role: AppRole;
  onRoleChange: (role: AppRole) => void;
  defaults: { display_name: string; worker_id: string | null; facility_ids: string[] };
  fieldError: (field: string) => string | null;
  /** La persona edita su propia cuenta: no puede cambiar su rol. */
  lockRole?: boolean;
  onWorkerChange?: (workerId: string) => void;
  onScopesChange?: (facilityIds: string[]) => void;
};

function AccountFields({
  idPrefix,
  roleOptions,
  workerOptions,
  facilityChoices,
  role,
  onRoleChange,
  defaults,
  fieldError,
  lockRole,
  onWorkerChange,
  onScopesChange,
}: FieldsProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const scoped = roleUsesFacilityScopes(role);
  const allowsWorker = roleAllowsWorker(role);
  return (
    <>
      <Field label="Nombre visible" htmlFor={id("display_name")} required error={fieldError("display_name")} hint="Así aparecerá en la plataforma y en la bitácora.">
        <Input
          id={id("display_name")}
          name="display_name"
          required
          minLength={DISPLAY_NAME_MIN}
          maxLength={DISPLAY_NAME_MAX}
          defaultValue={defaults.display_name}
          autoComplete="off"
          {...invalidProps(fieldError("display_name"), id("display_name"))}
        />
      </Field>

      <Field
        label="Rol"
        htmlFor={id("role")}
        required
        error={fieldError("role")}
        hint={lockRole ? "No puedes cambiar tu propio rol." : ROLE_HINTS[role]}
      >
        <Select
          id={id("role")}
          name={lockRole ? undefined : "role"}
          value={role}
          disabled={lockRole}
          onChange={(e) => onRoleChange(e.currentTarget.value as AppRole)}
          {...invalidProps(fieldError("role"), id("role"))}
        >
          {roleOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {lockRole ? <input type="hidden" name="role" value={role} /> : null}
      </Field>

      {/* Oculto y deshabilitado (no se envía) para auditoría; se conserva la elección si cambia el rol otra vez. */}
      <div hidden={!allowsWorker}>
        <Field
          label="Trabajador vinculado"
          htmlFor={id("worker_id")}
          error={allowsWorker ? fieldError("worker_id") : null}
          hint={
            role === "trabajador"
              ? "Necesario para que la persona vea y registre sus guardias. Solo aparecen trabajadores activos sin cuenta."
              : "Solo si esta persona también cubre guardias. Solo aparecen trabajadores activos sin cuenta."
          }
        >
          <WorkerPicker
            id={id("worker_id")}
            options={workerOptions}
            defaultValue={defaults.worker_id}
            error={allowsWorker ? fieldError("worker_id") : null}
            disabled={!allowsWorker}
            onValueChange={onWorkerChange}
          />
        </Field>
      </div>
      {!allowsWorker ? (
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
          La auditoría es de solo lectura: no se vincula a un trabajador, así que no registra asistencia ni solicita correcciones.
          {idPrefix === "edit" && defaults.worker_id ? " Al guardar se quitará el vínculo con el trabajador actual." : ""}
        </p>
      ) : null}
      {fieldError("worker_id") && !allowsWorker ? <p className="text-sm font-medium text-red-700">{fieldError("worker_id")}</p> : null}

      <div hidden={!scoped}>
        <FacilityPicker
          idPrefix={idPrefix}
          choices={facilityChoices}
          defaultSelected={defaults.facility_ids}
          error={scoped ? fieldError("facility_ids") : null}
          onSelectionChange={onScopesChange}
        />
      </div>
      {role === "admin" ? <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">Administración tiene alcance sobre todas las sedes; no requiere asignación.</p> : null}
    </>
  );
}

const DEFAULT_ROLE: AppRole = "trabajador";

/** Alta de cuenta. Tras crearla se limpia el formulario y se muestra la contraseña generada una vez. */
export function CreateAccountForm({
  roleOptions,
  workerOptions,
  facilityChoices,
  defaults,
}: {
  roleOptions: RoleOption[];
  workerOptions: WorkerOption[];
  facilityChoices: FacilityChoice[];
  defaults: { email: string; display_name: string; role: AppRole; worker_id: string | null };
}) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(createAccount);
  const [role, setRole] = useState<AppRole>(defaults.role);
  const [formKey, setFormKey] = useState(0);
  const [handled, setHandled] = useState(state);
  const created = state?.ok ? state.data : undefined;

  // Tras crear, se limpia el formulario (ajuste de estado durante el render).
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setRole(DEFAULT_ROLE);
      setFormKey((k) => k + 1);
    }
  }

  return (
    <div className="space-y-4">
      {created ? (
        <div className="space-y-3">
          <FormMessage state={state} />
          {created.generatedPassword ? <OneTimePassword password={created.generatedPassword} email={created.email} /> : null}
          <div className="flex flex-wrap gap-2">
            <Link href={`${USERS_BASE_PATH}/${created.userId}`} className={buttonClasses("outline")}>
              Ver la cuenta creada
            </Link>
            <Link href={USERS_BASE_PATH} className={buttonClasses("ghost")}>
              Volver a la lista
            </Link>
          </div>
        </div>
      ) : null}

      <form key={formKey} action={formAction} onSubmit={onSubmit} className="space-y-4">
        <Field label="Correo" htmlFor="new-email" required error={fieldError("email")} hint="Será el usuario para iniciar sesión.">
          <Input
            id="new-email"
            name="email"
            type="email"
            required
            maxLength={EMAIL_MAX}
            defaultValue={formKey === 0 ? defaults.email : ""}
            autoComplete="off"
            inputMode="email"
            spellCheck={false}
            {...invalidProps(fieldError("email"), "new-email")}
          />
        </Field>
        <AccountFields
          idPrefix="new"
          roleOptions={roleOptions}
          workerOptions={workerOptions}
          facilityChoices={facilityChoices}
          role={role}
          onRoleChange={setRole}
          defaults={{
            display_name: formKey === 0 ? defaults.display_name : "",
            worker_id: formKey === 0 ? defaults.worker_id : null,
            facility_ids: [],
          }}
          fieldError={fieldError}
        />
        <PasswordFields idPrefix="new" error={fieldError("password")} />
        {state && !state.ok ? <FormMessage state={state} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" disabled={pending} aria-disabled={pending}>
            {pending ? "Creando cuenta…" : "Crear cuenta"}
          </Button>
          <Link href={USERS_BASE_PATH} className={buttonClasses("outline", "lg")}>
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}

/** Edición de nombre, rol, trabajador vinculado y sedes. */
export function EditAccountForm({
  userId,
  roleOptions,
  workerOptions,
  facilityChoices,
  defaults,
  lockRole,
}: {
  userId: string;
  roleOptions: RoleOption[];
  workerOptions: WorkerOption[];
  facilityChoices: FacilityChoice[];
  defaults: { display_name: string; role: AppRole; worker_id: string | null; facility_ids: string[] };
  lockRole?: boolean;
}) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(updateAccount, {
    confirm: (data) => {
      const next = data.get("role");
      return next && next !== defaults.role ? "Vas a cambiar el rol de esta cuenta y, con él, sus permisos. ¿Continuar?" : null;
    },
  });
  const [role, setRole] = useState<AppRole>(defaults.role);
  const [worker, setWorker] = useState(defaults.worker_id ?? "");
  const [scopes, setScopes] = useState<string[]>(defaults.facility_ids);
  // Misma regla que el servidor: el motivo es obligatorio si cambian el rol, el trabajador o las sedes.
  const needsReason = reasonRequired(
    { role: defaults.role, active: true, worker_id: defaults.worker_id, facility_ids: defaults.facility_ids },
    {
      role,
      active: true,
      worker_id: roleAllowsWorker(role) ? worker || null : null,
      facility_ids: roleUsesFacilityScopes(role) ? scopes : [],
    },
  );
  // Tras guardar se vacía el motivo para que no se reutilice en el siguiente cambio.
  const [reasonKey, setReasonKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setReasonKey((k) => k + 1);
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="user_id" value={userId} />
      <AccountFields
        idPrefix="edit"
        roleOptions={roleOptions}
        workerOptions={workerOptions}
        facilityChoices={facilityChoices}
        role={role}
        onRoleChange={setRole}
        defaults={defaults}
        fieldError={fieldError}
        lockRole={lockRole}
        onWorkerChange={setWorker}
        onScopesChange={setScopes}
      />
      <Field
        label="Motivo del cambio"
        htmlFor="edit-reason"
        required={needsReason}
        error={fieldError("reason")}
        hint={
          needsReason
            ? "Obligatorio: cambian los permisos de la cuenta (rol, trabajador vinculado o sedes). Queda en la bitácora."
            : "Obligatorio si cambias el rol, el trabajador vinculado o las sedes. Queda en la bitácora."
        }
      >
        <Textarea
          key={reasonKey}
          id="edit-reason"
          name="reason"
          required={needsReason}
          minLength={REASON_MIN}
          maxLength={REASON_MAX}
          rows={2}
          {...invalidProps(fieldError("reason"), "edit-reason")}
        />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" size="lg" disabled={pending} aria-disabled={pending}>
        {pending ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}
