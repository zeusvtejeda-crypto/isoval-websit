"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/form";
import { TEMP_PASSWORD_HINT, type PasswordMode } from "@/lib/admin/accounts";
import { TEMP_PASSWORD_MIN } from "@/lib/admin/password";
import { invalidProps } from "@/lib/admin/use-action-form";

/** Contraseña temporal: generada (recomendado) o capturada a mano. */
export function PasswordFields({ idPrefix, error }: { idPrefix: string; error?: string | null }) {
  const [mode, setMode] = useState<PasswordMode>("generar");
  const [visible, setVisible] = useState(false);
  const inputId = `${idPrefix}-password`;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-gray-800">
        Contraseña temporal<span className="text-red-700"> *</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-gray-300 bg-white p-3 has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50">
          <input
            type="radio"
            name="password_mode"
            value="generar"
            checked={mode === "generar"}
            onChange={() => setMode("generar")}
            className="mt-1 size-5 text-brand-800 focus:ring-brand-700"
          />
          <span>
            <span className="block font-medium">Generar una segura</span>
            <span className="block text-sm text-gray-600">Recomendado. Se mostrará una sola vez al guardar.</span>
          </span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-gray-300 bg-white p-3 has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50">
          <input
            type="radio"
            name="password_mode"
            value="manual"
            checked={mode === "manual"}
            onChange={() => setMode("manual")}
            className="mt-1 size-5 text-brand-800 focus:ring-brand-700"
          />
          <span>
            <span className="block font-medium">Escribirla</span>
            <span className="block text-sm text-gray-600">Mínimo {TEMP_PASSWORD_MIN} caracteres.</span>
          </span>
        </label>
      </div>
      {mode === "manual" ? (
        <Field label="Contraseña temporal" htmlFor={inputId} required hint={TEMP_PASSWORD_HINT} error={error}>
          <div className="flex gap-2">
            <Input
              id={inputId}
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              minLength={TEMP_PASSWORD_MIN}
              required
              spellCheck={false}
              {...invalidProps(error, inputId)}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-pressed={visible}
              className="min-h-11 shrink-0 rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold hover:bg-gray-50"
            >
              {visible ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </Field>
      ) : error ? (
        <p className="text-sm font-medium text-red-700">{error}</p>
      ) : null}
    </fieldset>
  );
}
