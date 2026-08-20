import React, { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "../../lib/cn";

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

const ToastContext = createContext<{ push: (type: Toast["type"], message: string) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
const styles = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-accent-200 bg-accent-50 text-accent-800"
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((type: Toast["type"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-full max-w-sm">
        {toasts.map((t) => {
          const Icon = icons[t.type];
          return (
            <div key={t.id} className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] shadow-elevated animate-slide-up", styles[t.type])}>
              <Icon size={16} className="flex-none mt-0.5" />
              <div className="flex-1 leading-relaxed">{t.message}</div>
              <button onClick={() => dismiss(t.id)} className="flex-none opacity-60 hover:opacity-100">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
