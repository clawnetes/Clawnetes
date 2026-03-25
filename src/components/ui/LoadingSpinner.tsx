import { memo } from "react";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}

const sizeClasses = {
  sm: "w-3.5 h-3.5",
  md: "w-5 h-5",
  lg: "w-8 h-8",
};

function LoadingSpinner({ size = "md", className = "", label }: LoadingSpinnerProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        className={`animate-spin text-t-muted ${sizeClasses[size]}`}
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      {label && <span className="text-xs text-t-muted">{label}</span>}
    </div>
  );
}

export default memo(LoadingSpinner);
