"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Muestra una contraseña generada UNA sola vez: no se guarda en ningún lado y
 * desaparece al ocultarla o salir de la página.
 */
export function OneTimePassword({ password, email }: { password: string; email?: string }) {
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState<"ok" | "error" | null>(null);

  if (hidden) {
    return <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">La contraseña temporal se ocultó y ya no puede volver a mostrarse.</p>;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied("ok");
    } catch {
      setCopied("error");
    }
  }

  return (
    <div role="status" className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950">
      <p className="font-semibold">Contraseña temporal{email ? ` de ${email}` : ""}</p>
      <p className="text-sm">Cópiala ahora: se muestra una sola vez y no queda guardada en la plataforma. Entrégala solo a la persona titular por un medio seguro.</p>
      <p className="select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-lg tracking-wide text-gray-900 ring-1 ring-amber-300" aria-label="Contraseña temporal">
        {password}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={copy}>Copiar contraseña</Button>
        <Button variant="outline" onClick={() => setHidden(true)}>
          Ya la copié, ocultar
        </Button>
        {copied === "ok" ? <span className="text-sm font-medium">Copiada al portapapeles.</span> : null}
        {copied === "error" ? <span className="text-sm font-medium">No se pudo copiar; selecciónala y cópiala manualmente.</span> : null}
      </div>
    </div>
  );
}
