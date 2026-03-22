export type UiSandboxMode = "none" | "partial" | "full";
export type ConfigSandboxMode = "off" | "non-main" | "all";

export function toConfigSandboxMode(mode: string | null | undefined): ConfigSandboxMode {
  if (mode === "full" || mode === "all") return "all";
  if (mode === "partial" || mode === "non-main") return "non-main";
  return "off";
}

export function toUiSandboxMode(mode: string | null | undefined): UiSandboxMode {
  if (mode === "full" || mode === "all") return "full";
  if (mode === "partial" || mode === "non-main") return "partial";
  return "none";
}
