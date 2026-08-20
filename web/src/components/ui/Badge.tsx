import React from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "outline";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  accent: "bg-accent-50 text-accent-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-600",
  outline: "bg-transparent text-slate-500 border border-slate-200"
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClasses[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
