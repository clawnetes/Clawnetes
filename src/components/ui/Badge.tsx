import { memo } from "react";

export type BadgeVariant = "active" | "connected" | "disconnected" | "auth-required" | "neutral" | "accent";

const variantClasses: Record<BadgeVariant, string> = {
  active: "bg-success/20 text-success",
  connected: "bg-success/20 text-success",
  disconnected: "bg-error/20 text-error",
  "auth-required": "bg-[#FFD580]/20 text-[#FFD580]",
  neutral: "bg-surface-hover text-t-subtle",
  accent: "bg-accent/20 text-accent",
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

function Badge({ variant = "neutral", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-semibold leading-none whitespace-nowrap ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export default memo(Badge);
