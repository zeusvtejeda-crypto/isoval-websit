import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/attendance/labels";

const tones: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-800 ring-gray-300",
  success: "bg-brand-100 text-brand-900 ring-brand-300",
  info: "bg-sky-50 text-sky-900 ring-sky-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-300",
  danger: "bg-red-50 text-red-900 ring-red-200",
  muted: "bg-white text-gray-600 ring-gray-200",
};

const dots: Record<Tone, string> = {
  neutral: "bg-gray-500",
  success: "bg-brand-700",
  info: "bg-sky-600",
  warning: "bg-amber-500",
  danger: "bg-red-600",
  muted: "bg-gray-300",
};

/** Etiqueta de estado: SIEMPRE con texto; el color es solo apoyo. */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", dots[tone])} />
      {children}
    </span>
  );
}
