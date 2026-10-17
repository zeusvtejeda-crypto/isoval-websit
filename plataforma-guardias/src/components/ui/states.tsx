import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[--radius-card] border border-dashed border-gray-300 bg-white px-4 py-10 text-center">
      <p className="text-lg font-semibold text-gray-900">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-prose text-gray-600">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "No se pudo cargar la información", description, action }: { title?: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-[--radius-card] border border-red-200 bg-red-50 px-4 py-6 text-red-900">
      <p className="font-semibold">{title}</p>
      {description ? <p className="mt-1 text-sm">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Cargando…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-200" />
      ))}
    </div>
  );
}

type AlertTone = "info" | "success" | "warning" | "error";
const alertTones: Record<AlertTone, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-950",
  success: "border-brand-200 bg-brand-50 text-brand-950",
  warning: "border-amber-300 bg-amber-50 text-amber-950",
  error: "border-red-200 bg-red-50 text-red-950",
};
const alertTitles: Record<AlertTone, string> = {
  info: "Información",
  success: "Listo",
  warning: "Atención",
  error: "Error",
};

export function Alert({ tone = "info", title, children, className }: { tone?: AlertTone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3", alertTones[tone], className)}>
      <p className="font-semibold">{title ?? alertTitles[tone]}</p>
      {children ? <div className="mt-0.5 text-sm">{children}</div> : null}
    </div>
  );
}
