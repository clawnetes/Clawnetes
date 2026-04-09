import { HERMES_PLATFORM } from "./hermes";
import { OPENCLAW_PLATFORM, type PlatformDefinition } from "./openclaw";

export const PLATFORM_CAPABILITIES: PlatformDefinition[] = [
  OPENCLAW_PLATFORM,
  HERMES_PLATFORM,
];
