import React from "react";
import { cn } from "../../lib/cn";

export function Field({
  label,
  hint,
  children,
  required,
  className
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-slate-700">
        {label}
        {required && <span className="text-accent-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="text-[12px] text-slate-400">{hint}</span>}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-navy-900 placeholder:text-slate-400",
      "focus:outline-none focus:ring-2 focus:ring-accent-200 focus:border-accent-400 transition-shadow",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder:text-slate-400 leading-relaxed",
        "focus:outline-none focus:ring-2 focus:ring-accent-200 focus:border-accent-400 transition-shadow resize-none",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-navy-900",
      "focus:outline-none focus:ring-2 focus:ring-accent-200 focus:border-accent-400 transition-shadow",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
