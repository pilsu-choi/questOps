import { cn } from "../../lib/cn";

export function Progress({ value, className, tone = "accent" }: { value: number; className?: string; tone?: "accent" | "neutral" }) {
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-slate-100 overflow-hidden", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-500", tone === "accent" ? "bg-accent-500" : "bg-slate-400")}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
