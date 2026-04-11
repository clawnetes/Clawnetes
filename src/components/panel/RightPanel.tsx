import { memo } from "react";
import type { AgentPlatform, ProviderAuthConfig, ToolPolicy } from "../../types";
import { useChatPanel, type PanelView } from "../../context/ChatPanelContext";
import TabBar from "../ui/TabBar";
import ModelSwitcherPanel from "./ModelSwitcherPanel";
import SkillsPanel from "./SkillsPanel";
import IdentityEditorPanel, { type IdentityTab } from "./IdentityEditorPanel";
import SettingsPanel from "./SettingsPanel";
import ToolsPanel from "./ToolsPanel";
import { HERMES_SUPPORTED_MODEL_PROVIDERS } from "../../platforms/hermes";

const PANEL_TABS: { id: PanelView; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "skills", label: "Skills" },
  { id: "identity", label: "Identity" },
  { id: "tools", label: "Tools" },
  { id: "advanced", label: "Advanced" },
];

const PANEL_PLACEHOLDERS: Record<PanelView, string> = {
  model: "Model selection and fallback configuration will appear here.",
  skills: "Skills and tool management will appear here.",
  identity: "Agent identity and persona editor will appear here.",
  tools: "Tool access policy and permissions will appear here.",
  advanced: "Gateway, environment, and advanced settings will appear here.",
};

interface RightPanelProps {
  activeAgentName?: string;
  activeAgentEmoji?: string;
  modelRef?: string;
  fallbackModels?: string[];
  localBaseUrl?: string;
  lmstudioBaseUrl?: string;
  skills?: string[];
  onModelChange?: (model: string) => void | Promise<void>;
  onFallbacksChange?: (models: string[]) => void | Promise<void>;
  onLocalBaseUrlChange?: (provider: "lmstudio" | "local", baseUrl: string) => void | Promise<void>;
  providerAuths?: Record<string, ProviderAuthConfig>;
  onProviderAuthChange?: (provider: string, auth: ProviderAuthConfig) => void | Promise<void>;
  onStartOAuth?: (provider: string, authMethod: string, oauthProviderId: string) => Promise<ProviderAuthConfig>;
  onDetectLocalModels?: (provider: "ollama" | "lmstudio" | "local", baseUrl?: string) => Promise<string[]>;
  activeSkills?: string[];
  serviceKeys?: Record<string, string>;
  onSaveSkillsConfig?: (skills: string[], serviceKeys: Record<string, string>) => void;
  skillsSaving?: boolean;
  onSetupIntegration?: (skillId: string) => void;
  // Identity editor props
  identityMd?: string;
  soulMd?: string;
  toolsMd?: string;
  agentsMd?: string;
  heartbeatMd?: string;
  memoryMd?: string;
  onIdentitySave?: (tab: IdentityTab, content: string) => void;
  identitySaving?: boolean;
  // Settings props
  targetEnvironment?: string;
  remoteSummary?: string;
  gatewayPort?: number;
  gatewayBind?: string;
  gatewayAuthMode?: string;
  heartbeatMode?: string;
  sandboxMode?: string;
  toolPolicy?: ToolPolicy;
  toolsSaving?: boolean;
  settingsBusy?: boolean;
  idleTimeoutMs?: number;
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
  onSaveToolPolicy?: (policy: ToolPolicy) => void;
  onSaveAdvancedSettings?: (heartbeatMode: string, idleTimeoutMs: number, sandboxMode: string) => void;
  onSaveHermesSettings?: (updates: Record<string, any>) => void;
  maintenanceStatus?: string;
  onRepair?: () => void;
  onAudit?: () => void;
  onUpgrade?: () => void;
  onReconfigure?: () => void;
  onUninstall?: () => void;
  platform?: AgentPlatform;
}

function RightPanel({
  activeAgentName,
  activeAgentEmoji,
  modelRef,
  fallbackModels = [],
  localBaseUrl = "",
  lmstudioBaseUrl = "",
  skills = [],
  onModelChange,
  onFallbacksChange,
  onLocalBaseUrlChange,
  providerAuths = {},
  onProviderAuthChange,
  onStartOAuth,
  onDetectLocalModels,
  activeSkills = [],
  serviceKeys = {},
  onSaveSkillsConfig,
  skillsSaving,
  onSetupIntegration,
  identityMd,
  soulMd,
  toolsMd,
  agentsMd,
  heartbeatMd,
  memoryMd,
  onIdentitySave,
  identitySaving,
  targetEnvironment,
  remoteSummary,
  gatewayPort,
  gatewayBind,
  gatewayAuthMode,
  heartbeatMode,
  sandboxMode,
  toolPolicy,
  toolsSaving,
  settingsBusy,
  idleTimeoutMs,
  hermesMaxTurns,
  hermesReasoningEffort,
  hermesPersonality,
  hermesTerminalBackend,
  hermesMemoryEnabled,
  hermesVerbose,
  hermesSmartRouting,
  hermesModelBaseUrl,
  hermesApiServerEnabled,
  hermesApiServerKey,
  hermesApiServerCorsOrigins,
  hermesRawConfigYaml,
  hermesRawEnv,
  onSaveToolPolicy,
  onSaveAdvancedSettings,
  onSaveHermesSettings,
  maintenanceStatus,
  onRepair,
  onAudit,
  onUpgrade,
  onReconfigure,
  onUninstall,
  platform,
}: RightPanelProps) {
  const { panelOpen, panelView, setPanelView, closePanel } = useChatPanel();

  function renderPanelContent() {
    switch (panelView) {
      case "model":
        return (
          <ModelSwitcherPanel
            currentModel={modelRef || ""}
            fallbackModels={fallbackModels}
            allowedProviders={platform === "hermes" ? [...HERMES_SUPPORTED_MODEL_PROVIDERS] : undefined}
            currentLocalBaseUrl={localBaseUrl}
            currentLmstudioBaseUrl={lmstudioBaseUrl}
            onModelChange={onModelChange}
            onFallbacksChange={onFallbacksChange}
            onLocalBaseUrlChange={onLocalBaseUrlChange}
            providerAuths={providerAuths}
            onProviderAuthChange={onProviderAuthChange}
            onStartOAuth={onStartOAuth}
            onDetectLocalModels={onDetectLocalModels}
          />
        );
      case "skills":
        return (
          <SkillsPanel
            activeSkills={activeSkills}
            serviceKeys={serviceKeys}
            onSaveSkillsConfig={onSaveSkillsConfig}
            saving={skillsSaving}
          />
        );
      case "identity":
        return (
          <IdentityEditorPanel
            identityMd={identityMd}
            soulMd={soulMd}
            toolsMd={toolsMd}
            agentsMd={agentsMd}
            heartbeatMd={heartbeatMd}
            memoryMd={memoryMd}
            onSave={onIdentitySave}
            saving={identitySaving}
          />
        );
      case "tools":
        return (
          <ToolsPanel
            toolPolicy={toolPolicy || { profile: "minimal", allow: [], deny: [] }}
            onSaveToolPolicy={onSaveToolPolicy}
            saving={toolsSaving}
          />
        );
      case "advanced":
        return (
          <SettingsPanel
            platform={platform}
            targetEnvironment={targetEnvironment}
            remoteSummary={remoteSummary}
            gatewayPort={gatewayPort}
            gatewayBind={gatewayBind}
            gatewayAuthMode={gatewayAuthMode}
            heartbeatMode={heartbeatMode}
            sandboxMode={sandboxMode}
            busy={settingsBusy}
            maintenanceStatus={maintenanceStatus}
            onRepair={onRepair}
            onAudit={onAudit}
            onUpgrade={onUpgrade}
            onReconfigure={onReconfigure}
            onUninstall={onUninstall}
            idleTimeoutMs={idleTimeoutMs}
            hermesMaxTurns={hermesMaxTurns}
            hermesReasoningEffort={hermesReasoningEffort}
            hermesPersonality={hermesPersonality}
            hermesTerminalBackend={hermesTerminalBackend}
            hermesMemoryEnabled={hermesMemoryEnabled}
            hermesVerbose={hermesVerbose}
            hermesSmartRouting={hermesSmartRouting}
            hermesModelBaseUrl={hermesModelBaseUrl}
            hermesApiServerEnabled={hermesApiServerEnabled}
            hermesApiServerKey={hermesApiServerKey}
            hermesApiServerCorsOrigins={hermesApiServerCorsOrigins}
            hermesRawConfigYaml={hermesRawConfigYaml}
            hermesRawEnv={hermesRawEnv}
            onSaveAgentSettings={onSaveAdvancedSettings}
            onSaveHermesSettings={onSaveHermesSettings}
          />
        );
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-10 h-10 rounded-lg bg-[var(--surface-hover)] flex items-center justify-center mb-3">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-[var(--text-muted)]" aria-hidden="true">
                <path d="M3 4h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M5 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M3 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="6" cy="4" r="1.25" fill="currentColor" />
                <circle cx="10" cy="8" r="1.25" fill="currentColor" />
                <circle cx="8" cy="12" r="1.25" fill="currentColor" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--text-main)] mb-1 capitalize">
              {panelView}
            </p>
            <p className="text-xs text-[var(--text-muted)] max-w-[220px] leading-relaxed">
              {PANEL_PLACEHOLDERS[panelView]}
            </p>
          </div>
        );
    }
  }

  return (
    <div
      className="right-panel-fullpage flex flex-col bg-[var(--surface-panel)] overflow-hidden"
      data-testid="right-panel"
    >
      {/* Panel header with back button and active agent badge */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-0">
        <button
          type="button"
          onClick={closePanel}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-[var(--surface-hover)] text-[var(--text-subtle)] text-sm font-medium transition-colors"
          aria-label="Back to app"
          data-testid="right-panel-close"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to app
        </button>
        <h3 className="text-xs font-semibold text-[var(--text-subtle)] uppercase tracking-wider">
          Configuration
        </h3>
        {/* Read-only active agent badge */}
        <span
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--surface-hover)] text-[var(--text-main)] text-sm font-medium"
          data-testid="agent-badge"
        >
          {activeAgentEmoji || "🤖"} {activeAgentName || "Agent"}
        </span>
      </div>

      {/* Tab navigation */}
      <TabBar
        tabs={platform === "hermes" ? [
          { id: "model", label: "Model" },
          { id: "advanced", label: "Settings" },
        ] : PANEL_TABS}
        activeTab={panelView}
        onTabChange={(tabId) => setPanelView(tabId as PanelView)}
        className="px-1 mt-2"
      />

      {/* Panel content area */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {renderPanelContent()}
        </div>
      </div>
    </div>
  );
}

export default memo(RightPanel);
