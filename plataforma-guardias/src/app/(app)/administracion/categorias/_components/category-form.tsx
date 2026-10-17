"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Checkbox, Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import {
  CATEGORY_DESCRIPTION_MAX,
  CATEGORY_ICONS,
  CATEGORY_NAME_MAX,
  CATEGORY_NAME_MIN,
  CATEGORY_ORDER_MAX,
  CATEGORY_SLUG_MAX,
  EMPTY_CATEGORY_FORM,
  categoryIconLabel,
  slugify,
  type CategoryFormDefaults,
} from "@/lib/validation/facility";
import { ReasonField } from "../../_components/reason-field";

type CategoryAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;


function invalidProps(error: string | null | undefined, id: string) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

/** Alta y edición de categorías. Tras crear, el formulario se limpia. */
export function CategoryForm({
  action,
  categoryId,
  defaults,
  cancelHref,
}: {
  action: CategoryAction;
  categoryId?: number;
  defaults: CategoryFormDefaults;
  cancelHref?: string;
}) {
  const isEdit = categoryId !== undefined;
  const prefix = isEdit ? "cat-edit" : "cat-new";
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const [name, setName] = useState(defaults.name);
  const [slug, setSlug] = useState(defaults.slug);
  const [color, setColor] = useState(defaults.color);
  const [icon, setIcon] = useState(defaults.icon);
  const [formKey, setFormKey] = useState(0);
  const [handledState, setHandledState] = useState(state);
  const err = (field: string) => (state && !state.ok ? (state.fieldErrors?.[field] ?? null) : null);
  const suggestedSlug = slugify(name);

  // Tras crear una categoría se limpia el formulario (ajuste de estado durante el render).
  if (state !== handledState) {
    setHandledState(state);
    if (state?.ok && !isEdit) {
      setName("");
      setSlug("");
      setColor(EMPTY_CATEGORY_FORM.color);
      setIcon(EMPTY_CATEGORY_FORM.icon);
      setFormKey((k) => k + 1);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form key={formKey} action={formAction} onSubmit={onSubmit} className="space-y-4">
      {isEdit ? <input type="hidden" name="id" value={categoryId} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" htmlFor={`${prefix}-name`} required error={err("name")}>
          <Input
            id={`${prefix}-name`}
            name="name"
            required
            minLength={CATEGORY_NAME_MIN}
            maxLength={CATEGORY_NAME_MAX}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            {...invalidProps(err("name"), `${prefix}-name`)}
          />
        </Field>
        <Field
          label="Identificador (slug)"
          htmlFor={`${prefix}-slug`}
          error={err("slug")}
          hint={
            slug
              ? "Minúsculas sin acentos, números y guiones. Se usa en la importación y en los filtros del directorio."
              : suggestedSlug
                ? `Si lo dejas vacío se usará «${suggestedSlug}».`
                : "Si lo dejas vacío se genera a partir del nombre."
          }
        >
          <Input
            id={`${prefix}-slug`}
            name="slug"
            maxLength={CATEGORY_SLUG_MAX}
            autoComplete="off"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            placeholder={suggestedSlug || undefined}
            value={slug}
            onChange={(e) => setSlug(e.currentTarget.value)}
            {...invalidProps(err("slug"), `${prefix}-slug`)}
          />
        </Field>
      </div>

      <Field label="Descripción" htmlFor={`${prefix}-description`} error={err("description")}>
        <Textarea
          id={`${prefix}-description`}
          name="description"
          maxLength={CATEGORY_DESCRIPTION_MAX}
          className="min-h-16"
          defaultValue={defaults.description}
          {...invalidProps(err("description"), `${prefix}-description`)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Icono" htmlFor={`${prefix}-icon`} required error={err("icon")}>
          <Select id={`${prefix}-icon`} name="icon" required value={icon} onChange={(e) => setIcon(e.currentTarget.value)} {...invalidProps(err("icon"), `${prefix}-icon`)}>
            {CATEGORY_ICONS.some((i) => i.value === icon) ? null : (
              <option value={icon} disabled>
                {icon} (no está en la lista; elige otro)
              </option>
            )}
            {CATEGORY_ICONS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Color" htmlFor={`${prefix}-color`} required error={err("color")} hint={color.toUpperCase()}>
          <input
            id={`${prefix}-color`}
            name="color"
            type="color"
            required
            value={color}
            onChange={(e) => setColor(e.currentTarget.value)}
            className="block h-11 w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-1"
            {...invalidProps(err("color"), `${prefix}-color`)}
          />
        </Field>
        <Field label="Orden" htmlFor={`${prefix}-order`} error={err("sort_order")} hint="Menor número = aparece antes.">
          <Input
            id={`${prefix}-order`}
            name="sort_order"
            type="number"
            inputMode="numeric"
            min={0}
            max={CATEGORY_ORDER_MAX}
            step={1}
            defaultValue={defaults.sort_order}
            {...invalidProps(err("sort_order"), `${prefix}-order`)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" aria-live="polite">
        <span className="text-gray-600">Vista previa:</span>
        <span className="inline-flex items-center gap-2 font-medium text-gray-900">
          <span aria-hidden="true" className="size-4 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color }} />
          {name.trim() || "Nombre de la categoría"}
        </span>
        <span className="text-gray-600">· Icono: {categoryIconLabel(icon)}</span>
      </div>

      <Checkbox name="active" value="1" defaultChecked={defaults.active} label="Activa" />

      <ReasonField
        id={`${prefix}-reason`}
        state={state}
        error={err("reason")}
        required={isEdit}
        hint={isEdit ? "Queda en la bitácora junto con los valores anteriores." : "Si lo dejas vacío se registra «Alta de categoría»."}
      />

      <FormMessage state={state} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" disabled={pending} aria-disabled={pending}>
          {pending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear categoría"}
        </Button>
        {cancelHref ? (
          <Link href={cancelHref} className={buttonClasses("outline", "lg")}>
            Cancelar
          </Link>
        ) : null}
      </div>
    </form>
  );
}
