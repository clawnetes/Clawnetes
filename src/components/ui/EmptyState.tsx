import { memo } from "react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  align?: "center" | "left";
}

function EmptyState({ icon, title, description, action, className = "", align = "center" }: EmptyStateProps) {
  const alignmentClassName = align === "left"
    ? "items-start text-left"
    : "items-center justify-center text-center";

  return (
    <div className={`flex flex-col gap-3 py-8 px-4 ${alignmentClassName} ${className}`}>
      {icon && (
        <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-surface-hover text-t-muted">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-t-main">{title}</p>
        {description && <p className="text-xs text-t-muted max-w-[280px]">{description}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors duration-150"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export default memo(EmptyState);
