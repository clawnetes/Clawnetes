import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: "var(--primary)",
        "primary-hover": "var(--primary-hover)",
        "primary-light": "var(--primary-light)",
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
        },
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          sidebar: "var(--surface-sidebar)",
          panel: "var(--surface-panel)",
          hover: "var(--surface-hover)",
          active: "var(--surface-active)",
        },
        "t-main": "var(--text-main)",
        "t-muted": "var(--text-muted)",
        "t-strong": "var(--text-strong)",
        "t-subtle": "var(--text-subtle)",
        success: "var(--success)",
        error: "var(--error)",
        bubble: {
          user: "var(--bubble-user)",
          "user-border": "var(--bubble-user-border)",
          assistant: "var(--bubble-assistant)",
          system: "var(--bubble-system)",
        },
        border: "var(--border)",
        "input-ring": "var(--input-ring)",
        "sidebar-border": "var(--sidebar-border)",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"Segoe UI"',
          "sans-serif",
        ],
        mono: ['"SF Mono"', '"Fira Code"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "12px",
      },
    },
  },
  plugins: [],
} satisfies Config;
