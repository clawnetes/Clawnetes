// Shared TypeScript interfaces for Clawnetes

export interface PersonaTemplate {
  name: string;
  identity: string;
  soul: string;
}

export interface ModelOption {
  value: string;
  label: string;
  description?: string;
}

export interface SkillOption {
  id: string;
  name: string;
  desc: string;
  requiresAuth?: boolean;
  authPlaceholder?: string;
  authMode?: "api_key" | "oauth";
  oauthBaseProvider?: string;
  oauthMethod?: string;
  oauthProviderId?: string;
}

export interface RadioCardOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  emoji?: string;
}

export type ToolProfileId = "minimal" | "coding" | "messaging" | "full";

export interface ToolPolicy {
  profile: ToolProfileId | null;
  allow: string[];
  deny: string[];
  elevatedEnabled?: boolean;
  inherit?: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  section: string;
}

export interface AgentConfigData {
  id: string;
  name: string;
  model: string;
  fallbackModels: string[];
  skills: string[];
  vibe: string;
  emoji: string;
  identityMd: string;
  userMd: string;
  soulMd: string;
  toolsMd: string;
  agentsMd: string;
  toolPolicy: ToolPolicy;
  cronJobs: CronJobConfig[];
  persona?: string;
}

export interface StepDef {
  id: number;
  name: string;
  hidden?: boolean;
  advanced?: boolean;
}

export interface ServiceKeyConfig {
  id: string;
  name: string;
  placeholder: string;
}

export interface ProviderAuthConfig {
  auth_method: string;
  token: string;
  profile_key: string | null;
  profile: Record<string, unknown> | null;
  oauth_provider_id: string | null;
}

export interface RemoteConfig {
  ip: string;
  user: string;
  password: string | null;
  privateKeyPath: string | null;
}

// Agent Type Presets
export type AgentTypeId = "coding-assistant" | "office-assistant" | "travel-planner" | "custom";

export interface AgentTypePreset {
  id: AgentTypeId;
  name: string;
  emoji: string;
  description: string;
  provider: string;
  model: string;
  fallbackModels: string[];
  skills: string[];
  sandboxMode: string;
  toolPolicy: ToolPolicy;
  heartbeatMode: string;
  idleTimeoutMs: number;
  enableFallbacks: boolean;
  identityMd: string;
  soulMd: string;
  toolsMd: string;
  agentsMd: string;
  heartbeatMd: string;
  memoryMd: string;
  memoryEnabled: boolean;
}

// Business Function Presets
export type BusinessFunctionId =
  | "personal-productivity"
  | "software-development"
  | "financial-analyst"
  | "social-media"
  | "crm"
  | "customer-support"
  | "custom-team";

export interface SubAgentPreset {
  id: string;
  name: string;
  model: string;
  skills: string[];
  toolPolicy: ToolPolicy;
  identityMd: string;
  soulMd: string;
  toolsMd: string;
  agentsMd: string;
  heartbeatMd: string;
  memoryMd: string;
}

export interface BusinessFunctionPreset {
  id: BusinessFunctionId;
  name: string;
  emoji: string;
  description: string;
  mainAgent: SubAgentPreset;
  subAgents: SubAgentPreset[];
  cronJobs: CronJobConfig[];
}

export interface CronJobConfig {
  name: string;
  schedule: string;
  command: string;
  session?: string;
}

// Config Payload sent to Rust backend
export interface ConfigPayload {
  provider: string;
  api_key: string;
  auth_method: string;
  model: string;
  user_name: string;
  agent_name: string;
  agent_vibe: string;
  telegram_token: string;
  gateway_port: number;
  gateway_bind: string;
  gateway_auth_mode: string;
  tailscale_mode: string;
  node_manager: string;
  skills: string[];
  service_keys: Record<string, string>;
  provider_auths?: Record<string, ProviderAuthConfig>;
  sandbox_mode: string | null;
  tools_mode?: string | null;
  tools_profile?: ToolProfileId | null;
  allowed_tools: string[] | null;
  denied_tools: string[] | null;
  fallback_models: string[] | null;
  heartbeat_mode: string | null;
  idle_timeout_ms: number | null;
  identity_md: string;
  user_md: string | null;
  soul_md: string | null;
  agents: AgentPayloadData[] | null;
  preserve_state: boolean;
  // New fields for presets
  agent_type?: string;
  tools_md?: string | null;
  agents_md?: string | null;
  heartbeat_md?: string | null;
  memory_md?: string | null;
  memory_enabled?: boolean;
  cron_jobs?: CronJobConfig[] | null;
  // Local model support
  local_base_url?: string | null;
  // OpenClaw latest features
  thinking_level?: string | null;
  // WhatsApp channel
  whatsapp_enabled?: boolean;
  whatsapp_dm_policy?: string | null;
}

export interface AgentPayloadData {
  id: string;
  name: string;
  model: string;
  fallback_models: string[] | null;
  skills: string[] | null;
  vibe: string;
  identity_md: string;
  user_md: string | null;
  soul_md: string | null;
  tools_md?: string | null;
  agents_md?: string | null;
  heartbeat_md?: string | null;
  memory_md?: string | null;
  subagents?: {
    allowAgents: string[];
  } | null;
  tools?: {
    profile?: ToolProfileId | null;
    allow?: string[] | null;
    deny?: string[] | null;
    elevated?: { enabled: boolean };
  } | null;
  allowed_tools?: string[] | null;
  denied_tools?: string[] | null;
  tools_profile?: ToolProfileId | null;
}
