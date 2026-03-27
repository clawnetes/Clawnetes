import { memo } from "react";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

function ToggleSwitch({ checked, onChange, disabled = false, label, className = "" }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[40px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        checked ? "bg-accent" : "bg-[var(--surface-3)] border border-[var(--border)]"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${className}`}
    >
      <span
        className={`pointer-events-none absolute left-[3px] top-1/2 inline-block h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 -translate-y-1/2 ${
          checked ? "translate-x-[18px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default memo(ToggleSwitch);
