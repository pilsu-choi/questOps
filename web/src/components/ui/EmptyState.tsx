import React from "react";
import { cn } from "../../lib/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-16 px-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/50", className)}>
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <div className="text-[15px] font-medium text-slate-700">{title}</div>
      {description && <p className="mt-1.5 text-[13px] text-slate-500 max-w-md leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
