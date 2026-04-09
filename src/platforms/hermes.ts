import type { PlatformDefinition } from "./openclaw";

export const HERMES_PLATFORM: PlatformDefinition = {
  id: "hermes",
  label: "Hermes Agent",
  description: "A separate Hermes-specific setup flow with API-server-backed chat.",
  supportsRemote: true,
  supportsLocalWindows: true,
  chatTransport: "hermes-api",
  defaultEnvironmentName: "Local Hermes",
  helperText: "Windows uses a WSL2-managed workflow for v1. Remote Linux is supported over SSH.",
};
