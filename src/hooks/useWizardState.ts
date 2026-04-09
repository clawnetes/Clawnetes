import { useReducer } from "react";
import type { AgentConfigData, AgentTypeId, BusinessFunctionId, CronJobConfig, ProviderAuthConfig, ToolPolicy } from "../types";
import type { AgentPlatform } from "../platforms/types";
import { DEFAULT_TOOL_POLICY } from "../utils/toolSelection";
import { createDefaultProviderAuth } from "../utils/providerAuth";
import type { MessagingChannel } from "../utils/messagingPairing";

import { loadEnvironments, getActiveEnvironmentId } from "../lib/environmentStorage";

export interface WizardState {
  // Navigation
  step: number;
  mode: string;
  skipBasicConfig: boolean;
  platform: AgentPlatform;

  // Environment
  targetEnvironment: string;

  // SSH
  remoteIp: string;
  remoteUser: string;
  remotePassword: string;
  remotePrivateKeyPath: string;
  sshStatus: "idle" | "checking" | "requesting_password" | "success" | "error";
  sshError: string;
  tunnelActive: boolean;

  // System
  checks: { node: boolean; docker: boolean; openclaw: boolean };
  loading: boolean;
  error: boolean;
  logs: string;
  installingNode: boolean;
  nodeInstallError: string;
  openClawVersion: string;

  // Form / Identity
  userName: string;
  agentName: string;
  selectedPersona: string;
  agentEmoji: string;
  agentType: AgentTypeId;

  // Brain / Auth
  apiKey: string;
  authMethod: string;
  provider: string;
  model: string;

  // Messaging
  telegramToken: string;
  messagingChannel: MessagingChannel;
  whatsappDmPolicy: string;
  whatsappPhoneNumber: string;
  whatsappPhoneSubmitted: boolean;
  whatsappQrDataUrl: string;
  whatsappPaired: boolean;
  whatsappQrStep: boolean;
  whatsappQrLoading: boolean;

  // Pairing
  pairingCode: string;
  pairingInput: string;
  pairingStatus: string;
  isPaired: boolean;

  // Progress / Deploy
  progress: string;
  dashboardUrl: string;

  // Maintenance
  maintenanceStatus: string;
  selectedMaint: string;
  maintCompleted: boolean;

  // License
  showLicenseModal: boolean;
  licenseKey: string;
  verifyingLicense: boolean;
  licenseError: string;
  licenseUnlocked: boolean;
  licenseStatusLoaded: boolean;
  licenseStatusError: string;

  // Provider Auth
  serviceKeys: Record<string, string>;
  providerAuths: Record<string, ProviderAuthConfig>;
  providerAuthBusy: Record<string, boolean>;
  providerAuthErrors: Record<string, string>;
  oauthCompletionRunning: boolean;
  oauthCompletionStarted: boolean;
  oauthCompletionResults: Record<string, { status: "pending" | "success" | "error"; message?: string }>;
  currentServiceIdx: number;
  isConfiguringService: boolean | null;

  // Advanced / Gateway
  gatewayPort: number;
  gatewayBind: string;
  gatewayAuthMode: string;
  tailscaleMode: string;
  nodeManager: string;

  // Skills
  selectedSkills: string[];

  // Security
  sandboxMode: string;
  toolPolicy: ToolPolicy;

  // Fallback
  enableFallbacks: boolean;
  fallbackModels: string[];

  // Session
  heartbeatMode: string;
  idleTimeoutMs: number;

  // Markdown
  toolsMd: string;
  agentsMd: string;
  heartbeatMd: string;
  memoryMd: string;
  memoryEnabled: boolean;
  identityMd: string;
  userMd: string;
  soulMd: string;

  // Workspace
  activeWorkspaceTab: string;
  initialWorkspace: { identity: string; user: string; soul: string };
  workspaceModified: boolean;
  savingWorkspace: boolean;

  // Custom Skills
  customSkillName: string;
  customSkillContent: string;
  showCustomSkillForm: boolean;

  // Business Functions
  selectedBusinessFunctions: BusinessFunctionId[];
  cronJobs: CronJobConfig[];

  // Extra Settings
  extraSettingsOpen: Record<string, boolean>;

  // Multi-Agent
  enableMultiAgent: boolean;
  numAgents: number;
  agentConfigs: AgentConfigData[];
  currentAgentConfigIdx: number;

  // Local Models
  ollamaModels: string[];
  ollamaDetecting: boolean;
  lmstudioBaseUrl: string;
  lmstudioModels: string[];
  lmstudioDetecting: boolean;
  localBaseUrl: string;
  localModels: string[];
  localDetecting: boolean;

  // Thinking
  thinkingLevel: string;

  // Validation
  validateOutput: string;
  validating: boolean;
  // Hermes
  hermesMaxTurns: number;
  hermesReasoningEffort: string;
  hermesPersonality: string;
  hermesTerminalBackend: string;
  hermesMemoryEnabled: boolean;
  hermesVerbose: boolean;
  hermesSmartRouting: boolean;
  hermesModelBaseUrl: string;
  hermesApiServerEnabled: boolean;
  hermesApiServerKey: string;
  hermesApiServerCorsOrigins: string;
  hermesRawConfigYaml: string;
  hermesRawEnv: string;
}

export const INITIAL_WIZARD_STATE: WizardState = {
  step: 0.5,
  mode: "basic",
  skipBasicConfig: false,
  platform: "openclaw",
  targetEnvironment: "local",
  remoteIp: "",
  remoteUser: "",
  remotePassword: "",
  remotePrivateKeyPath: "",
  sshStatus: "idle",
  sshError: "",
  tunnelActive: false,
  checks: { node: false, docker: false, openclaw: false },
  loading: false,
  error: false,
  logs: "",
  installingNode: false,
  nodeInstallError: "",
  openClawVersion: "Checking...",
  userName: "",
  agentName: "",
  selectedPersona: "custom",
  agentEmoji: "🦞",
  agentType: "custom",
  apiKey: "",
  authMethod: "token",
  provider: "anthropic",
  model: "anthropic/claude-opus-4-6",
  telegramToken: "",
  messagingChannel: "telegram",
  whatsappDmPolicy: "allowlist",
  whatsappPhoneNumber: "",
  whatsappPhoneSubmitted: false,
  whatsappQrDataUrl: "",
  whatsappPaired: false,
  whatsappQrStep: false,
  whatsappQrLoading: false,
  pairingCode: "",
  pairingInput: "",
  pairingStatus: "",
  isPaired: false,
  progress: "",
  dashboardUrl: "http://127.0.0.1:18789",
  maintenanceStatus: "",
  selectedMaint: "repair",
  maintCompleted: false,
  showLicenseModal: false,
  licenseKey: "",
  verifyingLicense: false,
  licenseError: "",
  licenseUnlocked: false,
  licenseStatusLoaded: false,
  licenseStatusError: "",
  serviceKeys: {},
  providerAuths: { anthropic: createDefaultProviderAuth("anthropic") },
  providerAuthBusy: {},
  providerAuthErrors: {},
  oauthCompletionRunning: false,
  oauthCompletionStarted: false,
  oauthCompletionResults: {},
  currentServiceIdx: 0,
  isConfiguringService: false,
  gatewayPort: 18789,
  gatewayBind: "loopback",
  gatewayAuthMode: "token",
  tailscaleMode: "off",
  nodeManager: "npm",
  selectedSkills: ["filesystem", "terminal"],
  sandboxMode: "none",
  toolPolicy: DEFAULT_TOOL_POLICY,
  enableFallbacks: false,
  fallbackModels: [],
  heartbeatMode: "1h",
  idleTimeoutMs: 3600000,
  toolsMd: "",
  agentsMd: "",
  heartbeatMd: "",
  memoryMd: "",
  memoryEnabled: false,
  identityMd: "",
  userMd: "",
  soulMd: "",
  activeWorkspaceTab: "identity",
  initialWorkspace: { identity: "", user: "", soul: "" },
  workspaceModified: false,
  savingWorkspace: false,
  customSkillName: "",
  customSkillContent: "",
  showCustomSkillForm: false,
  selectedBusinessFunctions: [],
  cronJobs: [],
  extraSettingsOpen: { gateway: false, runtime: false, security: false, session: false },
  enableMultiAgent: false,
  numAgents: 1,
  agentConfigs: [],
  currentAgentConfigIdx: 0,
  ollamaModels: [],
  ollamaDetecting: false,
  lmstudioBaseUrl: "http://localhost:1234",
  lmstudioModels: [],
  lmstudioDetecting: false,
  localBaseUrl: "http://localhost:8080",
  localModels: [],
  localDetecting: false,
  thinkingLevel: "adaptive",
  validateOutput: "",
  validating: false,
  hermesMaxTurns: 60,
  hermesReasoningEffort: "medium",
  hermesPersonality: "helpful",
  hermesTerminalBackend: "local",
  hermesMemoryEnabled: true,
  hermesVerbose: false,
  hermesSmartRouting: false,
  hermesModelBaseUrl: "",
  hermesApiServerEnabled: true,
  hermesApiServerKey: "",
  hermesApiServerCorsOrigins: "*",
  hermesRawConfigYaml: "",
  hermesRawEnv: "",
};

const PLATFORM_DEFAULTS: Record<AgentPlatform, Pick<WizardState, "gatewayPort" | "gatewayBind" | "gatewayAuthMode">> = {
  openclaw: {
    gatewayPort: 18789,
    gatewayBind: "loopback",
    gatewayAuthMode: "token",
  },
  hermes: {
    gatewayPort: 8642,
    gatewayBind: "127.0.0.1",
    gatewayAuthMode: "token",
  },
};

export type WizardAction =
  | { type: "SET_FIELD"; field: keyof WizardState; value: unknown }
  | { type: "UPDATE_FIELD"; field: keyof WizardState; updater: (prev: unknown) => unknown }
  | { type: "BATCH_UPDATE"; updates: Partial<WizardState> };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_FIELD":
      if (action.field === "platform") {
        const platform = action.value as AgentPlatform;
        return {
          ...state,
          platform,
          ...PLATFORM_DEFAULTS[platform],
        };
      }
      return { ...state, [action.field]: action.value };
    case "UPDATE_FIELD":
      return {
        ...state,
        [action.field]: action.updater(state[action.field]),
      };
    case "BATCH_UPDATE":
      return { ...state, ...action.updates };
    default:
      return state;
  }
}

/** Type-safe setter factory — returns a function matching the useState setter signature. */
export function fieldSetter<K extends keyof WizardState>(
  dispatch: React.Dispatch<WizardAction>,
  field: K,
): (value: WizardState[K] | ((prev: WizardState[K]) => WizardState[K])) => void {
  return (value) => {
    if (typeof value === "function") {
      dispatch({
        type: "UPDATE_FIELD",
        field,
        updater: value as (prev: unknown) => unknown,
      });
      return;
    }

    dispatch({ type: "SET_FIELD", field, value });
  };
}

export function useWizardState() {
  return useReducer(wizardReducer, INITIAL_WIZARD_STATE, (initial) => {
    // Only run in browser
    if (typeof window !== "undefined") {
      try {
        const envs = loadEnvironments();
        const activeId = getActiveEnvironmentId() || (envs[0]?.id ?? null);
        const activeEnv = envs.find((e) => e.id === activeId);
        if (activeEnv) {
          return {
            ...initial,
            platform: activeEnv.platform || "openclaw",
            targetEnvironment: activeEnv.type || "local",
            remoteIp: activeEnv.remoteIp || "",
            remoteUser: activeEnv.remoteUser || "",
            remotePassword: activeEnv.remotePassword || "",
            remotePrivateKeyPath: activeEnv.remotePrivateKeyPath || "",
          };
        }
      } catch (e) {
        console.warn("Failed to load initial environment state:", e);
      }
    }
    return initial;
  });
}
