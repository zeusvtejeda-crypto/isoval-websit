"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/states";
import {
  LEGAL_REVIEW_LABELS,
  LEGAL_REVIEW_STATUSES,
  PRIVACY_BODY_MAX,
  PRIVACY_FIELD_MAX,
  PRIVACY_TITLE_MAX,
  type LegalReviewStatus,
  type PrivacyNotice,
} from "@/lib/admin/settings";
import { invalidProps, useActionForm } from "@/lib/admin/use-action-form";
import { savePrivacyNotice } from "../actions";
import { ReasonField } from "../../_components/reason-field";

export function PrivacyNoticeForm({ notice }: { notice: PrivacyNotice }) {
  const { state, formAction, pending, onSubmit, fieldError } = useActionForm(savePrivacyNotice, {
    confirm: (data) =>
      data.get("legal_review_status") === "aprobado" && notice.legal_review_status !== "aprobado"
        ? "¿Confirmas que el texto ya fue validado por la persona responsable y su asesoría jurídica?"
        : null,
  });
  const [review, setReview] = useState<LegalReviewStatus>(notice.legal_review_status);
  const err = fieldError;

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4">
      {review === "pendiente" ? (
        <Alert tone="warning" title="Pendiente de revisión jurídica">
          Mientras esté pendiente, la página pública muestra que el texto es un borrador. No redactes afirmaciones legales definitivas sin la revisión de
          la persona responsable del tratamiento y su asesoría jurídica.
        </Alert>
      ) : null}

      <Field label="Título" htmlFor="pn-title" required error={err("title")}>
        <Input id="pn-title" name="title" required maxLength={PRIVACY_TITLE_MAX} defaultValue={notice.title} {...invalidProps(err("title"), "pn-title")} />
      </Field>
      <Field label="Texto del aviso" htmlFor="pn-body" required error={err("body")} hint="Se muestra tal cual, respetando los saltos de línea.">
        <Textarea
          id="pn-body"
          name="body"
          required
          rows={14}
          maxLength={PRIVACY_BODY_MAX}
          defaultValue={notice.body}
          {...invalidProps(err("body"), "pn-body")}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Responsable del tratamiento" htmlFor="pn-responsible" error={err("responsible")} hint="Persona u organización responsable de los datos.">
          <Input
            id="pn-responsible"
            name="responsible"
            maxLength={PRIVACY_FIELD_MAX}
            defaultValue={notice.responsible ?? ""}
            {...invalidProps(err("responsible"), "pn-responsible")}
          />
        </Field>
        <Field label="Contacto" htmlFor="pn-contact" error={err("contact")} hint="Medio para dudas sobre el tratamiento de datos.">
          <Input id="pn-contact" name="contact" maxLength={PRIVACY_FIELD_MAX} defaultValue={notice.contact ?? ""} {...invalidProps(err("contact"), "pn-contact")} />
        </Field>
      </div>
      <Field
        label="Estado de la revisión jurídica"
        htmlFor="pn-review"
        required
        error={err("legal_review_status")}
        hint={review === "aprobado" ? "Márcalo como aprobado solo cuando el texto haya sido validado formalmente." : undefined}
      >
        <Select id="pn-review" name="legal_review_status" value={review} onChange={(e) => setReview(e.currentTarget.value as LegalReviewStatus)}>
          {LEGAL_REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LEGAL_REVIEW_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <ReasonField id="pn-reason" state={state} error={err("reason")} />
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-disabled={pending}>
          {pending ? "Guardando…" : "Guardar aviso"}
        </Button>
        <Link href="/aviso-de-privacidad" target="_blank" className="inline-flex min-h-11 items-center font-medium text-brand-800 underline underline-offset-2">
          Ver página pública (pestaña nueva)
        </Link>
      </div>
    </form>
  );
}
