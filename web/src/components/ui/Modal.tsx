import React, { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "36rem"
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-navy-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn("relative w-full max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-popover animate-slide-up")}
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-none">
          <h3 className="text-[15px] font-semibold text-navy-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 rounded-md p-1 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
