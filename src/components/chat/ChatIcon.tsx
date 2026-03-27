import type { ButtonHTMLAttributes, ReactNode } from "react";

export default function ChatIcon({ name }: { name: string }) {
  switch (name) {
    case "plus":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M8 3v10" />
          <path d="M3 8h10" />
        </svg>
      );
    case "sliders":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 4h10" />
          <path d="M5 8h8" />
          <path d="M3 12h10" />
          <circle cx="6" cy="4" r="1.25" />
          <circle cx="10" cy="8" r="1.25" />
          <circle cx="8" cy="12" r="1.25" />
        </svg>
      );
    case "reset":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2" />
          <path d="M3.5 4.5v3h3" />
        </svg>
      );
    case "reconnect":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M13 5.5V3h-2.5" />
          <path d="M3 10.5V13h2.5" />
          <path d="M12.2 7A4.5 4.5 0 0 0 4 5.4" />
          <path d="M3.8 9A4.5 4.5 0 0 0 12 10.6" />
        </svg>
      );
    case "sun":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1.75v1.5" />
          <path d="M8 12.75v1.5" />
          <path d="M1.75 8h1.5" />
          <path d="M12.75 8h1.5" />
          <path d="M3.35 3.35l1.05 1.05" />
          <path d="M11.6 11.6l1.05 1.05" />
          <path d="M12.65 3.35L11.6 4.4" />
          <path d="M4.4 11.6l-1.05 1.05" />
        </svg>
      );
    case "moon":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M10.8 2.2A5.8 5.8 0 1 0 13.8 11 5.2 5.2 0 0 1 10.8 2.2Z" />
        </svg>
      );
    case "system":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <rect x="2.5" y="3" width="11" height="8" rx="1.5" />
          <path d="M6 13h4" />
          <path d="M8 11v2" />
        </svg>
      );
    case "spark":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5Z" />
        </svg>
      );
    case "note":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 3.5h10" />
          <path d="M3 7.5h10" />
          <path d="M3 11.5h7" />
        </svg>
      );
    case "plan":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 4.5h10" />
          <path d="M3 8h10" />
          <path d="M3 11.5h6.5" />
          <circle cx="11.75" cy="11.5" r="1.25" />
        </svg>
      );
    case "chat":
    default:
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v4A1.5 1.5 0 0 1 11.5 10h-4l-2.75 2v-2H4.5A1.5 1.5 0 0 1 3 8.5Z" />
        </svg>
      );
  }
}

export function ChatActionButton({
  icon,
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
}) {
  return (
    <button className={`chat-action-button ${className || ""}`.trim()} {...props}>
      <span className="chat-button-icon">{icon}</span>
      <span className="chat-button-label">{children || label}</span>
    </button>
  );
}
