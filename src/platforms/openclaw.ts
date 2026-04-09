import type { AgentPlatform, ChatTransportKind } from "./types";

export interface PlatformDefinition {
  id: AgentPlatform;
  label: string;
  description: string;
  supportsRemote: boolean;
  supportsLocalWindows: boolean;
  chatTransport: ChatTransportKind;
  defaultEnvironmentName: string;
  helperText: string;
}

export const OPENCLAW_PLATFORM: PlatformDefinition = {
  id: "openclaw",
  label: "OpenClaw",
  description: "The current Clawnetes-native flow with gateway websocket chat.",
  supportsRemote: true,
  supportsLocalWindows: true,
  chatTransport: "openclaw-gateway",
  defaultEnvironmentName: "Local OpenClaw",
  helperText: "Best fit if you want the existing Clawnetes setup and gateway workflow.",
};
