import React from "react";
import { cn } from "../../lib/cn";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-700 shadow-sm disabled:bg-accent-300",
  secondary: "bg-white text-navy-900 border border-slate-200 hover:bg-slate-50 shadow-sm disabled:opacity-50",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 disabled:opacity-40",
  outline: "bg-transparent text-accent-700 border border-accent-200 hover:bg-accent-50 disabled:opacity-40",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40"
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-[15px] gap-2"
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", loading, icon, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 whitespace-nowrap select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-1",
          "disabled:cursor-not-allowed",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" size={16} /> : icon}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
