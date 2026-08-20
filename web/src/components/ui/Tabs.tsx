import React from "react";
import { cn } from "../../lib/cn";

export function Tabs({
  tabs,
  active,
  onChange
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "relative px-3.5 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
            active === t.id ? "text-accent-700" : "text-slate-500 hover:text-slate-800"
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn("ml-1.5 text-[11px]", active === t.id ? "text-accent-500" : "text-slate-400")}>{t.count}</span>
          )}
          {active === t.id && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-accent-600 rounded-full" />}
        </button>
      ))}
    </div>
  );
}
