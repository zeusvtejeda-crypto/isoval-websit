import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "block min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/30 disabled:bg-gray-100 aria-[invalid=true]:border-red-600";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-800">
        {label}
        {required ? <span className="text-red-700"> *</span> : <span className="font-normal text-gray-500"> (opcional)</span>}
      </label>
      {children}
      {hint ? <p id={`${htmlFor}-hint`} className="text-sm text-gray-500">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24", className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 text-base", className)}>
      <input type="checkbox" className="size-5 rounded border-gray-400 text-brand-800 focus:ring-brand-700" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Mensaje de resultado de un formulario (Server Action). */
export function FormMessage({ state }: { state: { ok?: boolean; message?: string } | null | undefined }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cn("rounded-xl px-3 py-2 text-sm font-medium", state.ok ? "bg-brand-50 text-brand-900" : "bg-red-50 text-red-900")}>
      {state.message}
    </p>
  );
}
