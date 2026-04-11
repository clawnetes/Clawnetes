import type { AgentConfigData, AgentTypeId, CronJobConfig, ProviderAuthConfig, ToolPolicy } from "../types";
import type { AgentPlatform } from "../platforms/types";
import { applyModelProviderAuth } from "./providerAuth";
import { getSkillIdSet, materializeToolPolicy, normalizeSkillAndToolSelection, normalizeToolPolicy } from "./toolSelection";
import { AVAILABLE_SKILLS } from "../presets/availableSkills";
import { toConfigSandboxMode } from "./sandboxMode";

export interface ConfigPayloadInput {
  platform: AgentPlatform;
  provider: string;
  apiKey: string;
  authMethod: string;
  model: string;
  userName: string;
  agentName: string;
  agentEmoji: string;
  agentType: AgentTypeId;
  telegramToken: string;
  gatewayPort: number;
  gatewayBind: string;
  gatewayAuthMode: string;
  tailscaleMode: string;
  nodeManager: string;
  selectedSkills: string[];
  serviceKeys: Record<string, string>;
  providerAuths: Record<string, ProviderAuthConfig>;
  sandboxMode: string;
  toolPolicy: ToolPolicy;
  enableFallbacks: boolean;
  fallbackModels: string[];
  heartbeatMode: string;
  idleTimeoutMs: number;
  identityMd: string;
  userMd: string;
  soulMd: string;
  toolsMd: string;
  agentsMd: string;
  heartbeatMd: string;
  memoryMd: string;
  memoryEnabled: boolean;
  enableMultiAgent: boolean;
  agentConfigs: AgentConfigData[];
  isPaired: boolean;
  cronJobs: CronJobConfig[];
  localBaseUrl: string;
  lmstudioBaseUrl: string;
  thinkingLevel: string;
  messagingChannel: "none" | "telegram" | "whatsapp";
  whatsappDmPolicy: string;
  whatsappPhoneNumber: string;
  mode: string;
  hermesMaxTurns?: number;
  hermesReasoningEffort?: string;
  hermesPersonality?: string;
  hermesTerminalBackend?: string;
  hermesMemoryEnabled?: boolean;
  hermesVerbose?: boolean;
  hermesSmartRouting?: boolean;
  hermesModelBaseUrl?: string;
  hermesApiServerEnabled?: boolean;
  hermesApiServerKey?: string;
  hermesApiServerCorsOrigins?: string;
  hermesRawConfigYaml?: string;
  hermesRawEnv?: string;
  hermesApplyRawFiles?: boolean;
}

export function buildAgentToolsPayload(
  policy: ToolPolicy,
  inheritedPolicy: ToolPolicy,
  availableSkillIds: Set<string>,
) {
  const normalizedPolicy = normalizeToolPolicy(policy, availableSkillIds);
  if (normalizedPolicy.inherit) {
    return null;
  }

  const materializedPolicy = materializeToolPolicy(normalizedPolicy, inheritedPolicy);
  return {
    profile: materializedPolicy.profile,
    allow: materializedPolicy.allow,
    deny: materializedPolicy.deny,
    elevated: { enabled: materializedPolicy.elevatedEnabled ?? false },
  };
}

export function constructConfigPayload(
  input: ConfigPayloadInput,
  providerAuthsOverride?: Record<string, ProviderAuthConfig>,
) {
  const availableSkillIds = getSkillIdSet(AVAILABLE_SKILLS);
  const mappedSandboxMode = toConfigSandboxMode(input.sandboxMode);
  const defaultIdentity = `# IDENTITY.md - Who Am I?
- **Name:** ${input.agentName}
- **Emoji:** ${input.agentEmoji}
---
Managed by Clawnetes.`;
  const effectiveProviderAuths = providerAuthsOverride || input.providerAuths;

  const isPresetAgent = input.agentType !== "custom";
  const usePresetFields = isPresetAgent || input.mode === "advanced";
  const normalizedTopLevelToolPolicy = normalizeToolPolicy(input.toolPolicy, availableSkillIds);
  const gatewayPort = input.platform === "hermes" && input.gatewayPort === 18789
    ? 8642
    : input.gatewayPort;

  return {
    platform: input.platform,
    provider: input.provider,
    api_key: effectiveProviderAuths[input.provider]?.token || input.apiKey,
    auth_method: effectiveProviderAuths[input.provider]?.auth_method || input.authMethod,
    model: applyModelProviderAuth(input.model, effectiveProviderAuths),
    user_name: input.userName,
    agent_name: input.agentName,
    agent_vibe: "",
    telegram_token: input.telegramToken,
    gateway_port: gatewayPort,
    gateway_bind: input.gatewayBind,
    gateway_auth_mode: input.gatewayAuthMode,
    tailscale_mode: input.tailscaleMode,
    node_manager: input.nodeManager,
    skills: input.selectedSkills,
    service_keys: input.serviceKeys,
    provider_auths: effectiveProviderAuths,
    sandbox_mode: mappedSandboxMode,
    tools_mode: usePresetFields
      ? (normalizedTopLevelToolPolicy.profile === "full" && normalizedTopLevelToolPolicy.allow.length === 0 && normalizedTopLevelToolPolicy.deny.length === 0 ? "all" : "allowlist")
      : "all",
    tools_profile: usePresetFields ? normalizedTopLevelToolPolicy.profile : null,
    allowed_tools: usePresetFields ? normalizedTopLevelToolPolicy.allow : null,
    denied_tools: usePresetFields ? normalizedTopLevelToolPolicy.deny : null,
    fallback_models: usePresetFields && input.enableFallbacks
      ? input.fallbackModels.filter(m => m).map(m => applyModelProviderAuth(m, effectiveProviderAuths))
      : null,
    heartbeat_mode: usePresetFields ? input.heartbeatMode : null,
    idle_timeout_ms: usePresetFields && input.heartbeatMode === "idle" ? input.idleTimeoutMs : null,
    identity_md: (usePresetFields && input.identityMd) ? input.identityMd : defaultIdentity,
    user_md: usePresetFields && input.userMd ? input.userMd : null,
    soul_md: usePresetFields && input.soulMd ? input.soulMd : null,
    agents: input.enableMultiAgent ? input.agentConfigs.map(a => {
      const normalizedAgentSelection = normalizeSkillAndToolSelection(
        a.skills,
        a.toolPolicy.allow,
        availableSkillIds,
      );
      const normalizedAgentToolPolicy = normalizeToolPolicy(a.toolPolicy, availableSkillIds);
      const agentToolsPayload = buildAgentToolsPayload(normalizedAgentToolPolicy, normalizedTopLevelToolPolicy, availableSkillIds);

      return {
        id: a.id,
        name: a.name,
        model: applyModelProviderAuth(a.model, effectiveProviderAuths),
        fallback_models: a.fallbackModels.length > 0
          ? a.fallbackModels.map(m => applyModelProviderAuth(m, effectiveProviderAuths))
          : null,
        skills: normalizedAgentSelection.skills.length > 0 ? normalizedAgentSelection.skills : null,
        vibe: a.vibe,
        identity_md: a.identityMd || `# IDENTITY.md - Who Am I?
- **Name:** ${a.name}
- **Emoji:** ${a.emoji || "🦞"}
---
Managed by Clawnetes.`,
        user_md: a.userMd || null,
        soul_md: a.soulMd || null,
        tools_md: a.toolsMd || null,
        agents_md: a.agentsMd || null,
        heartbeat_md: a.heartbeatMd || null,
        memory_md: a.memoryMd || null,
        heartbeat_mode: a.heartbeatMode || null,
        idle_timeout_ms: a.heartbeatMode === "idle" ? a.idleTimeoutMs : null,
        memory_enabled: a.memoryEnabled || false,
        sandbox_mode: a.sandboxMode || null,
        provider: a.provider || null,
        tools: agentToolsPayload,
      };
    }) : null,
    preserve_state: input.isPaired,
    agent_type: input.agentType,
    tools_md: usePresetFields && input.toolsMd ? input.toolsMd : null,
    agents_md: usePresetFields && input.agentsMd ? input.agentsMd : null,
    heartbeat_md: usePresetFields && input.heartbeatMd ? input.heartbeatMd : null,
    memory_md: usePresetFields && input.memoryMd ? input.memoryMd : null,
    memory_enabled: usePresetFields ? input.memoryEnabled : false,
    cron_jobs: input.cronJobs.length > 0 ? input.cronJobs : null,
    local_base_url: input.provider === "local" ? input.localBaseUrl : (input.provider === "lmstudio" ? input.lmstudioBaseUrl : null),
    thinking_level: (input.provider === "anthropic" && (input.model.includes("claude-") && input.model.includes("-4"))) ? input.thinkingLevel : null,
    whatsapp_enabled: input.messagingChannel === "whatsapp",
    whatsapp_dm_policy: input.messagingChannel === "whatsapp" ? input.whatsappDmPolicy : null,
    whatsapp_phone_number: input.messagingChannel === "whatsapp" ? input.whatsappPhoneNumber : null,
    hermes_max_turns: input.hermesMaxTurns,
    hermes_reasoning_effort: input.hermesReasoningEffort,
    hermes_personality: input.hermesPersonality,
    hermes_terminal_backend: input.hermesTerminalBackend,
    hermes_memory_enabled: input.hermesMemoryEnabled,
    hermes_verbose: input.hermesVerbose,
    hermes_smart_routing: input.hermesSmartRouting,
    hermes_model_base_url: input.hermesModelBaseUrl,
    hermes_api_server_enabled: input.hermesApiServerEnabled,
    hermes_api_server_key: input.hermesApiServerKey,
    hermes_api_server_cors_origins: input.hermesApiServerCorsOrigins,
    hermes_raw_config_yaml: input.hermesRawConfigYaml,
    hermes_raw_env: input.hermesRawEnv,
    hermes_apply_raw_files: input.hermesApplyRawFiles,
  };
}
