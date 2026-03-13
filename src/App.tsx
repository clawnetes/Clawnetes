import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/shell";
import { open as openDialog } from "@tauri-apps/api/dialog";
import "./App.css";
import { PERSONA_TEMPLATES } from "./presets/personaTemplates";
import { MODELS_BY_PROVIDER, DEFAULT_MODELS, PROVIDER_LOGOS, EMOJI_OPTIONS, SKILL_ICONS } from "./presets/modelsByProvider";
import { AVAILABLE_SKILLS } from "./presets/availableSkills";
import { AGENT_TYPE_PRESETS } from "./presets/agentPresets";
import { BUSINESS_FUNCTION_PRESETS } from "./presets/businessFunctionPresets";
import { updateIdentityField, updateSoulMission } from "./utils/markdownHelpers";
import { getAgentSessionInitIds } from "./utils/agentSessions";
import { applyModelProviderAuth, buildDeferredOAuthQueue, buildReferencedProviders, createDefaultProviderAuth, getBaseProvider, getBaseProviderFromModel, getDefaultModelForProvider, getDisplayModelOptions, getProviderAuthOptions, isOAuthMethod, LOCAL_PROVIDERS, normalizeModelRefForUi, normalizeProviderAuths, OAUTH_METHODS_BY_PROVIDER } from "./utils/providerAuth";
import ToolPolicyEditor from "./components/ToolPolicyEditor";
import { createInheritedToolPolicy, DEFAULT_TOOL_POLICY, deriveToolPolicyFromLegacy, getSkillIdSet, materializeToolPolicy, normalizeSkillAndToolSelection, normalizeToolPolicy } from "./utils/toolSelection";
import Dropdown from "./components/Dropdown";
import type { AgentTypeId, AgentConfigData, BusinessFunctionId, CronJobConfig, ProviderAuthConfig, ToolPolicy } from "./types";

function App() {
  const handleAdvancedTransition = async () => {
    // License key requirement removed for all installation types
    setMode("advanced");
    setPairingStatus("");
    setSkipBasicConfig(true);
    setMaintCompleted(true);
    // When coming from the success screen (step 17), load the just-deployed config as the
    // comparison baseline so that clicking through advanced settings without any changes
    // is correctly detected and does not trigger a redeploy.
    if (step === 17 && !initialConfigRef.current) {
      try {
        const config: any = await invoke("get_current_config", { remote: null });
        initialConfigRef.current = config;
      } catch (e) {
        console.warn("Could not load config baseline for change detection:", e);
      }
    }
    setStep(10.5);
  };

  const [step, setStep] = useState(0.5); // Start at Welcome page
  const [mode, setMode] = useState("basic"); // "basic" or "advanced"
  const initialConfigRef = useRef<any>(null);

  // Environment selection
  const [targetEnvironment, setTargetEnvironment] = useState("local");

  // SSH Remote Configuration
  const [remoteIp, setRemoteIp] = useState("");
  const [remoteUser, setRemoteUser] = useState("");
  const [remotePassword, setRemotePassword] = useState("");
  const [remotePrivateKeyPath, setRemotePrivateKeyPath] = useState("");
  const [sshStatus, setSshStatus] = useState<"idle" | "checking" | "requesting_password" | "success" | "error">("idle");
  const [sshError, setSshError] = useState("");
  const [tunnelActive, setTunnelActive] = useState(false);

  const [checks, setChecks] = useState({ node: false, docker: false, openclaw: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [logs, setLogs] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [installingNode, setInstallingNode] = useState(false);
  const [nodeInstallError, setNodeInstallError] = useState("");

  // Form Data
  const [userName, setUserName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("custom");
  const [agentEmoji, setAgentEmoji] = useState("🦞");
  const [agentType, setAgentType] = useState<AgentTypeId>("custom");
  const [apiKey, setApiKey] = useState("");
  const [authMethod, setAuthMethod] = useState("token");
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("anthropic/claude-opus-4-6");
  const [telegramToken, setTelegramToken] = useState("");
  const [progress, setProgress] = useState("");
  const [dashboardUrl, setDashboardUrl] = useState("http://127.0.0.1:18789");
  const [openClawVersion, setOpenClawVersion] = useState("Checking...");
  const [maintenanceStatus, setMaintenanceStatus] = useState("");
  const [selectedMaint, setSelectedMaint] = useState<string>("repair");
  const [maintCompleted, setMaintCompleted] = useState(false);

  // Service Keys State
  const [serviceKeys, setServiceKeys] = useState<Record<string, string>>({});
  const [providerAuths, setProviderAuths] = useState<Record<string, ProviderAuthConfig>>({
    anthropic: createDefaultProviderAuth("anthropic"),
  });
  const [providerAuthBusy, setProviderAuthBusy] = useState<Record<string, boolean>>({});
  const [providerAuthErrors, setProviderAuthErrors] = useState<Record<string, string>>({});
  const [oauthCompletionRunning, setOauthCompletionRunning] = useState(false);
  const [oauthCompletionStarted, setOauthCompletionStarted] = useState(false);
  const [oauthCompletionResults, setOauthCompletionResults] = useState<Record<string, { status: "pending" | "success" | "error"; message?: string }>>({});
  const [currentServiceIdx, setCurrentServiceIdx] = useState(0);
  const [isConfiguringService, setIsConfiguringService] = useState<boolean | null>(false);

  const servicesToConfigure = [
    { id: "goplaces", name: "Google Places", placeholder: "API Key" },
    { id: "notion", name: "Notion", placeholder: "Internal Integration Token" },
    { id: "elevenlabs", name: "ElevenLabs (SAG)", placeholder: "API Key" },
    { id: "nano-banana", name: "Nano Banana Pro", placeholder: "API Key" },
    { id: "openai-images", name: "OpenAI Image Gen", placeholder: "API Key" }
  ];

  // Advanced Form Data
  const [gatewayPort, setGatewayPort] = useState(18789);
  const [gatewayBind, setGatewayBind] = useState("loopback");
  const [gatewayAuthMode, setGatewayAuthMode] = useState("token");
  const [tailscaleMode, setTailscaleMode] = useState("off");
  const [nodeManager, setNodeManager] = useState("npm");
  const [selectedSkills, setSelectedSkills] = useState<string[]>(["filesystem", "terminal"]);
  const [skipBasicConfig, setSkipBasicConfig] = useState(false);

  // NEW: Security Best Practices (Step 11)
  const [sandboxMode, setSandboxMode] = useState("none");
  const [toolPolicy, setToolPolicy] = useState<ToolPolicy>(DEFAULT_TOOL_POLICY);

  // NEW: Fallback Models (Step 12)
  const [enableFallbacks, setEnableFallbacks] = useState(false);
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);

  // NEW: Session Management (Step 13)
  const [heartbeatMode, setHeartbeatMode] = useState("1h");
  const [idleTimeoutMs, setIdleTimeoutMs] = useState(3600000);

  // NEW: Preset-related markdown files
  const [toolsMd, setToolsMd] = useState("");
  const [agentsMd, setAgentsMd] = useState("");
  const [heartbeatMd, setHeartbeatMd] = useState("");
  const [memoryMd, setMemoryMd] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(false);

  // NEW: Business Functions (Step 15)
  const [selectedBusinessFunctions, setSelectedBusinessFunctions] = useState<BusinessFunctionId[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJobConfig[]>([]);

  // Extra Settings accordion state
  const [extraSettingsOpen, setExtraSettingsOpen] = useState<Record<string, boolean>>({
    gateway: false,
    runtime: false,
    security: false,
    session: false
  });

  // NEW: Multi-Agent (Step 15)
  const [enableMultiAgent, setEnableMultiAgent] = useState(false);
  const [numAgents, setNumAgents] = useState(1);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfigData[]>([]);
  const [currentAgentConfigIdx, setCurrentAgentConfigIdx] = useState(0);
  // const [isConfiguringAgent, setIsConfiguringAgent] = useState(false);

  // NEW: Workspace Customization (Step 16)
  const [identityMd, setIdentityMd] = useState("");
  const [userMd, setUserMd] = useState("");
  const [soulMd, setSoulMd] = useState("");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("identity");
  const [initialWorkspace, setInitialWorkspace] = useState({ identity: "", user: "", soul: "" });
  const [workspaceModified, setWorkspaceModified] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);

  // NEW: Custom Skills
  const [customSkillName, setCustomSkillName] = useState("");
  const [customSkillContent, setCustomSkillContent] = useState("");
  const [showCustomSkillForm, setShowCustomSkillForm] = useState(false);

  // Pairing Data
  const [pairingInput, setPairingInput] = useState("");
  const [pairingStatus, setPairingStatus] = useState("");
  const [isPaired, setIsPaired] = useState(false);

  // Local model detection state
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaDetecting, setOllamaDetecting] = useState(false);
  const [lmstudioBaseUrl, setLmstudioBaseUrl] = useState("http://localhost:1234");
  const [lmstudioModels, setLmstudioModels] = useState<string[]>([]);
  const [lmstudioDetecting, setLmstudioDetecting] = useState(false);
  const [localBaseUrl, setLocalBaseUrl] = useState("http://localhost:8080");
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [localDetecting, setLocalDetecting] = useState(false);

  // OpenClaw latest features
  const [thinkingLevel, setThinkingLevel] = useState("adaptive");

  // Messaging channel state
  const [messagingChannel, setMessagingChannel] = useState<"none" | "telegram" | "whatsapp">("telegram");
  const [whatsappDmPolicy, setWhatsappDmPolicy] = useState("allowlist");
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState("");
  const [whatsappPhoneSubmitted, setWhatsappPhoneSubmitted] = useState(false);
  const [whatsappQrDataUrl, setWhatsappQrDataUrl] = useState("");
  const [whatsappPaired, setWhatsappPaired] = useState(false);
  const [whatsappQrStep, setWhatsappQrStep] = useState(false);
  const [whatsappQrLoading, setWhatsappQrLoading] = useState(false);


  // Config validation
  const [validateOutput, setValidateOutput] = useState("");
  const [validating, setValidating] = useState(false);


  const availableSkills = AVAILABLE_SKILLS;
  const availableSkillIds = getSkillIdSet(availableSkills);

  // Apply agent type preset - sets all relevant state from a preset
  function applyAgentTypePreset(typeId: AgentTypeId) {
    setAgentType(typeId);
    if (typeId === "custom") return;

    const preset = AGENT_TYPE_PRESETS[typeId];
    if (!preset) return;

    // Set provider and model
    setProvider(preset.provider);
    setModel(preset.model);

    // Set fallbacks
    setFallbackModels(preset.fallbackModels);
    setEnableFallbacks(preset.enableFallbacks);

    // Set skills
    setSelectedSkills(preset.skills);

    // Set security
    setSandboxMode(preset.sandboxMode);
    setToolPolicy(normalizeToolPolicy(preset.toolPolicy));

    // Set session
    setHeartbeatMode(preset.heartbeatMode);
    setIdleTimeoutMs(preset.idleTimeoutMs);

    // Set markdown files
    let newIdentity = preset.identityMd;
    let newSoul = preset.soulMd;
    if (agentName) {
      newIdentity = updateIdentityField(newIdentity, "Name", agentName);
      newSoul = updateSoulMission(newSoul, agentName);
    }
    if (agentEmoji) {
      newIdentity = updateIdentityField(newIdentity, "Emoji", agentEmoji);
    }
    setIdentityMd(newIdentity);
    setSoulMd(newSoul);
    setToolsMd(preset.toolsMd);
    setAgentsMd(preset.agentsMd);
    setHeartbeatMd(preset.heartbeatMd);
    setMemoryMd(preset.memoryMd);
    setMemoryEnabled(preset.memoryEnabled);
  }

  const isPresetAgent = agentType !== "custom";

  const stepsList = [
    { id: 0, name: "System State", hidden: true },
    { id: 0.5, name: "Welcome", hidden: true },
    { id: 1, name: "Environment" },
    { id: 2, name: "System Check" },
    { id: 3, name: "Security" },
    { id: 5, name: "Identity" },
    { id: 6, name: "Agent" },
    { id: 6.5, name: "Type" },
    { id: 6.7, name: "Config", hidden: !isPresetAgent },
    { id: 8, name: "Brain", hidden: isPresetAgent },
    { id: 9, name: "Channels" },
    { id: 10.5, name: "Personality", advanced: true },
    { id: 13, name: "Models", advanced: true, hidden: isPresetAgent },
    { id: 11, name: "Skills", advanced: true, hidden: isPresetAgent },
    { id: 11.1, name: "Allowed Tools", advanced: true, hidden: isPresetAgent },
    { id: 15, name: "Business", advanced: true },
    { id: 15.5, name: "Agents", advanced: true, hidden: true },
    { id: 15.7, name: "Extra Settings", advanced: true },
    { id: 16, name: "Review" },
    { id: 17, name: "Pairing" }
  ];

  const deferredOAuthQueue = buildDeferredOAuthQueue({
    referencedProviders: buildReferencedProviders({
      primaryModel: model,
      fallbackModels: enableFallbacks ? fallbackModels.filter(Boolean) : [],
      agentConfigs,
    }),
    providerAuths,
    selectedSkills,
    availableSkills,
  });

  useEffect(() => { checkSystem(true); }, []);

  useEffect(() => {
    if (step === 17) {
      const checkPairing = async () => {
        try {
          const remoteConfig = targetEnvironment === "cloud" ? {
            ip: remoteIp,
            user: remoteUser,
            password: remotePassword || null,
            privateKeyPath: remotePrivateKeyPath || null
          } : null;
          const status: boolean = await invoke("check_pairing_status", { remote: remoteConfig });
          if (status) setIsPaired(true);
        } catch (e) { console.error("Failed to check pairing status:", e); }
      };
      checkPairing();
    }
  }, [step]);

  useEffect(() => {
    if (step !== 17) return;
    if (deferredOAuthQueue.length === 0) return;
    if (oauthCompletionRunning || oauthCompletionStarted) return;

    runDeferredOAuthQueue().catch((e) => {
      console.error("Deferred OAuth flow failed:", e);
      setOauthCompletionRunning(false);
    });
  }, [step, deferredOAuthQueue, oauthCompletionRunning, oauthCompletionStarted]);

  useEffect(() => {
    setProviderAuths(prev => normalizeProviderAuths(prev, provider, apiKey, authMethod));
  }, [provider]);

  useEffect(() => {
    const current = providerAuths[provider] || createDefaultProviderAuth(provider);
    if (authMethod !== current.auth_method) {
      setAuthMethod(current.auth_method);
    }
    if (apiKey !== current.token) {
      setApiKey(current.token);
    }
  }, [provider, providerAuths, authMethod, apiKey]);

  // Workspace change detection
  useEffect(() => {
    const modified =
      identityMd !== initialWorkspace.identity ||
      userMd !== initialWorkspace.user ||
      soulMd !== initialWorkspace.soul;
    setWorkspaceModified(modified);
  }, [identityMd, userMd, soulMd, initialWorkspace]);

  function updateProviderAuth(targetProvider: string, patch: Partial<ProviderAuthConfig> | ((current: ProviderAuthConfig) => ProviderAuthConfig)) {
    const normalizedProvider = getBaseProvider(targetProvider);
    setProviderAuths(prev => {
      const current = prev[normalizedProvider] || createDefaultProviderAuth(normalizedProvider);
      const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
      return { ...prev, [normalizedProvider]: next };
    });
  }

  function getProviderAuth(targetProvider: string): ProviderAuthConfig {
    return providerAuths[getBaseProvider(targetProvider)] || createDefaultProviderAuth(getBaseProvider(targetProvider));
  }

  function setProviderAuthMethod(targetProvider: string, value: string) {
    const normalizedProvider = getBaseProvider(targetProvider);
    const oauthOption = OAUTH_METHODS_BY_PROVIDER[normalizedProvider]?.find(option => option.value === value);
    setProviderAuths(prev => {
      const current = prev[normalizedProvider] || createDefaultProviderAuth(normalizedProvider);
      const nextProviderAuths = {
        ...prev,
        [normalizedProvider]: {
          ...current,
          auth_method: value,
          oauth_provider_id: oauthOption?.oauthProviderId ?? null,
          ...(value === "token" || value === "setup-token"
            ? { profile_key: null, profile: null }
            : { token: "" }),
        },
      };
      remapAllModelSelections(nextProviderAuths);
      return nextProviderAuths;
    });
  }

  function getProviderDefaultModel(targetProvider: string, auths: Record<string, ProviderAuthConfig> = providerAuths): string {
    return getDefaultModelForProvider(getBaseProvider(targetProvider), auths, DEFAULT_MODELS);
  }

  function getProviderModelOptions(targetProvider: string, auths: Record<string, ProviderAuthConfig> = providerAuths) {
    return getDisplayModelOptions(getBaseProvider(targetProvider), auths, MODELS_BY_PROVIDER);
  }

  function remapAllModelSelections(nextProviderAuths: Record<string, ProviderAuthConfig>) {
    setModel(prev => applyModelProviderAuth(prev, nextProviderAuths));
    setFallbackModels(prev => prev.map(modelRef => applyModelProviderAuth(modelRef, nextProviderAuths)));
    setAgentConfigs(prev => prev.map(agent => ({
      ...agent,
      model: applyModelProviderAuth(agent.model, nextProviderAuths),
      fallbackModels: agent.fallbackModels.map(modelRef => applyModelProviderAuth(modelRef, nextProviderAuths)),
    })));
  }

  async function runDeferredOAuthQueue() {
    if (oauthCompletionRunning || deferredOAuthQueue.length === 0) return;

    setOauthCompletionRunning(true);
    setOauthCompletionStarted(true);
    let nextProviderAuths = { ...providerAuths };
    let hasSuccessfulAuth = false;

    for (const item of deferredOAuthQueue) {
      setOauthCompletionResults(prev => ({
        ...prev,
        [item.id]: { status: "pending", message: "Opening a terminal for interactive OpenClaw authentication..." },
      }));
      setProviderAuthBusy(prev => ({ ...prev, [item.targetProvider]: true }));
      setProviderAuthErrors(prev => ({ ...prev, [item.targetProvider]: "" }));

      try {
        const result = await invoke<ProviderAuthConfig>("start_provider_auth", {
          provider: item.targetProvider,
          method: item.authMethod,
          oauthProviderId: item.oauthProviderId,
        });
        nextProviderAuths = {
          ...nextProviderAuths,
          [item.targetProvider]: result,
        };
        hasSuccessfulAuth = true;
        updateProviderAuth(item.targetProvider, result);
        setOauthCompletionResults(prev => ({
          ...prev,
          [item.id]: { status: "success", message: `Connected via ${item.label}. OpenClaw imported the auth profile.` },
        }));
      } catch (e: any) {
        const message = String(e);
        setProviderAuthErrors(prev => ({ ...prev, [item.targetProvider]: message }));
        setOauthCompletionResults(prev => ({
          ...prev,
          [item.id]: { status: "error", message },
        }));
      } finally {
        setProviderAuthBusy(prev => ({ ...prev, [item.targetProvider]: false }));
      }
    }

    if (hasSuccessfulAuth && targetEnvironment !== "cloud") {
      try {
        await invoke("configure_agent", {
          config: {
            ...constructConfigPayload(nextProviderAuths),
            preserve_state: true,
          },
        });
      } catch (e: any) {
        const message = `OAuth succeeded, but saving the imported auth profile failed: ${String(e)}`;
        setOauthCompletionResults(prev => {
          const next = { ...prev };
          for (const item of deferredOAuthQueue) {
            if (next[item.id]?.status === "success") {
              next[item.id] = { status: "error", message };
            }
          }
          return next;
        });
      }
    }

    setOauthCompletionRunning(false);
  }

  function renderProviderAuthEditor(targetProvider: string, options?: { keyPrefix?: string; showProviderLabel?: boolean; showMissingWarning?: boolean; marginTop?: string }) {
    const normalizedProvider = getBaseProvider(targetProvider);
    const auth = getProviderAuth(normalizedProvider);
    const authOptions = getProviderAuthOptions(normalizedProvider);
    const selectedAuthOption = authOptions.find((option) => option.value === auth.auth_method);
    const hasCredential = isOAuthMethod(auth.auth_method) ? !!auth.profile_key : !!auth.token;
    const providerQueueItem = deferredOAuthQueue.find(item => item.source === "provider" && item.targetProvider === normalizedProvider);
    const completionResult = providerQueueItem ? oauthCompletionResults[providerQueueItem.id] : null;
    const showProviderLabel = options?.showProviderLabel ?? true;
    const showMissingWarning = options?.showMissingWarning ?? true;
    const buttonStyle = { fontSize: "0.85rem", padding: "0.45rem 0.75rem" };

    return (
      <div key={`${options?.keyPrefix || "provider-auth"}-${normalizedProvider}`} className="form-group" style={{ marginTop: options?.marginTop || "1rem" }}>
        {showProviderLabel && (
          <label>{normalizedProvider.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}</label>
        )}

        {authOptions.length > 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: showProviderLabel ? "0.5rem" : "0" }}>
            {authOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={auth.auth_method === option.value ? "primary" : "secondary"}
                style={buttonStyle}
                onClick={() => setProviderAuthMethod(normalizedProvider, option.value)}
                disabled={providerAuthBusy[normalizedProvider]}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {selectedAuthOption?.description && (
          <p className="input-hint" style={{ marginTop: "0.5rem" }}>
            {selectedAuthOption.description}
          </p>
        )}

        {(auth.auth_method === "token" || auth.auth_method === "setup-token") && (
          <div style={{ marginTop: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {auth.auth_method === "setup-token" ? "Claude Code Setup Token" : normalizedProvider === "google" ? "Gemini API Key" : "API Key"}
            </label>
            <input
              type="password"
              placeholder={auth.auth_method === "setup-token" ? "Paste `claude setup-token` output" : normalizedProvider === "google" ? "Paste your Gemini API key" : `Paste your ${normalizedProvider} API key`}
              value={auth.token}
              onChange={(e) => updateProviderAuth(normalizedProvider, { token: e.target.value })}
              autoComplete="off"
            />
          </div>
        )}

        {isOAuthMethod(auth.auth_method) && (
          <div style={{ marginTop: "0.75rem" }}>
            <p className="input-hint" style={{ marginTop: "0.5rem" }}>
              {hasCredential
                ? `Imported profile ${auth.profile_key}.`
                : checks.openclaw
                  ? "OAuth will open automatically at the end of setup."
                  : "OAuth will open automatically after OpenClaw is installed and setup reaches the final step."}
            </p>
            {!hasCredential && providerQueueItem && !completionResult && (
              <p className="input-hint" style={{ marginTop: "0.25rem", color: "var(--text-muted)" }}>
                Deferred until setup completion.
              </p>
            )}
            {completionResult && (
              <p className="input-hint" style={{ marginTop: "0.25rem", color: completionResult.status === "error" ? "var(--danger, #dc2626)" : "var(--success)" }}>
                {completionResult.message}
              </p>
            )}
          </div>
        )}

        {showMissingWarning && !hasCredential && (
          <p className="input-hint" style={{ marginTop: "0.5rem", color: "var(--warning, #b45309)" }}>
            Missing authentication for {normalizedProvider}. You can continue and configure it later, but this provider will not work until auth is supplied.
          </p>
        )}

        {providerAuthErrors[normalizedProvider] && (
          <p className="input-hint" style={{ marginTop: "0.5rem", color: "var(--danger, #dc2626)" }}>
            {providerAuthErrors[normalizedProvider]}
          </p>
        )}
      </div>
    );
  }

  async function installLocalNode() {
    setInstallingNode(true);
    setNodeInstallError("");
    try {
      await invoke("install_local_nodejs");
      await checkSystem(false);
    } catch (e: any) {
      setNodeInstallError("Failed to install: " + e);
    } finally {
      setInstallingNode(false);
    }
  }

  async function checkSystem(skipRedirect = false) {
    // Always check local system on initial load
    const res: any = await invoke("check_prerequisites");
    setChecks({
      node: res.node_installed,
      docker: res.docker_running,
      openclaw: res.openclaw_installed
    });
    const version: string = await invoke("get_openclaw_version");
    setOpenClawVersion(version);

    if (res.openclaw_installed && !skipRedirect) {
      setStep(0);
      return true; // Indicate that we're going to maintenance
    } else if (!skipRedirect) {
      setStep(0.5); // Go to Welcome page if not installed
    }
    return res.openclaw_installed; // Return installation status
  }

  async function checkRemoteSystem(skipRedirect = false) {
    // Check remote system (called from Step 1 when cloud environment is selected)
    if (sshStatus === "success") {
      const remote = {
        ip: remoteIp,
        user: remoteUser,
        password: remotePassword || null,
        privateKeyPath: remotePrivateKeyPath || null
      };

      const res: any = await invoke("check_remote_prerequisites", { remote });
      setChecks({
        node: res.node_installed,
        docker: res.docker_running,
        openclaw: res.openclaw_installed
      });
      const version: string = await invoke("get_remote_openclaw_version", { remote });
      setOpenClawVersion(version);

      // If OpenClaw is already installed remotely, go to maintenance screen (unless skipping)
      if (res.openclaw_installed && !skipRedirect) {
        setStep(0);
        return true; // Indicate that we're going to maintenance
      }
      return res.openclaw_installed; // Return installation status
    }
    return false;
  }

  function formatSshError(error: string): string {
    const errorLower = error.toLowerCase();

    // Authentication errors
    if (errorLower.includes("no identities found in the ssh agent")) {
      return "SSH agent has no keys loaded. Try using a password or specifying a key file.";
    }
    if (errorLower.includes("all authentication methods failed") || errorLower.includes("ssh authentication failed")) {
      return "Authentication failed. Please check your username, password, or SSH key.";
    }
    if (errorLower.includes("public key auth failed") || errorLower.includes("publickey")) {
      return "SSH key authentication failed. Check that your key is correct and has proper permissions.";
    }
    if (errorLower.includes("password auth failed") || errorLower.includes("authentication failed")) {
      return "Password authentication failed. Please check your password.";
    }
    if (errorLower.includes("permission denied")) {
      return "Permission denied. Check your username and authentication credentials.";
    }

    // Connection errors
    if (errorLower.includes("connection refused")) {
      return "Connection refused. Check that SSH is running on the server (port 22).";
    }
    if (errorLower.includes("connection timed out") || errorLower.includes("timeout")) {
      return "Connection timed out. Check the IP address and network connectivity.";
    }
    if (errorLower.includes("no route to host")) {
      return "Cannot reach the server. Check the IP address and network settings.";
    }
    if (errorLower.includes("network is unreachable")) {
      return "Network unreachable. Check your internet connection.";
    }
    if (errorLower.includes("cannot reach")) {
      return "Cannot connect to the server. Check the IP address and port.";
    }

    // Handshake errors
    if (errorLower.includes("handshake failed")) {
      return "SSH handshake failed. The server may not support SSH protocol.";
    }

    // Key file errors
    if (errorLower.includes("no such file") || errorLower.includes("file not found")) {
      return "SSH key file not found. Check the file path.";
    }
    if (errorLower.includes("invalid format") || errorLower.includes("bad key")) {
      return "Invalid SSH key format. Ensure the key file is a valid private key.";
    }

    // Default: show a simplified version
    const firstLine = error.split('\n')[0];
    if (firstLine.length > 100) {
      return "Connection failed. Please check your settings and try again.";
    }
    return firstLine.replace(/Error: /g, '').trim();
  }

  async function handleSshCheck() {
    if (!remoteIp || !remoteUser) {
      setSshError("Please provide IP address and username");
      setTimeout(() => setSshError(""), 30000);
      return;
    }

    setSshStatus("checking");
    setSshError("");

    try {
      // Changed to use object parameter to match backend
      const checkPromise = invoke("test_ssh_connection", {
        remote: {
          ip: remoteIp,
          user: remoteUser,
          password: remotePassword || null,
          privateKeyPath: remotePrivateKeyPath || null
        }
      });

      // Timeout after 15 seconds
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Connection timed out")), 15000)
      );

      await Promise.race([checkPromise, timeoutPromise]);

      setSshStatus("success");
      setSshError("");
    } catch (e) {
      setSshStatus("idle"); // Reset to idle on error so user can retry
      const friendlyError = formatSshError(String(e));
      setSshError(friendlyError);
      setTimeout(() => setSshError(""), 30000);
    }
  }

  async function handleSaveWorkspace(agentId?: string) {
    setSavingWorkspace(true);
    try {
      await invoke("save_workspace_files", {
        agentId: agentId || null,
        identity: identityMd,
        user: userMd,
        soul: soulMd
      });
      // Update initial workspace to current values
      setInitialWorkspace({
        identity: identityMd,
        user: userMd,
        soul: soulMd
      });
      setWorkspaceModified(false);
    } catch (e) {
      console.error("Failed to save workspace:", e);
      alert("Failed to save workspace: " + e);
    }
    setSavingWorkspace(false);
  }

  // Helper to deep compare two objects (robust to key order)
  function isDeepEqual(obj1: any, obj2: any) {
    if (obj1 === obj2) return true;
    if (typeof obj1 !== "object" || obj1 === null || typeof obj2 !== "object" || obj2 === null) {
      return false;
    }

    if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;

    const keys1 = Object.keys(obj1).sort();
    const keys2 = Object.keys(obj2).sort();

    if (keys1.length !== keys2.length) return false;

    for (let i = 0; i < keys1.length; i++) {
      if (keys1[i] !== keys2[i]) return false;
      if (!isDeepEqual(obj1[keys1[i]], obj2[keys2[i]])) return false;
    }

    return true;
  }

  // Normalize a config payload so that null fields that the backend treats as
  // "use default" compare equal to their UI-default counterparts.  This is needed
  // because a basic-mode deploy sends null for security/session fields, but when
  // the user later visits advanced settings (mode="advanced") those same fields are
  // emitted with their useState defaults by constructConfigPayload().
  function normalizeForComparison(payload: any) {
    if (!payload) return payload;
    const normalizedPolicy = (payload.tools_profile != null
      || (payload.allowed_tools?.length ?? 0) > 0
      || (payload.denied_tools?.length ?? 0) > 0
      || payload.tools_mode != null)
      ? getLoadedTopLevelToolPolicy(payload)
      : normalizeToolPolicy(DEFAULT_TOOL_POLICY, availableSkillIds);
    return {
      ...payload,
      sandbox_mode: payload.sandbox_mode ?? "off",
      tools_mode: payload.tools_mode ?? null,
      tools_profile: normalizedPolicy.profile,
      allowed_tools: normalizedPolicy.allow,
      denied_tools: normalizedPolicy.deny,
      heartbeat_mode: payload.heartbeat_mode ?? "1h",
      idle_timeout_ms: (payload.heartbeat_mode ?? "1h") === "idle"
        ? payload.idle_timeout_ms
        : null,
    };
  }

  function hasExplicitAgentToolPolicy(agent: any) {
    return Boolean(
      agent?.tools
      || agent?.tools_profile != null
      || (agent?.allowed_tools?.length ?? 0) > 0
      || (agent?.denied_tools?.length ?? 0) > 0,
    );
  }

  function getLoadedTopLevelToolPolicy(config: any) {
    return normalizeToolPolicy(
      config.tools_profile
        ? {
            profile: config.tools_profile,
            allow: config.allowed_tools,
            deny: config.denied_tools,
          }
        : deriveToolPolicyFromLegacy(
            config.tools_mode,
            config.allowed_tools,
            config.denied_tools,
            availableSkillIds,
          ),
      availableSkillIds,
    );
  }

  function getLoadedAgentToolPolicy(agent: any) {
    if (!hasExplicitAgentToolPolicy(agent)) {
      return createInheritedToolPolicy();
    }

    return normalizeToolPolicy({
      profile: agent.tools_profile ?? agent.tools?.profile ?? null,
      allow: agent.allowed_tools ?? agent.tools?.allow ?? [],
      deny: agent.denied_tools ?? agent.tools?.deny ?? [],
      elevatedEnabled: agent.tools?.elevated?.enabled ?? false,
      inherit: false,
    }, availableSkillIds);
  }

  function buildAgentToolsPayload(policy: ToolPolicy, inheritedPolicy: ToolPolicy = toolPolicy) {
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

  // Helper to transform the loaded config (from get_current_config)
  // into the structure expected by configure_agent, for comparison.
  function transformInitialToPayload(initial: any) {
    if (!initial) return null;
    const normalizedProvider = getBaseProvider(initial.provider);
    const initialProviderAuths = normalizeProviderAuths(
      initial.provider_auths,
      normalizedProvider,
      initial.api_key || "",
      initial.auth_method || "token",
    );
    const normalizedTopLevelSelection = normalizeSkillAndToolSelection(
      initial.skills || [],
      initial.allowed_tools || [],
      availableSkillIds,
    );
    const normalizedTopLevelToolPolicy = getLoadedTopLevelToolPolicy(initial);
    const defaultIdentity = `# IDENTITY.md - Who Am I?
- **Name:** ${initial.agent_name}
- **Emoji:** ${initial.agent_emoji || "🦞"}
---
Managed by Clawnetes.`;

    const mappedSandboxMode = initial.sandbox_mode === "full" ? "all" : (initial.sandbox_mode === "partial" ? "non-main" : (initial.sandbox_mode === "none" ? "off" : initial.sandbox_mode));

    return {
      provider: normalizedProvider,
      api_key: initialProviderAuths[normalizedProvider]?.token || initial.api_key,
      auth_method: initialProviderAuths[normalizedProvider]?.auth_method || initial.auth_method,
      model: applyModelProviderAuth(initial.model, initialProviderAuths),
      user_name: initial.user_name,
      agent_name: initial.agent_name,
      agent_vibe: initial.agent_vibe || "",
      telegram_token: initial.telegram_token || "",
      gateway_port: initial.gateway_port,
      gateway_bind: initial.gateway_bind,
      gateway_auth_mode: initial.gateway_auth_mode,
      tailscale_mode: initial.tailscale_mode,
      node_manager: initial.node_manager,
      skills: normalizedTopLevelSelection.skills,
      service_keys: initial.service_keys || {},
      provider_auths: initialProviderAuths,
      sandbox_mode: mappedSandboxMode,
      tools_mode: initial.tools_mode ?? null,
      tools_profile: normalizedTopLevelToolPolicy.profile,
      allowed_tools: normalizedTopLevelToolPolicy.allow,
      denied_tools: normalizedTopLevelToolPolicy.deny,
      fallback_models: (initial.fallback_models && initial.fallback_models.length > 0)
        ? initial.fallback_models.map((model: string) => applyModelProviderAuth(model, initialProviderAuths))
        : null,
      heartbeat_mode: initial.heartbeat_mode,
      idle_timeout_ms: initial.heartbeat_mode === "idle" ? initial.idle_timeout_ms : null,
      identity_md: initial.identity_md || defaultIdentity,
      user_md: initial.user_md || null,
      soul_md: initial.soul_md || null,
      agents: initial.enable_multi_agent && initial.agent_configs ? initial.agent_configs.map((a: any) => {
        const normalizedAgentSelection = normalizeSkillAndToolSelection(
          a.skills || [],
          a.tools?.allow || a.allowed_tools || [],
          availableSkillIds,
        );
        const normalizedAgentToolPolicy = getLoadedAgentToolPolicy(a);
        const agentToolsPayload = buildAgentToolsPayload(normalizedAgentToolPolicy, normalizedTopLevelToolPolicy);

        return {
          id: a.id,
          name: a.name,
          model: applyModelProviderAuth(a.model, initialProviderAuths),
          fallback_models: (a.fallback_models && a.fallback_models.length > 0)
            ? a.fallback_models.map((model: string) => applyModelProviderAuth(model, initialProviderAuths))
            : null,
          skills: normalizedAgentSelection.skills.length > 0 ? normalizedAgentSelection.skills : null,
          vibe: a.vibe || "",
          identity_md: a.identity_md || `# IDENTITY.md - Who Am I?
- **Name:** ${a.name}
- **Emoji:** ${a.emoji || "🦞"}
---
Managed by Clawnetes.`,
          user_md: a.user_md || null,
          soul_md: a.soul_md || null,
          tools_md: a.tools_md || null,
          agents_md: a.agents_md || null,
          tools: agentToolsPayload,
        };
      }) : null,
      preserve_state: isPaired,
      agent_type: initial.agent_type || "custom",
      tools_md: initial.tools_md || null,
      agents_md: initial.agents_md || null,
      heartbeat_md: initial.heartbeat_md || null,
      memory_md: initial.memory_md || null,
      memory_enabled: initial.memory_enabled || false,
      cron_jobs: initial.cron_jobs || null,
      local_base_url: initial.local_base_url || null,
      thinking_level: initial.thinking_level || null,
      // WhatsApp channel
      whatsapp_enabled: initial.whatsapp_enabled || false,
      whatsapp_dm_policy: initial.whatsapp_dm_policy || null,
      whatsapp_phone_number: initial.whatsapp_phone_number || "",
    };
  }

  function constructConfigPayload(providerAuthsOverride?: Record<string, ProviderAuthConfig>) {
    const mappedSandboxMode = sandboxMode === "full" ? "all" : (sandboxMode === "partial" ? "non-main" : "off");
    const defaultIdentity = `# IDENTITY.md - Who Am I?
- **Name:** ${agentName}
- **Emoji:** ${agentEmoji}
---
Managed by Clawnetes.`;
    const effectiveProviderAuths = providerAuthsOverride || providerAuths;

    // For preset agents, always include preset-configured fields
    const usePresetFields = isPresetAgent || mode === "advanced";
    const normalizedTopLevelToolPolicy = normalizeToolPolicy(toolPolicy, availableSkillIds);

    return {
      provider,
      api_key: effectiveProviderAuths[provider]?.token || apiKey,
      auth_method: effectiveProviderAuths[provider]?.auth_method || authMethod,
      model: applyModelProviderAuth(model, effectiveProviderAuths),
      user_name: userName,
      agent_name: agentName,
      agent_vibe: "",
      telegram_token: telegramToken,
      gateway_port: gatewayPort,
      gateway_bind: gatewayBind,
      gateway_auth_mode: gatewayAuthMode,
      tailscale_mode: tailscaleMode,
      node_manager: nodeManager,
      skills: selectedSkills,
      service_keys: serviceKeys,
      provider_auths: effectiveProviderAuths,
      sandbox_mode: usePresetFields ? mappedSandboxMode : null,
      tools_mode: usePresetFields
        ? (normalizedTopLevelToolPolicy.profile === "full" && normalizedTopLevelToolPolicy.allow.length === 0 && normalizedTopLevelToolPolicy.deny.length === 0 ? "all" : "allowlist")
        : "all",
      tools_profile: usePresetFields ? normalizedTopLevelToolPolicy.profile : null,
      allowed_tools: usePresetFields ? normalizedTopLevelToolPolicy.allow : null,
      denied_tools: usePresetFields ? normalizedTopLevelToolPolicy.deny : null,
      fallback_models: usePresetFields && enableFallbacks
        ? fallbackModels.filter(m => m).map(m => applyModelProviderAuth(m, effectiveProviderAuths))
        : null,
      heartbeat_mode: usePresetFields ? heartbeatMode : null,
      idle_timeout_ms: usePresetFields && heartbeatMode === "idle" ? idleTimeoutMs : null,
      identity_md: (usePresetFields && identityMd) ? identityMd : defaultIdentity,
      user_md: usePresetFields && userMd ? userMd : null,
      soul_md: usePresetFields && soulMd ? soulMd : null,
      agents: enableMultiAgent ? agentConfigs.map(a => {
        const normalizedAgentSelection = normalizeSkillAndToolSelection(
          a.skills,
          a.toolPolicy.allow,
          availableSkillIds,
        );
        const normalizedAgentToolPolicy = normalizeToolPolicy(a.toolPolicy, availableSkillIds);
        const agentToolsPayload = buildAgentToolsPayload(normalizedAgentToolPolicy, normalizedTopLevelToolPolicy);

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
          tools: agentToolsPayload,
        };
      }) : null,
      preserve_state: isPaired,
      // New preset fields
      agent_type: agentType,
      tools_md: usePresetFields && toolsMd ? toolsMd : null,
      agents_md: usePresetFields && agentsMd ? agentsMd : null,
      heartbeat_md: usePresetFields && heartbeatMd ? heartbeatMd : null,
      memory_md: usePresetFields && memoryMd ? memoryMd : null,
      memory_enabled: usePresetFields ? memoryEnabled : false,
      cron_jobs: cronJobs.length > 0 ? cronJobs : null,
      // Local model support
      local_base_url: provider === "local" ? localBaseUrl : (provider === "lmstudio" ? lmstudioBaseUrl : null),
      // OpenClaw latest features
      thinking_level: (provider === "anthropic" && (model.includes("claude-") && model.includes("-4"))) ? thinkingLevel : null,
      // WhatsApp channel
      whatsapp_enabled: messagingChannel === "whatsapp",
      whatsapp_dm_policy: messagingChannel === "whatsapp" ? whatsappDmPolicy : null,
      whatsapp_phone_number: messagingChannel === "whatsapp" ? whatsappPhoneNumber : null,
    };
  }

  async function handleInstall() {
    setLoading(true);
    setError(false);

    const isUpdate = !!initialConfigRef.current;
    setProgress(isUpdate ? "Applying changes..." : "Starting setup...");

    const remoteConfig = targetEnvironment === "cloud" ? {
      ip: remoteIp,
      user: remoteUser,
      password: remotePassword || null,
      privateKeyPath: remotePrivateKeyPath || null
    } : null;

    // Check pairing status live before applying config to ensure we don't overwrite it
    let actualIsPaired = isPaired;
    if (checks.openclaw || isUpdate) {
      try {
        const status: boolean = await invoke("check_pairing_status", { remote: remoteConfig });
        if (status) {
          actualIsPaired = true;
          setIsPaired(true);
        }
      } catch (e) {
        console.warn("Pre-install pairing check failed:", e);
      }
    }

    const configPayload = constructConfigPayload();
    const agentSessionIds = getAgentSessionInitIds(configPayload.agents);
    // Ensure we preserve state if we found it was paired
    configPayload.preserve_state = actualIsPaired;

    if (initialConfigRef.current) {
      const initialPayload = transformInitialToPayload(initialConfigRef.current);
      if (isDeepEqual(normalizeForComparison(initialPayload), normalizeForComparison(configPayload))) {
        setProgress("Configuration unchanged.");
        setTimeout(() => {
          setLoading(false);
          setStep(17);
        }, 500);
        return;
      }
    }

    try {
      if (targetEnvironment === "cloud") {
        // Remote installation flow
        setProgress(isUpdate ? "Updating remote configuration..." : "Deploying to remote server...");
        setLogs(isUpdate ? "Updating remote configuration..." : "Preparing remote environment...");

        await invoke("setup_remote_openclaw", {
          remote: remoteConfig,
          config: configPayload
        });

        // Install skills on remote server
        for (const skill of selectedSkills) {
          setProgress(`Installing skill on remote: ${skill}...`);
          setLogs(`Installing skill: ${skill}...`);
          try {
            await invoke("install_remote_skill", {
              remote: remoteConfig,
              name: skill
            });
          } catch (e) {
            console.error(`Failed to install skill ${skill}:`, e);
            setLogs(prev => prev + `\nWarning: Failed to install skill ${skill}: ${e}`);
          }
        }

        setProgress("Establishing SSH tunnel...");
        setLogs("Creating SSH tunnel to remote gateway...");
        try {
          await invoke("start_ssh_tunnel", { remote: remoteConfig });
        } catch (e: any) {
          if (String(e).includes("SSH tunnel is already running")) {
            setLogs(prev => prev + "\nTunnel already active.");
          } else {
            throw e;
          }
        }
        setTunnelActive(true);

        // Verify tunnel is working with HTTP connectivity test
        setProgress("Verifying tunnel connectivity...");
        try {
          const tunnelWorking: boolean = await invoke("verify_tunnel_connectivity", {
            remote: remoteConfig
          });
          if (!tunnelWorking) {
            // If we get here with the new binary, verify_tunnel_connectivity should have returned Err, not Ok(false).
            // So if we get Ok(false), it means we are definitely running the old binary.
            throw new Error("Backend update pending. Please restart the application (Ctrl+C and npm run tauri dev) to apply the latest fixes.");
          }
        } catch (e) {
          setProgress("");
          const errStr = String(e);
          if (errStr.includes("Backend update pending")) {
            setLogs("Error: " + errStr);
          } else {
            setLogs("Error: Tunnel verification failed - " + errStr);
          }
          setError(true);
          setTunnelActive(false);
          setLoading(false);
          return;
        }

        setProgress("Finalizing setup...");
        if (!actualIsPaired) {
          const instruction: string = await invoke("generate_pairing_code");
          setPairingCode(instruction);
        }

        // Get dashboard URL (tunneled)
        const url: string = await invoke("get_dashboard_url", {
          isRemote: true,
          remote: remoteConfig
        });
        setDashboardUrl(url);

        setProgress("");
        setStep(17);
      } else {
        // Local installation flow
        if (!checks.openclaw) {
          setProgress("Installing OpenClaw (this may take a minute)...");
          setLogs("Installing OpenClaw (this may take a minute)...");
          await invoke("install_openclaw");
          const version: string = await invoke("get_openclaw_version");
          setOpenClawVersion(version);
          setChecks(prev => ({ ...prev, openclaw: true }));
        }

        setProgress("Configuring agent...");
        setLogs("Configuring...");

        await invoke("configure_agent", {
          config: configPayload
        });

        for (const skill of selectedSkills) {
          setProgress(`Installing skill: ${skill}...`);
          setLogs(`Installing skill: ${skill}...`);
          try {
            await invoke("install_skill", { name: skill });
          } catch (e) {
            console.error(`Failed to install skill ${skill}:`, e);
            setLogs(prev => prev + `\nWarning: Failed to install skill ${skill}: ${e}`);
          }
        }

        if (isUpdate || messagingChannel === "whatsapp") {
          setProgress("Restarting Gateway (this may take 20-30 seconds)...");
          setLogs("Restarting Gateway...");
          await invoke("restart_openclaw_gateway", { remote: targetEnvironment === "cloud" ? { ip: remoteIp, user: remoteUser, password: remotePassword || null, privateKeyPath: remotePrivateKeyPath || null } : null });
        } else {
          setProgress("Starting Gateway (this may take 20-30 seconds)...");
          setLogs("Starting Gateway...");
          await invoke("start_gateway");
        }

        if (targetEnvironment !== "cloud" && agentSessionIds.length > 0) {
          setProgress("Initializing agent sessions...");
          setLogs("Initializing agent sessions...");
          try {
            await invoke("initialize_agent_sessions", { agentIds: agentSessionIds });
          } catch (e) {
            console.warn("Agent session init failed (non-fatal):", e);
          }
        }

        setProgress("Finalizing setup...");
        if (!actualIsPaired) {
          const instruction: string = await invoke("generate_pairing_code");
          setPairingCode(instruction);
        }

        const url: string = await invoke("get_dashboard_url", {
          isRemote: false,
          remote: null
        });
        setDashboardUrl(url);

        setProgress("");
        setStep(17);
      }
    } catch (e) {
      setProgress("");
      setLogs("Error: " + e);
      setError(true);
    }
    setLoading(false);
  }

  async function handlePairing() {
    if (!pairingInput) return;
    setPairingStatus("Verifying...");
    try {
      const remoteConfig = targetEnvironment === "cloud" ? {
        ip: remoteIp,
        user: remoteUser,
        password: remotePassword || null,
        privateKeyPath: remotePrivateKeyPath || null
      } : null;

      await invoke("approve_pairing", {
        code: pairingInput,
        remote: remoteConfig
      });
      setPairingStatus("✅ Success! Bot paired.");
      setIsPaired(true);
      setPairingInput("");
    } catch (e) {
      setPairingStatus("❌ Error: " + e);
    }
  }

  async function handleMaintenanceAction(action: string) {
    setLoading(true);
    setMaintenanceStatus(`Running ${action}...`);
    setLogs(`Starting maintenance: ${action}...\n`);
    try {
      let res: string;

      // Build remote config if cloud environment
      const remoteConfig = targetEnvironment === "cloud" && sshStatus === "success" ? {
        ip: remoteIp,
        user: remoteUser,
        password: remotePassword || null,
        privateKeyPath: remotePrivateKeyPath || null
      } : null;

      if (action === "repair") {
        res = remoteConfig
          ? await invoke("run_remote_doctor_repair", { remote: remoteConfig })
          : await invoke("run_doctor_repair");
        setMaintenanceStatus(`✅ Repair completed successfully.`);
      } else if (action === "audit") {
        res = remoteConfig
          ? await invoke("run_remote_security_audit_fix", { remote: remoteConfig })
          : await invoke("run_security_audit_fix");
        setMaintenanceStatus(`✅ Security Audit completed successfully.`);
      } else if (action === "update") {
        if (remoteConfig) {
          res = await invoke("update_remote_openclaw", { remote: remoteConfig });
          setMaintenanceStatus(`✅ Remote OpenClaw updated.`);
        } else {
          res = await invoke("install_openclaw"); // Re-run install to update
          setMaintenanceStatus(`✅ OpenClaw updated.`);
        }
      } else {
        res = remoteConfig
          ? await invoke("uninstall_remote_openclaw", { remote: remoteConfig })
          : await invoke("uninstall_openclaw");
        // Reset everything after uninstall
        setChecks(prev => ({ ...prev, openclaw: false }));
        setMaintenanceStatus(`✅ Uninstall completed successfully.`);
      }
      setLogs(prev => prev + (res || ""));
      setMaintCompleted(true);
    } catch (e) {
      setLogs(prev => prev + `\nError: ${e}`);
      setMaintenanceStatus(`❌ ${action} failed.`);
    }
    setLoading(false);
  }

  async function loadExistingConfig() {
    setLoading(true);
    setMaintenanceStatus("Loading existing configuration...");
    try {
      const remoteConfig = targetEnvironment === "cloud" ? {
        ip: remoteIp,
        user: remoteUser,
        password: remotePassword || null,
        privateKeyPath: remotePrivateKeyPath || null
      } : null;

      const config: any = await invoke("get_current_config", { remote: remoteConfig });
      initialConfigRef.current = config;
      const normalizedProvider = getBaseProvider(config.provider);
      const normalizedProviderAuths = normalizeProviderAuths(
        config.provider_auths,
        normalizedProvider,
        config.api_key || "",
        config.auth_method || "token",
      );

      // Populate state
      setProvider(normalizedProvider);
      setApiKey(normalizedProviderAuths[normalizedProvider]?.token || config.api_key);
      setAuthMethod(normalizedProviderAuths[normalizedProvider]?.auth_method || config.auth_method);
      setProviderAuths(normalizedProviderAuths);
      setModel(normalizeModelRefForUi(config.model, normalizedProviderAuths));
      setUserName(config.user_name);
      setAgentName(config.agent_name);
      setAgentEmoji(config.agent_emoji || "🦞");
      setAgentType(config.agent_type || "custom");
      setTelegramToken(config.telegram_token);

      setGatewayPort(config.gateway_port);
      setGatewayBind(config.gateway_bind);
      setGatewayAuthMode(config.gateway_auth_mode);
      setTailscaleMode(config.tailscale_mode);
      setNodeManager(config.node_manager);

      const normalizedTopLevelSelection = normalizeSkillAndToolSelection(
        config.skills,
        config.allowed_tools,
        availableSkillIds,
      );
      const normalizedTopLevelToolPolicy = getLoadedTopLevelToolPolicy(config);
      setSelectedSkills(normalizedTopLevelSelection.skills);
      // Service keys might be partial, merge them?
      setServiceKeys(config.service_keys);

      setSandboxMode(config.sandbox_mode);
      setToolPolicy(normalizedTopLevelToolPolicy);

      setFallbackModels(config.fallback_models.map((modelRef: string) => normalizeModelRefForUi(modelRef, normalizedProviderAuths)));
      setEnableFallbacks(config.fallback_models.length > 0);

      setHeartbeatMode(config.heartbeat_mode);
      setIdleTimeoutMs(config.idle_timeout_ms);

      setIdentityMd(config.identity_md);
      setUserMd(config.user_md);
      setSoulMd(config.soul_md);
      setInitialWorkspace({
        identity: config.identity_md,
        user: config.user_md,
        soul: config.soul_md
      });

      // Load new preset fields
      if (config.tools_md) setToolsMd(config.tools_md);
      if (config.agents_md) setAgentsMd(config.agents_md);
      if (config.heartbeat_md) setHeartbeatMd(config.heartbeat_md);
      if (config.memory_md) setMemoryMd(config.memory_md);
      if (config.memory_enabled !== undefined) setMemoryEnabled(config.memory_enabled);
      if (config.cron_jobs) setCronJobs(config.cron_jobs);

      // Load new fields
      if (config.whatsapp_enabled) {
        setMessagingChannel("whatsapp");
        setWhatsappPaired(true);       // already connected; skip QR re-pairing
        setWhatsappPhoneSubmitted(true);
      } else if (config.telegram_token) setMessagingChannel("telegram");
      if (config.whatsapp_phone_number) setWhatsappPhoneNumber(config.whatsapp_phone_number);
      if (config.whatsapp_dm_policy) setWhatsappDmPolicy(config.whatsapp_dm_policy);
      if (config.thinking_level) setThinkingLevel(config.thinking_level);
      if (config.local_base_url) {
        if (config.provider === "lmstudio") setLmstudioBaseUrl(config.local_base_url);
        else if (config.provider === "local") setLocalBaseUrl(config.local_base_url);
      }

      setEnableMultiAgent(config.enable_multi_agent);
      if (config.enable_multi_agent && config.agent_configs) {
        setNumAgents(config.agent_configs.length);
        setAgentConfigs(config.agent_configs.map((a: any) => {
          const normalizedAgentSelection = normalizeSkillAndToolSelection(
            a.skills,
            a.tools?.allow || a.allowed_tools,
            availableSkillIds,
          );
          const normalizedAgentToolPolicy = getLoadedAgentToolPolicy(a);

          return {
            id: a.id,
            name: a.name,
            model: normalizeModelRefForUi(a.model, normalizedProviderAuths),
            fallbackModels: (a.fallback_models || []).map((modelRef: string) => normalizeModelRefForUi(modelRef, normalizedProviderAuths)),
            skills: normalizedAgentSelection.skills,
            vibe: a.vibe,
            emoji: a.emoji || "🦞",
            identityMd: a.identity_md || "",
            userMd: a.user_md || "",
            soulMd: a.soul_md || "",
            toolsMd: a.tools_md || "",
            agentsMd: a.agents_md || "",
            toolPolicy: normalizedAgentToolPolicy,
            cronJobs: a.cron_jobs || [],
          };
        }));
      }

      if (config.is_paired !== undefined) {
        setIsPaired(config.is_paired);
      }

      setMaintenanceStatus("✅ Configuration loaded.");
      setMode("advanced"); // Switch to advanced mode to show all settings
      return true;
    } catch (e) {
      console.error("Failed to load config:", e);
      setMaintenanceStatus(`❌ Failed to load config: ${e}`);
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleTunnel() {
    setLoading(true);
    if (tunnelActive) {
      try {
        await invoke("stop_ssh_tunnel");
        setTunnelActive(false);
        setMaintenanceStatus("✅ SSH Tunnel disconnected.");
      } catch (e) {
        setMaintenanceStatus(`❌ Failed to stop tunnel: ${e}`);
      }
    } else {
      setMaintenanceStatus("Establishing SSH tunnel...");
      try {
        const remote = {
          ip: remoteIp,
          user: remoteUser,
          password: remotePassword || null,
          privateKeyPath: remotePrivateKeyPath || null
        };
        await invoke("start_ssh_tunnel", { remote });
        setTunnelActive(true);
        setMaintenanceStatus("✅ SSH Tunnel established on port 18789.");
      } catch (e) {
        setMaintenanceStatus(`❌ Failed to establish tunnel: ${e}`);
      }
    }
    setLoading(false);
  }

  const toggleSkill = (id: string) => {
    setSelectedSkills(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const getStepStatus = (stepId: number) => {
    if (step === stepId) return "active";
    if (step > stepId) return "completed";
    return "";
  };



  const currentPayload = constructConfigPayload();
  const initialPayload = transformInitialToPayload(initialConfigRef.current);
  const hasChanges = !initialConfigRef.current || !isDeepEqual(initialPayload, currentPayload);

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="step-view">
            <h2>Welcome Back</h2>
            <p className="step-description">
              OpenClaw is already installed {targetEnvironment === "cloud" ? `on ${remoteIp}` : "on your system"}. What would you like to do?
            </p>

            {/* Quick Action Buttons */}
            <div className="button-group" style={{ gap: "10px", marginBottom: "2rem" }}>
              <button
                className="primary"
                style={{ flex: 1 }}
                onClick={async () => {
                  try {
                    const url: string = await invoke("get_dashboard_url", {
                      isRemote: targetEnvironment === "cloud",
                      remote: targetEnvironment === "cloud" ? {
                        ip: remoteIp,
                        user: remoteUser,
                        password: remotePassword || null,
                        privateKeyPath: remotePrivateKeyPath || null
                      } : null
                    });
                    await open(url);
                  } catch (e) {
                    setMaintenanceStatus(`❌ Failed to get dashboard URL: ${e}`);
                  }
                }}
                disabled={targetEnvironment === "cloud" && !tunnelActive}
              >
                🌐 Open Dashboard
              </button>

              {targetEnvironment === "cloud" && (
                <button
                  className="secondary"
                  style={{ flex: 1 }}
                  onClick={async () => {
                    if (tunnelActive) {
                      // Stop tunnel
                      try {
                        await invoke("stop_ssh_tunnel");
                        setTunnelActive(false);
                        setMaintenanceStatus("✅ SSH tunnel stopped.");
                      } catch (e) {
                        setMaintenanceStatus(`❌ Failed to stop tunnel: ${e}`);
                      }
                    } else {
                      // Start tunnel - check if we have SSH config
                      if (!remoteIp || !remoteUser) {
                        setMaintenanceStatus("❌ SSH configuration missing. Please reconfigure to set up remote connection.");
                        return;
                      }

                      try {
                        // Test connection first if not already successful
                        if (sshStatus !== "success") {
                          setMaintenanceStatus("Testing SSH connection...");
                          await invoke("test_ssh_connection", {
                            remote: {
                              ip: remoteIp,
                              user: remoteUser,
                              password: remotePassword || null,
                              privateKeyPath: remotePrivateKeyPath || null
                            }
                          });
                          setSshStatus("success");
                        }

                        // Establish tunnel
                        setMaintenanceStatus("Establishing SSH tunnel...");
                        await invoke("start_ssh_tunnel", {
                          remote: {
                            ip: remoteIp,
                            user: remoteUser,
                            password: remotePassword || null,
                            privateKeyPath: remotePrivateKeyPath || null
                          }
                        });
                        setTunnelActive(true);
                        setMaintenanceStatus("✅ SSH tunnel established successfully. Dashboard is now accessible.");
                      } catch (e) {
                        const friendlyError = formatSshError(String(e));
                        setMaintenanceStatus(`❌ Failed to establish tunnel: ${friendlyError}`);
                        setSshStatus("idle");
                      }
                    }
                  }}
                >
                  {tunnelActive ? "🔓 Stop SSH Tunnel" : "🔒 Establish SSH Tunnel"}
                </button>
              )}
            </div>

            {/* Maintenance Options */}
            <h3 style={{ marginBottom: "1rem" }}>Maintenance Options</h3>
            <div className="mode-card-container" style={{ gridTemplateColumns: "1fr", gap: "1rem" }}>
              <div
                className={`mode-card ${selectedMaint === "repair" ? "active" : ""}`}
                onClick={() => !loading && setSelectedMaint("repair")}
              >
                <h3>🛠 Repair System</h3>
                <p>Run <code>openclaw doctor --repair</code> to fix configuration and service issues.</p>
              </div>

              <div
                className={`mode-card ${selectedMaint === "audit" ? "active" : ""}`}
                onClick={() => !loading && setSelectedMaint("audit")}
              >
                <h3>🛡 Security Audit</h3>
                <p>Run <code>openclaw security audit --fix</code> to audit and tighten system permissions.</p>
              </div>

              <div
                className={`mode-card ${selectedMaint === "update" ? "active" : ""}`}
                onClick={() => !loading && setSelectedMaint("update")}
              >
                <h3>🚀 Upgrade OpenClaw Version</h3>
                <p>Upgrade to the latest version of OpenClaw.</p>
              </div>

              <div
                className={`mode-card ${selectedMaint === "reconfigure" ? "active" : ""}`}
                onClick={() => !loading && setSelectedMaint("reconfigure")}
              >
                <h3>⚙️ Reconfigure OpenClaw</h3>
                <p>Proceed to the standard setup wizard to re-configure your agent and channels.</p>
              </div>

              <div
                className={`mode-card ${selectedMaint === "uninstall" ? "active" : ""}`}
                style={selectedMaint === "uninstall" ? { borderColor: "var(--error)", backgroundColor: "rgba(239, 68, 68, 0.05)" } : {}}
                onClick={() => !loading && setSelectedMaint("uninstall")}
              >
                <h3 style={selectedMaint === "uninstall" ? { color: "var(--error)" } : {}}>🗑 Uninstall Completely</h3>
                <p>Remove the OpenClaw CLI and all {targetEnvironment === "local" ? "local" : "remote"} configuration/data files.</p>
              </div>
            </div>

            {!loading && (
              <div className="button-group" style={{ gap: "10px", marginTop: "1.5rem" }}>
                <button
                  className="primary"
                  style={{ flex: 1 }}
                  onClick={async () => {
                    if (selectedMaint === "reconfigure") {
                      // Load existing config first
                      const loaded = await loadExistingConfig();
                      if (loaded) {
                        // Go to Configuration Mode (Step 3 or 5 depending on preference)
                        // Step 3 is security check, usually good to show again.
                        setMode("advanced"); setStep(6);
                      }
                    } else if (selectedMaint === "uninstall") {
                      if (confirm("Are you absolutely sure you want to completely remove OpenClaw and all its data?")) {
                        handleMaintenanceAction("uninstall");
                      }
                    } else if (selectedMaint) {
                      handleMaintenanceAction(selectedMaint);
                    }
                  }}
                  disabled={!selectedMaint}
                >
                  Confirm Action
                </button>
                {maintCompleted && (
                  <button className="secondary" style={{ flex: 1 }} onClick={() => invoke("close_app")}>Exit Setup</button>
                )}
              </div>
            )}

            {maintenanceStatus && (
              <div className="progress-container" style={{ marginTop: "2rem" }}>
                <p style={{ fontSize: "0.9rem", color: maintenanceStatus.includes("❌") ? "var(--error)" : maintenanceStatus.includes("✅") ? "var(--success)" : "var(--primary)" }}>{maintenanceStatus}</p>
                <div className="logs-container">
                  <pre>{logs}</pre>
                </div>
              </div>
            )}
          </div>
        );
      case 0.5:
        return (
          <div className="step-view welcome-view">
            <div className="welcome-logo">🦞</div>
            <h1 className="welcome-title">Welcome to Clawnetes</h1>
            <p className="welcome-text">
              The fastest way to deploy your AI agent. Get started in minutes.
            </p>
            <div className="button-group" style={{ justifyContent: "center" }}>
              <button
                className="primary"
                style={{ minWidth: "200px", padding: "1rem 2rem", fontSize: "1.1rem" }}
                onClick={() => setStep(1)}
              >
                Start Setup
              </button>
            </div>
          </div>
        );
      case 1:
        return (
          <div className="step-view">
            <h2>Target Environment</h2>
            <p className="step-description">Where will you be running OpenClaw?</p>
            <div className="mode-card-container">
              <div className={`mode-card ${targetEnvironment === "local" ? "active" : ""}`} onClick={() => {
                setTargetEnvironment("local");
                setSshStatus("idle");
              }}>
                <h3>💻 Local Machine</h3>
                <p>Run OpenClaw directly on your computer (macOS/Linux/Windows)</p>
              </div>
              <div className={`mode-card ${targetEnvironment === "cloud" ? "active" : ""}`} onClick={() => setTargetEnvironment("cloud")}>
                <h3>☁️ Cloud Server</h3>
                <p>Deploy to a cloud VM (AWS, GCP, Azure, etc.)</p>
              </div>
            </div>

            {targetEnvironment === "cloud" && (
              <div className="remote-config" style={{ marginTop: "2rem" }}>
                <h3 style={{ marginBottom: "1rem" }}>SSH Configuration</h3>
                <div className="form-group">
                  <label>Server IP Address</label>
                  <input
                    placeholder="192.168.1.100"
                    value={remoteIp}
                    onChange={(e) => setRemoteIp(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>SSH Username</label>
                  <input
                    placeholder="ubuntu"
                    value={remoteUser}
                    onChange={(e) => setRemoteUser(e.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                </div>
                <div className="form-group">
                  <label>SSH Private Key (Optional)</label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      placeholder="/Users/you/.ssh/id_rsa"
                      value={remotePrivateKeyPath}
                      onChange={(e) => setRemotePrivateKeyPath(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="secondary"
                      onClick={async () => {
                        const path = await openDialog({
                          title: "Select SSH Private Key",
                          directory: false,
                          multiple: false,
                          defaultPath: "~/.ssh",
                        });
                        if (path && typeof path === "string") {
                          setRemotePrivateKeyPath(path);
                        }
                      }}
                    >
                      Browse
                    </button>
                  </div>
                  <p className="input-hint">Leave empty to use default keys (~/.ssh/id_rsa, id_ed25519) or SSH agent</p>
                </div>
                <div className="form-group">
                  <label>SSH Password (if not using key)</label>
                  <input
                    type="password"
                    placeholder="Password"
                    value={remotePassword}
                    onChange={(e) => setRemotePassword(e.target.value)}
                  />
                </div>

                <button
                  className="secondary"
                  onClick={handleSshCheck}
                  disabled={!remoteIp || !remoteUser || sshStatus === "checking"}
                  style={{ width: "100%", marginTop: "1rem" }}
                >
                  {sshStatus === "checking" ? "Testing..." : "Test Connection"}
                </button>

                {sshStatus === "success" && (
                  <div style={{ marginTop: "1rem", padding: "0.75rem", backgroundColor: "rgba(34, 197, 94, 0.1)", borderRadius: "8px", border: "1px solid rgba(34, 197, 94, 0.3)" }}>
                    <strong style={{ color: "rgb(34, 197, 94)" }}>✅ Success:</strong> <span style={{ color: "var(--text)" }}>SSH connection established successfully!</span>
                  </div>
                )}

                {sshError && (
                  <div className="error" style={{ marginTop: "1rem", padding: "0.75rem", backgroundColor: "rgba(239, 68, 68, 0.1)", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
                    <strong style={{ color: "rgb(239, 68, 68)" }}>❌ Error:</strong> <span style={{ color: "var(--text)" }}>{sshError}</span>
                  </div>
                )}
              </div>
            )}

            <div className="button-group" style={{ marginTop: "2rem" }}>
              <button
                className="primary"
                onClick={async () => {
                  if (targetEnvironment === "cloud") {
                    const redirected = await checkRemoteSystem(false);
                    if (!redirected) {
                      setStep(2);
                    }
                  } else {
                    // Local environment - check local system and redirect if installed
                    const redirected = await checkSystem(false);
                    if (!redirected) {
                      setStep(2);
                    }
                  }
                }}
                disabled={targetEnvironment === "cloud" && sshStatus !== "success"}
              >
                Continue
              </button>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="step-view">
            <h2>System Check</h2>
            <p className="step-description">
              {targetEnvironment === "cloud"
                ? `Checking remote server (${remoteIp})...`
                : "We need to make sure your system is ready for OpenClaw."}
            </p>
            <div className="check-item">
              <span className="check-status">{checks.node ? "✅" : "❌"}</span>
              Node.js {checks.node ? "detected" : "not found"} {targetEnvironment === "cloud" && `(on ${remoteIp})`}
            </div>
            <div className="check-item">
              <span className="check-status">{checks.openclaw ? "✅" : "⏳"}</span>
              OpenClaw {checks.openclaw ? "Installed" : "Ready to install"} {targetEnvironment === "cloud" && `(on ${remoteIp})`}
            </div>
            {!checks.node && (
              <div className="error" style={{ marginTop: "1rem", color: "var(--error)" }}>
                <p>Node.js is required.</p>
                {targetEnvironment === "local" && (
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "5px" }}>
                    <button
                      className="secondary small"
                      onClick={installLocalNode}
                      disabled={installingNode}
                      style={{ padding: "4px 10px", fontSize: "0.8rem", cursor: "pointer" }}
                    >
                      {installingNode ? "Installing..." : "Install Now"}
                    </button>
                    {nodeInstallError && <span style={{ fontSize: "0.8rem" }}>{nodeInstallError}</span>}
                  </div>
                )}
                {targetEnvironment === "cloud" && (
                  <p>It will be installed automatically in the Setup step.</p>
                )}
              </div>
            )}
            <div className="button-group">
              <button
                className="primary"
                disabled={targetEnvironment === "local" && !checks.node}
                onClick={() => setStep(3)}
              >
                Continue
              </button>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="step-view">
            <h2>Security Baseline</h2>
            <p className="step-description">Please read this carefully before proceeding.</p>
            <div className="security-alert">
              <p>OpenClaw is a powerful agent system that can execute code and manage files.</p>
              <p>A malicious prompt could potentially trick the agent into performing unsafe actions. We recommend running it in a sandboxed environment if possible.</p>
              <p>Keep your API keys secure and never share your gateway token.</p>
            </div>
            <p style={{ fontWeight: 600 }}>Do you understand the risks and wish to continue?</p>
            <div className="button-group">
              <button className="primary" onClick={() => setStep(5)}>I Understand</button>
              <button className="secondary" onClick={() => setStep(2)}>Back</button>
            </div>
          </div>
        );
      case 5:
        return (
          <div className="step-view">
            <h2>Your Identity</h2>
            <p className="step-description">What should the agent call you?</p>
            <div className="form-group">
              <label>Your Name</label>
              <input
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                autoComplete="off"
                placeholder="e.g. David"
                value={userName}
                onChange={(e) => {
                  const val = e.target.value;
                  setUserName(val);
                  if (userMd) {
                    setUserMd(updateIdentityField(userMd, "Name", val));
                  }
                  if (soulMd) {
                    setSoulMd(updateSoulMission(soulMd, val));
                  }
                }}
              />
            </div>
            <div className="button-group">
              <button className="primary" disabled={!userName} onClick={() => setStep(6)}>Next</button>
              <button className="secondary" onClick={() => setStep(3)}>Back</button>
            </div>
          </div>
        );
      case 6:
        return (
          <div className="step-view">
            <h2>Agent Profile</h2>
            <p className="step-description">Give your agent a name and a personality.</p>
            <div className="form-group">
              <label>Agent Name</label>
              <input autoFocus placeholder="e.g. Jeeves" value={agentName} onChange={(e) => {
                const val = e.target.value;
                setAgentName(val);
                if (identityMd) {
                  setIdentityMd(updateIdentityField(identityMd, "Name", val));
                }
              }} />
            </div>
            <div className="form-group">
              <label>Agent Emoji</label>
              <div className="emoji-grid" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {EMOJI_OPTIONS.map(e => (
                  <button
                    key={e}
                    className={`emoji-btn`}
                    onClick={() => {
                      setAgentEmoji(e);
                      if (identityMd) {
                        setIdentityMd(updateIdentityField(identityMd, "Emoji", e));
                      }
                    }}
                    style={{
                      fontSize: "1.25rem",
                      padding: "0.4rem",
                      borderRadius: "8px",
                      border: agentEmoji === e ? "2px solid var(--primary)" : "1px solid var(--border)",
                      background: agentEmoji === e ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
                      cursor: "pointer",
                      minWidth: "40px"
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div className="button-group">
              <button className="primary" disabled={!agentName} onClick={() => setStep(6.5)}>Next</button>
              <button className="secondary" onClick={() => setStep(skipBasicConfig ? 0 : 5)}>Back</button>
            </div>
          </div>
        );
      case 6.5:
        return (
          <div className="step-view">
            <h2>Agent Type</h2>
            <p className="step-description">Choose a pre-configured agent type or build your own from scratch.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              {[
                { id: "coding-assistant" as AgentTypeId, name: "Coding Assistant", emoji: "👨‍💻", desc: "A senior software engineer that writes clean, secure code." },
                { id: "office-assistant" as AgentTypeId, name: "Office Assistant", emoji: "🤵", desc: "A professional executive assistant for email, tasks, and comms." },
                { id: "travel-planner" as AgentTypeId, name: "Travel Planner", emoji: "🌍", desc: "An expert travel agent that plans trips and finds deals." },
                { id: "custom" as AgentTypeId, name: "Custom", emoji: "🔧", desc: "Configure everything manually from scratch." }
              ].map(t => (
                <div
                  key={t.id}
                  className={`mode-card ${agentType === t.id ? "active" : ""}`}
                  onClick={() => {
                    applyAgentTypePreset(t.id);
                  }}
                  style={{
                    padding: "1.5rem",
                    borderRadius: "12px",
                    border: agentType === t.id ? "2px solid var(--primary)" : "1px solid var(--border)",
                    backgroundColor: agentType === t.id ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
                    cursor: "pointer",
                    textAlign: "center"
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>{t.emoji}</div>
                  <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{t.name}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{t.desc}</div>
                </div>
              ))}
            </div>
            <div className="button-group" style={{ marginTop: "1.5rem" }}>
              <button className="primary" onClick={() => {
                if (isPresetAgent) {
                  setStep(6.7);
                } else {
                  setStep(8);
                }
              }}>Next</button>
              <button className="secondary" onClick={() => setStep(6)}>Back</button>
            </div>
          </div>
        );
      case 6.7: {
        const presetData = AGENT_TYPE_PRESETS[agentType];
        return (
          <div className="step-view">
            <h2>Configuration Review</h2>
            <p className="step-description">Your {presetData?.name || "agent"} is pre-configured with these settings. Enter your API key to continue.</p>

            {presetData && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.5rem" }}>
                <div className="status-card" style={{ padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Model</div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{presetData.model.split("/").pop()}</div>
                </div>
                <div className="status-card" style={{ padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Fallback</div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{presetData.fallbackModels[0]?.split("/").pop() || "None"}</div>
                </div>
                <div className="status-card" style={{ padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Skills</div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{presetData.skills.length} configured</div>
                </div>
                <div className="status-card" style={{ padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Heartbeat</div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{presetData.heartbeatMode === "never" ? "Disabled" : `Every ${presetData.heartbeatMode}`}</div>
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Skills Included</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" }}>
                {selectedSkills.map(s => (
                  <span key={s} style={{
                    padding: "0.25rem 0.75rem",
                    borderRadius: "20px",
                    backgroundColor: "rgba(255, 59, 48, 0.08)",
                    border: "1px solid var(--primary)",
                    fontSize: "0.8rem",
                    fontWeight: 500
                  }}>
                    {SKILL_ICONS[s] && <img src={SKILL_ICONS[s]} alt="" style={{ width: "14px", height: "14px", marginRight: "4px", verticalAlign: "middle", borderRadius: "3px" }} />}
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ marginTop: "1.5rem" }}>
              {renderProviderAuthEditor(provider)}
            </div>

            {/* Show auth keys for skills that require them */}
            {selectedSkills.filter(s => {
              const skill = availableSkills.find(sk => sk.id === s);
              return skill?.requiresAuth && skill.authMode !== "oauth";
            }).length > 0 && (
                <div className="form-group" style={{ marginTop: "1rem" }}>
                  <label>Skill API Keys (Optional)</label>
                  {selectedSkills.filter(s => {
                    const skill = availableSkills.find(sk => sk.id === s);
                    return skill?.requiresAuth && skill.authMode !== "oauth";
                  }).map(s => {
                    const skill = availableSkills.find(sk => sk.id === s)!;
                    return (
                      <div key={s} style={{ marginTop: "0.5rem" }}>
                        <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{skill.name}</label>
                        <input
                          type="password"
                          value={serviceKeys[s] || ""}
                          onChange={(e) => setServiceKeys({ ...serviceKeys, [s]: e.target.value })}
                          placeholder={skill.authPlaceholder || "API Key"}
                          autoComplete="off"
                        />
                      </div>
                    );
                  })}
                </div>
              )}

            {selectedSkills.filter(s => {
              const skill = availableSkills.find(sk => sk.id === s);
              return skill?.authMode === "oauth";
            }).length > 0 && (
              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Skill OAuth (Deferred)</label>
                {selectedSkills.filter(s => {
                  const skill = availableSkills.find(sk => sk.id === s);
                  return skill?.authMode === "oauth";
                }).map(s => {
                  const skill = availableSkills.find(sk => sk.id === s)!;
                  return (
                    <div key={s} style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      {skill.name}: an OpenClaw terminal auth step will run at the end of setup.
                    </div>
                  );
                })}
              </div>
            )}

            <div className="button-group" style={{ marginTop: "1.5rem" }}>
              <button className="primary" disabled={!LOCAL_PROVIDERS.has(provider) && !isOAuthMethod(getProviderAuth(provider).auth_method) && !getProviderAuth(provider).token} onClick={() => setStep(9)}>Next</button>
              <button className="secondary" onClick={() => setStep(6.5)}>Back</button>
            </div>
          </div>
        );
      }
      case 7:
        return (
          <div className="step-view">
            <h2>Gateway Settings</h2>
            <p className="step-description">Configure the network bridge for your agent.</p>
            <div className="form-group">
              <label>Port</label>
              <input type="number" value={gatewayPort} onChange={(e) => setGatewayPort(parseInt(e.target.value))} />
            </div>
            <div className="form-group">
              <label>Bind Address</label>
              <Dropdown
                value={gatewayBind}
                onChange={setGatewayBind}
                options={[
                  { value: "loopback", label: "Loopback (127.0.0.1)", description: "Only accessible from this machine" },
                  { value: "all", label: "All Interfaces (0.0.0.0)", description: "Accessible from local network" }
                ]}
              />
            </div>
            <div className="form-group" style={{ marginTop: "1.5rem" }}>
              <label>Auth Mode</label>
              <Dropdown
                value={gatewayAuthMode}
                onChange={setGatewayAuthMode}
                options={[
                  { value: "token", label: "Token (Secure)", description: "Requires authentication token" },
                  { value: "none", label: "None (Insecure)", description: "No authentication required" }
                ]}
              />
            </div>
            <div className="form-group" style={{ marginTop: "1.5rem" }}>
              <label>Tailscale</label>
              <Dropdown
                value={tailscaleMode}
                onChange={setTailscaleMode}
                options={[
                  { value: "off", label: "Disabled", description: "Standard networking" },
                  { value: "on", label: "Enabled", description: "Expose securely via Tailscale" }
                ]}
              />
            </div>
            <div className="button-group">
              <button className="primary" onClick={() => {
                setStep(10);
              }}>Continue</button>
              <button className="secondary" onClick={() => setStep(6)}>Back</button>
            </div>
          </div>
        );
      case 8:
        return (
          <div className="step-view">
            <h2>Connect Brain</h2>
            <p className="step-description">Select your AI provider and authentication method.</p>

            <div className="form-group">
              <label>AI Provider</label>
              <Dropdown
                value={provider}
                onChange={(p) => {
                  setProvider(p);
                  const defaultModel = getProviderDefaultModel(p);
                  if (defaultModel) {
                    setModel(defaultModel);
                  } else if (getProviderModelOptions(p).length > 0) {
                    setModel(getProviderModelOptions(p)[0].value);
                  }
                }}
                options={[
                  { value: "anthropic", label: "Anthropic", icon: PROVIDER_LOGOS["anthropic"] },
                  { value: "openai", label: "OpenAI", icon: PROVIDER_LOGOS["openai"] },
                  { value: "google", label: "Google Gemini", icon: PROVIDER_LOGOS["google"] },
                  { value: "openrouter", label: "OpenRouter", icon: PROVIDER_LOGOS["openrouter"] },
                  { value: "xai", label: "xAI (Grok)", icon: PROVIDER_LOGOS["xai"] },
                  { value: "ollama", label: "Ollama (Local)", icon: PROVIDER_LOGOS["ollama"] },
                  { value: "lmstudio", label: "LM Studio (Local)", icon: PROVIDER_LOGOS["lmstudio"] },
                  { value: "local", label: "Custom Local Endpoint", icon: PROVIDER_LOGOS["local"] },
                ]}
              />
            </div>

            {renderProviderAuthEditor(provider, { keyPrefix: "primary-provider", showProviderLabel: false, marginTop: "1.5rem" })}

            {/* LM Studio base URL input */}
            {provider === "lmstudio" && (
              <div className="form-group" style={{ marginTop: "1.5rem" }}>
                <label>LM Studio Base URL</label>
                <input
                  type="text"
                  value={lmstudioBaseUrl}
                  onChange={(e) => setLmstudioBaseUrl(e.target.value)}
                  placeholder="http://localhost:1234"
                />
              </div>
            )}

            {/* Custom local endpoint URL input */}
            {provider === "local" && (
              <div className="form-group" style={{ marginTop: "1.5rem" }}>
                <label>Local Endpoint Base URL</label>
                <input
                  type="text"
                  value={localBaseUrl}
                  onChange={(e) => setLocalBaseUrl(e.target.value)}
                  placeholder="http://localhost:8080"
                />
              </div>
            )}

            <div className="form-group" style={{ marginTop: "1.5rem" }}>
              <label>Primary Model</label>
              {/* Ollama dynamic detection */}
              {provider === "ollama" && (
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <button
                    className="secondary"
                    style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                    disabled={ollamaDetecting}
                    onClick={async () => {
                      setOllamaDetecting(true);
                      try {
                        const remoteConfig = targetEnvironment === "cloud" ? {
                          ip: remoteIp, user: remoteUser,
                          password: remotePassword || null,
                          privateKeyPath: remotePrivateKeyPath || null
                        } : null;
                        const models: string[] = await invoke("get_ollama_models", { remote: remoteConfig });
                        setOllamaModels(models);
                        if (models.length > 0) setModel(`ollama/${models[0]}`);
                      } catch (e) {
                        console.error("Ollama detection failed:", e);
                      }
                      setOllamaDetecting(false);
                    }}
                  >
                    {ollamaDetecting ? "Detecting..." : "Detect Models"}
                  </button>
                  {ollamaModels.length > 0 && (
                    <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>
                      Found {ollamaModels.length} model(s)
                    </span>
                  )}
                </div>
              )}
              {/* LM Studio dynamic detection */}
              {provider === "lmstudio" && (
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <button
                    className="secondary"
                    style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                    disabled={lmstudioDetecting}
                    onClick={async () => {
                      setLmstudioDetecting(true);
                      try {
                        const remoteConfig = targetEnvironment === "cloud" ? {
                          ip: remoteIp, user: remoteUser,
                          password: remotePassword || null,
                          privateKeyPath: remotePrivateKeyPath || null
                        } : null;
                        const models: string[] = await invoke("get_lmstudio_models", {
                          baseUrl: lmstudioBaseUrl,
                          remote: remoteConfig
                        });
                        const prefixedModels = models.map(m => `lmstudio/${m}`);
                        setLmstudioModels(prefixedModels);
                        if (prefixedModels.length > 0) setModel(prefixedModels[0]);
                      } catch (e) {
                        console.error("LM Studio detection failed:", e);
                      }
                      setLmstudioDetecting(false);
                    }}
                  >
                    {lmstudioDetecting ? "Detecting..." : "Detect Models"}
                  </button>
                  {lmstudioModels.length > 0 && (
                    <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>
                      Found {lmstudioModels.length} model(s)
                    </span>
                  )}
                </div>
              )}
              {/* Custom local endpoint detection */}
              {provider === "local" && (
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <button
                    className="secondary"
                    style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                    disabled={localDetecting}
                    onClick={async () => {
                      setLocalDetecting(true);
                      try {
                        const remoteConfig = targetEnvironment === "cloud" ? {
                          ip: remoteIp, user: remoteUser,
                          password: remotePassword || null,
                          privateKeyPath: remotePrivateKeyPath || null
                        } : null;
                        const models: string[] = await invoke("get_lmstudio_models", {
                          baseUrl: localBaseUrl,
                          remote: remoteConfig
                        });
                        setLocalModels(models);
                        if (models.length > 0) setModel(`local/${models[0]}`);
                      } catch (e) {
                        console.error("Local endpoint detection failed:", e);
                      }
                      setLocalDetecting(false);
                    }}
                  >
                    {localDetecting ? "Detecting..." : "Detect Models"}
                  </button>
                  {localModels.length > 0 && (
                    <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>
                      Found {localModels.length} model(s)
                    </span>
                  )}
                </div>
              )}
              <Dropdown
                value={model}
                onChange={setModel}
                searchable={MODELS_BY_PROVIDER[provider] ? MODELS_BY_PROVIDER[provider].length > 10 : false}
                options={
                  provider === "ollama" && ollamaModels.length > 0
                    ? ollamaModels.map(m => ({ value: `ollama/${m}`, label: m }))
                    : provider === "lmstudio" && lmstudioModels.length > 0
                      ? lmstudioModels.map(m => ({ value: m, label: m }))
                      : provider === "local" && localModels.length > 0
                        ? localModels.map(m => ({ value: `local/${m}`, label: m }))
                        : MODELS_BY_PROVIDER[provider]
                          ? getProviderModelOptions(provider)
                          : [{ value: model, label: model }]
                }
              />
              {/* Manual model entry for local providers when detection fails */}
              {(provider === "ollama" || provider === "lmstudio" || provider === "local") && (
                <div style={{ marginTop: "0.5rem" }}>
                  <input
                    type="text"
                    placeholder={`Or type model name manually (e.g. ${provider === "ollama" ? "llama3.2" : "your-model-id"})`}
                    style={{ fontSize: "0.85rem" }}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val) setModel(provider === "lmstudio" ? val : `${provider}/${val}`);
                    }}
                  />
                </div>
              )}
            </div>

            {/* Thinking Level for Claude 4.x models */}
            {provider === "anthropic" && model.includes("claude-") && model.includes("-4") && (
              <div className="form-group" style={{ marginTop: "1.5rem" }}>
                <label>Thinking Level</label>
                <Dropdown
                  value={thinkingLevel}
                  onChange={setThinkingLevel}
                  options={[
                    { value: "adaptive", label: "Adaptive (Recommended)", description: "Automatically adjusts thinking depth" },
                    { value: "off", label: "Off", description: "No extended thinking" },
                    { value: "low", label: "Low", description: "Minimal thinking budget" },
                    { value: "medium", label: "Medium", description: "Balanced thinking budget" },
                    { value: "high", label: "High", description: "Maximum thinking depth" },
                  ]}
                />
                <p className="input-hint">Extended thinking improves reasoning on complex tasks. Available for Claude 4.x models.</p>
              </div>
            )}

            {["ollama", "lmstudio", "local"].includes(provider) && (
              <p className="input-hint" style={{ marginBottom: "1rem", textAlign: "center", color: "var(--success)" }}>
                No API key required for local providers.
              </p>
            )}
            {!["ollama", "lmstudio", "local"].includes(provider) && (
              <p className="input-hint" style={{ marginBottom: "1rem", textAlign: "center" }}>
                You can skip this for now and configure it later via 'Reconfigure'.
              </p>
            )}
            <div className="button-group">
              <button className="primary" onClick={() => setStep(9)}>Next</button>
              <button className="secondary" onClick={() => setStep(6.5)}>Back</button>
            </div>
          </div>
        );
      case 9:
        return (
          <div className="step-view">
            <h2>Messaging Channels</h2>
            <p className="step-description">Select a messaging channel for your agent.</p>

            <div className="form-group">
              <label>Channel</label>
              <Dropdown
                value={messagingChannel === "none" ? "telegram" : messagingChannel}
                onChange={(v) => setMessagingChannel(v as "telegram" | "whatsapp")}
                options={[
                  { value: "telegram", label: "Telegram", description: "Connect via Telegram Bot" },
                  { value: "whatsapp", label: "WhatsApp", description: "Connect via WhatsApp (QR pairing at end of setup)" },
                ]}
              />
            </div>

            {messagingChannel === "telegram" && (
              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Telegram Bot Token</label>
                <input type="password" placeholder="123456:ABC-..." value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} />
                <p className="input-hint">Get one from @BotFather on Telegram.</p>
              </div>
            )}

            {messagingChannel === "whatsapp" && (
              <div style={{ marginTop: "1rem" }}>
                <div className="form-group">
                  <label>WhatsApp DM Policy</label>
                  <Dropdown
                    value={whatsappDmPolicy}
                    onChange={setWhatsappDmPolicy}
                    options={[
                      { value: "allowlist", label: "Allowlist (Recommended)", description: "Only your number can interact with the bot" },
                      { value: "open", label: "Open (Dangerous)", description: "Anyone who messages the bot can interact with it" },
                    ]}
                  />
                  <p className="input-hint" style={{ marginTop: "0.25rem" }}>
                    If you use Allowlist, enter your phone number below so the bot can reply to you.
                  </p>
                </div>

                {whatsappDmPolicy === "allowlist" && (
                  <div className="form-group" style={{ marginTop: "1rem" }}>
                    <label>Your Phone Number (Allowlist)</label>
                    <input
                      type="text"
                      placeholder="+1234567890"
                      value={whatsappPhoneNumber}
                      onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                    />
                    <p className="input-hint">The phone number you will use to message the bot. Include country code.</p>
                  </div>
                )}

                <p className="input-hint" style={{ marginTop: "1rem", color: "var(--text-muted)" }}>
                  WhatsApp pairing will happen at the end of setup. You'll scan a QR code to link your account.
                </p>
              </div>
            )}

            <div className="button-group" style={{ marginTop: "1.5rem" }}>
              <button className="primary" onClick={() => {
                if (mode === "advanced" || skipBasicConfig) handleAdvancedTransition();
                else setStep(16);
              }} disabled={loading}>
                {mode === "advanced" ? "Continue" : "Next"}
              </button>
              <button className="secondary" onClick={() => setStep(8)} disabled={loading}>Back</button>
            </div>
          </div>
        );
      case 10:
        return (
          <div className="step-view">
            <h2>Runtime Environment</h2>
            <p className="step-description">Configure how the agent executes tools and skills.</p>
            <div className="form-group">
              <label>Node Package Manager</label>
              <Dropdown
                value={nodeManager}
                onChange={setNodeManager}
                options={[
                  { value: "npm", label: "npm" },
                  { value: "pnpm", label: "pnpm" },
                  { value: "bun", label: "bun" }
                ]}
              />
            </div>
            <div className="button-group">
              <button className="primary" onClick={() => setStep(10.5)}>Next</button>
              <button className="secondary" onClick={() => {
                if (skipBasicConfig) {
                  setStep(7);
                } else {
                  setStep(9);
                }
              }}>Back</button>
            </div>
          </div>
        );
      case 11:
        return (
          <div className="step-view">
            <h2>Give {agentName ? `${agentName}` : "your agent"} some skills</h2>
            <p className="step-description">Enable capabilities and configure required keys.</p>
            <div className="skills-container" style={{ maxHeight: "450px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem" }}>
              <div className="skills-grid">
                {availableSkills.map(skill => (
                  <div
                    key={skill.id}
                    className={`skill-card ${selectedSkills.includes(skill.id) ? "active" : ""}`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).tagName === "INPUT") return;
                      toggleSkill(skill.id);
                    }}
                    style={{
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                      minHeight: "100px"
                    }}
                  >
                    <div className="skill-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        {SKILL_ICONS[skill.id] && (
                          <img
                            src={SKILL_ICONS[skill.id]}
                            alt=""
                            style={{
                              width: "20px",
                              height: "20px",
                              objectFit: "contain",
                              borderRadius: "4px",
                              backgroundColor: "white",
                              padding: "2px",
                              marginRight: "8px"
                            }}
                          />
                        )}
                        <div className="skill-name" style={{ fontWeight: 700 }}>{skill.name}</div>
                      </div>
                      <div className={`radio-circle ${selectedSkills.includes(skill.id) ? "checked" : ""}`} style={{
                        width: "18px",
                        height: "18px",
                        borderRadius: "50%",
                        border: `2px solid ${selectedSkills.includes(skill.id) ? "var(--primary)" : "var(--text-muted)"}`,
                        backgroundColor: selectedSkills.includes(skill.id) ? "var(--primary)" : "transparent",
                        flexShrink: 0
                      }} />
                    </div>
                    <div className="skill-desc" style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: "1.4" }}>{skill.desc}</div>

                    {skill.requiresAuth && selectedSkills.includes(skill.id) && (
                      <div className="skill-auth" style={{ marginTop: "auto", paddingTop: "0.5rem" }}>
                        {skill.authMode === "oauth" ? (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: "100%", fontSize: "0.8rem", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border)", color: "var(--text-muted)" }}
                          >
                            Browser authentication will run at the end of setup.
                          </div>
                        ) : (
                          <input
                            type="password"
                            placeholder={skill.authPlaceholder || "API Key"}
                            value={serviceKeys[skill.id] || ""}
                            onChange={(e) => setServiceKeys({ ...serviceKeys, [skill.id]: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: "100%", fontSize: "0.8rem", padding: "0.5rem", borderRadius: "8px" }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: "1.5rem" }}>
              <button className="secondary" onClick={() => setShowCustomSkillForm(!showCustomSkillForm)}>
                {showCustomSkillForm ? "Hide" : "+ Add"} Custom Skill
              </button>
            </div>

            {showCustomSkillForm && (
              <div className="custom-skill-form" style={{ marginTop: "1.5rem" }}>
                <div className="form-group">
                  <label>Skill Name</label>
                  <input
                    placeholder="my-custom-skill"
                    value={customSkillName}
                    onChange={e => setCustomSkillName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Skill Content (YAML + Markdown)</label>
                  <textarea
                    className="markdown-editor"
                    rows={8}
                    value={customSkillContent}
                    onChange={e => setCustomSkillContent(e.target.value)}
                    placeholder={`---\nname: My Custom Skill\ndescription: A useful skill\n---\n\n# Instructions\nAdd skill documentation here...`}
                  />
                </div>
                <button
                  className="primary"
                  disabled={!customSkillName || !customSkillContent}
                  onClick={async () => {
                    try {
                      await invoke("create_custom_skill", { name: customSkillName, content: customSkillContent });
                      setSelectedSkills([...selectedSkills, customSkillName]);
                      setCustomSkillName("");
                      setCustomSkillContent("");
                      setShowCustomSkillForm(false);
                    } catch (e) {
                      alert("Failed to create skill: " + e);
                    }
                  }}
                >
                  Save Custom Skill
                </button>
              </div>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => {
                if (mode === "advanced") {
                  setStep(11.1);
                } else {
                  handleInstall();
                }
              }}>Continue</button>
              <button className="secondary" onClick={() => setStep(13)}>Back</button>
            </div>
          </div>
        );
      case 11.1:
        return (
          <div className="step-view">
            <h2>Tool Access</h2>
            <p className="step-description">Configure the base tool profile and individual tool access.</p>

            <ToolPolicyEditor
              policy={toolPolicy}
              onChange={setToolPolicy}
              description="Profiles set the default OpenClaw allowlist. Individual toggles override that baseline."
            />

            <div className="button-group">
              <button className="primary" onClick={() => setStep(15)}>Next</button>
              <button className="secondary" onClick={() => setStep(11)}>Back</button>
            </div>
          </div>
        );
      case 11.5:
        return (
          <div className="step-view">
            <h2>Service Key: {servicesToConfigure[currentServiceIdx].name}</h2>
            <p className="step-description">Would you like to provide a key for this optional service now?</p>

            <div style={{ marginBottom: "2rem" }}>
              <Dropdown
                value={isConfiguringService === true ? "yes" : "no"}
                onChange={(val) => setIsConfiguringService(val === "yes")}
                options={[
                  { value: "yes", label: "Yes", description: `Configure ${servicesToConfigure[currentServiceIdx].name} now.` },
                  { value: "no", label: "Skip", description: "I'll configure this later in the dashboard." }
                ]}
              />
            </div>

            {isConfiguringService === true && (
              <div className="form-group animate-fadeIn">
                <label>{servicesToConfigure[currentServiceIdx].name} API Key</label>
                <input
                  type="password"
                  autoFocus
                  placeholder={servicesToConfigure[currentServiceIdx].placeholder}
                  value={serviceKeys[servicesToConfigure[currentServiceIdx].id] || ""}
                  onChange={(e) => setServiceKeys({ ...serviceKeys, [servicesToConfigure[currentServiceIdx].id]: e.target.value })}
                />
              </div>
            )}

            <div className="button-group">
              <button
                className="primary"
                disabled={isConfiguringService === true && !serviceKeys[servicesToConfigure[currentServiceIdx].id]}
                onClick={() => {
                  const sid = servicesToConfigure[currentServiceIdx].id;
                  const newKeys = { ...serviceKeys };
                  if (!isConfiguringService) delete newKeys[sid];
                  setServiceKeys(newKeys);

                  if (currentServiceIdx < servicesToConfigure.length - 1) {
                    setCurrentServiceIdx(currentServiceIdx + 1);
                    setIsConfiguringService(false);
                  } else {
                    // After last service, go to Step 12 if advanced, otherwise install
                    if (mode === "advanced") {
                      setStep(12);
                    } else {
                      setStep(16);
                    }
                  }
                }}
              >
                {currentServiceIdx < servicesToConfigure.length - 1 ? "Next Service" : (mode === "advanced" ? "Continue to Advanced Settings" : "Next")}
              </button>
              <button className="secondary" onClick={() => {
                if (currentServiceIdx > 0) {
                  setCurrentServiceIdx(currentServiceIdx - 1);
                  setIsConfiguringService(serviceKeys[servicesToConfigure[currentServiceIdx - 1].id] ? true : false);
                } else {
                  setStep(11);
                }
              }} disabled={loading}>Back</button>
            </div>
          </div>
        );
      case 12:
        return (
          <div className="step-view">
            <h2>Security Configuration</h2>
            <p className="step-description">Configure security policies for your agent.</p>

            <div className="form-group">
              <label>Sandbox Mode</label>
              <Dropdown
                value={sandboxMode}
                onChange={setSandboxMode}
                options={[
                  { value: "full", label: "Full Sandbox", description: "REQUIRES DOCKER! Select only if Docker is installed, otherwise this will break." },
                  { value: "partial", label: "Partial Sandbox", description: "Standard isolation." },
                  { value: "none", label: "No Sandbox", description: "Unrestricted access." }
                ]}
              />
            </div>

            <div className="form-group" style={{ marginTop: "1.5rem" }}>
              <ToolPolicyEditor
                policy={toolPolicy}
                onChange={setToolPolicy}
                description="Use a profile as the base, then refine individual tools."
              />
            </div>

            <div className="button-group">
              <button className="primary" onClick={() => setStep(13)}>Continue</button>
              <button className="secondary" onClick={() => setStep(11.5)}>Back</button>
            </div>
          </div>
        );
      case 13: {
        const referencedProviders = buildReferencedProviders({
          primaryModel: model,
          fallbackModels: enableFallbacks ? fallbackModels.filter(Boolean) : [],
        });
        return (
          <div className="step-view">
            <h2>Model Configuration</h2>
            <p className="step-description">Configure your primary and fallback models.</p>

            <div className="form-group" style={{ marginBottom: "1.5rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <label>Primary Model</label>
              <p className="step-description" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>Change the primary model used by your agent.</p>

              <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Provider</label>
              <Dropdown
                value={provider}
                onChange={(p) => {
                  setProvider(p);
                  const defaultModel = getProviderDefaultModel(p);
                  if (defaultModel) {
                    setModel(defaultModel);
                  } else if (getProviderModelOptions(p).length > 0) {
                    setModel(getProviderModelOptions(p)[0].value);
                  }
                }}
                options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                  value: p,
                  label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                  icon: PROVIDER_LOGOS[p]
                }))}
              />

              {MODELS_BY_PROVIDER[provider] && (
                <div style={{ marginTop: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Model</label>
                  <Dropdown
                    value={model}
                    onChange={setModel}
                    searchable={MODELS_BY_PROVIDER[provider].length > 10}
                    options={getProviderModelOptions(provider)}
                  />
                </div>
              )}
              {provider === "lmstudio" && (
                <div style={{ marginTop: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>LM Studio Base URL</label>
                  <input type="text" placeholder="http://localhost:1234/v1" value={lmstudioBaseUrl} onChange={(e) => setLmstudioBaseUrl(e.target.value)} />
                </div>
              )}
              {provider === "local" && (
                <div style={{ marginTop: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Custom Base URL</label>
                  <input type="text" placeholder="http://localhost:8080/v1" value={localBaseUrl} onChange={(e) => setLocalBaseUrl(e.target.value)} />
                </div>
              )}
            </div>

            <h3 style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>Fallback Models</h3>
            <div className="mode-card-container">
              <div className={`mode-card ${enableFallbacks ? "active" : ""}`} onClick={() => setEnableFallbacks(true)}>
                <h3>Enable Fallbacks</h3>
                <p>Chain multiple models for automatic failover.</p>
              </div>
              <div className={`mode-card ${!enableFallbacks ? "active" : ""}`} onClick={() => setEnableFallbacks(false)}>
                <h3>No Fallbacks</h3>
                <p>Use only the primary model.</p>
              </div>
            </div>

            {enableFallbacks && (
              <>
                {[0, 1].map(idx => {
                  const currentModel = fallbackModels[idx] || "";
                  const currentProvider = getBaseProviderFromModel(currentModel);

                  return (
                    <div key={idx} className="form-group" style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px" }}>
                      <label>Fallback Model {idx + 1} {idx === 1 && "(Optional)"}</label>

                      {/* Provider Selection */}
                      <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Provider</label>
                      <Dropdown
                        value={currentProvider || ""}
                        onChange={(newProv) => {
                          if (!newProv) return;
                          const newModels = [...fallbackModels];
                          const defaultModel = getProviderDefaultModel(newProv);
                          if (defaultModel) {
                            newModels[idx] = defaultModel;
                          } else if (getProviderModelOptions(newProv).length > 0) {
                            newModels[idx] = getProviderModelOptions(newProv)[0].value;
                          }
                          setFallbackModels(newModels);
                        }}
                        options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                          value: p,
                          label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                          icon: PROVIDER_LOGOS[p]
                        }))}
                      />

                      {/* Model Selection */}
                      {currentProvider && MODELS_BY_PROVIDER[currentProvider] && (
                        <div style={{ marginTop: "0.75rem" }}>
                          <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Model</label>

                          {/* Ollama dynamic detection for fallback */}
                          {currentProvider === "ollama" && (
                            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                              <button
                                className="secondary"
                                style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                                disabled={ollamaDetecting}
                                onClick={async () => {
                                  setOllamaDetecting(true);
                                  try {
                                    const remoteConfig = targetEnvironment === "cloud" ? {
                                      ip: remoteIp, user: remoteUser,
                                      password: remotePassword || null,
                                      privateKeyPath: remotePrivateKeyPath || null
                                    } : null;
                                    const models: string[] = await invoke("get_ollama_models", { remote: remoteConfig });
                                    setOllamaModels(models);
                                    if (models.length > 0) {
                                      const newModels = [...fallbackModels];
                                      newModels[idx] = `ollama/${models[0]}`;
                                      setFallbackModels(newModels);
                                    }
                                  } catch (e) {
                                    console.error("Ollama detection failed:", e);
                                  }
                                  setOllamaDetecting(false);
                                }}
                              >
                                {ollamaDetecting ? "Detecting..." : "Detect Models"}
                              </button>
                              {ollamaModels.length > 0 && (
                                <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>
                                  Found {ollamaModels.length} model(s)
                                </span>
                              )}
                            </div>
                          )}

                          {/* LM Studio dynamic detection for fallback */}
                          {currentProvider === "lmstudio" && (
                            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                              <button
                                className="secondary"
                                style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                                disabled={lmstudioDetecting}
                                onClick={async () => {
                                  setLmstudioDetecting(true);
                                  try {
                                    const remoteConfig = targetEnvironment === "cloud" ? {
                                      ip: remoteIp, user: remoteUser,
                                      password: remotePassword || null,
                                      privateKeyPath: remotePrivateKeyPath || null
                                    } : null;
                                    const models: string[] = await invoke("get_lmstudio_models", {
                                      baseUrl: lmstudioBaseUrl,
                                      remote: remoteConfig
                                    });
                                    const prefixedModels = models.map(m => `lmstudio/${m}`);
                                    setLmstudioModels(prefixedModels);
                                    if (prefixedModels.length > 0) {
                                      const newModels = [...fallbackModels];
                                      newModels[idx] = prefixedModels[0];
                                      setFallbackModels(newModels);
                                    }
                                  } catch (e) {
                                    console.error("LM Studio detection failed:", e);
                                  }
                                  setLmstudioDetecting(false);
                                }}
                              >
                                {lmstudioDetecting ? "Detecting..." : "Detect Models"}
                              </button>
                              {lmstudioModels.length > 0 && (
                                <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>
                                  Found {lmstudioModels.length} model(s)
                                </span>
                              )}
                            </div>
                          )}

                          {/* Custom local endpoint detection for fallback */}
                          {currentProvider === "local" && (
                            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                              <button
                                className="secondary"
                                style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                                disabled={localDetecting}
                                onClick={async () => {
                                  setLocalDetecting(true);
                                  try {
                                    const remoteConfig = targetEnvironment === "cloud" ? {
                                      ip: remoteIp, user: remoteUser,
                                      password: remotePassword || null,
                                      privateKeyPath: remotePrivateKeyPath || null
                                    } : null;
                                    const models: string[] = await invoke("get_lmstudio_models", {
                                      baseUrl: localBaseUrl,
                                      remote: remoteConfig
                                    });
                                    setLocalModels(models);
                                    if (models.length > 0) {
                                      const newModels = [...fallbackModels];
                                      newModels[idx] = `local/${models[0]}`;
                                      setFallbackModels(newModels);
                                    }
                                  } catch (e) {
                                    console.error("Local endpoint detection failed:", e);
                                  }
                                  setLocalDetecting(false);
                                }}
                              >
                                {localDetecting ? "Detecting..." : "Detect Models"}
                              </button>
                              {localModels.length > 0 && (
                                <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>
                                  Found {localModels.length} model(s)
                                </span>
                              )}
                            </div>
                          )}

                          <Dropdown
                            value={currentModel}
                            onChange={(val) => {
                              const newModels = [...fallbackModels];
                              newModels[idx] = val;
                              setFallbackModels(newModels);
                            }}
                            searchable={MODELS_BY_PROVIDER[currentProvider].length > 10}
                            options={
                              currentProvider === "ollama" && ollamaModels.length > 0
                                ? ollamaModels.map(m => ({ value: `ollama/\${m}`, label: m }))
                                : currentProvider === "lmstudio" && lmstudioModels.length > 0
                                  ? lmstudioModels.map(m => ({ value: m, label: m }))
                                  : currentProvider === "local" && localModels.length > 0
                                    ? localModels.map(m => ({ value: `local/\${m}`, label: m }))
                                    : getProviderModelOptions(currentProvider)
                            }
                          />
                        </div>
                      )}

                      {/* Base URL for local providers */}
                      {currentProvider === "lmstudio" && (
                        <div style={{ marginTop: "0.75rem" }}>
                          <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>LM Studio Base URL</label>
                          <input type="text" placeholder="http://localhost:1234/v1" value={lmstudioBaseUrl} onChange={(e) => setLmstudioBaseUrl(e.target.value)} />
                        </div>
                      )}
                      {currentProvider === "local" && (
                        <div style={{ marginTop: "0.75rem" }}>
                          <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Custom Base URL</label>
                          <input type="text" placeholder="http://localhost:8080/v1" value={localBaseUrl} onChange={(e) => setLocalBaseUrl(e.target.value)} />
                        </div>
                      )}

                    </div>
                  );
                })}
              </>
            )}

            {referencedProviders.length > 0 && (
              <div style={{ marginTop: "1.5rem" }}>
                <h3 style={{ marginBottom: "0.5rem" }}>Provider Authentication</h3>
                <p className="step-description">Configure auth once for every remote provider referenced by the primary or fallback models.</p>
                {referencedProviders.map(targetProvider => renderProviderAuthEditor(targetProvider))}
              </div>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => setStep(11)}>Continue</button>
              <button className="secondary" onClick={() => setStep(10.5)}>Back</button>
            </div>
          </div>
        );
      }
      case 14:
        return (
          <div className="step-view">
            <h2>Session Management</h2>
            <p className="step-description">Control when the agent resets context to save costs.</p>

            <div className="mode-card-container" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {[
                { mode: "1h", label: "Hourly", desc: "Reset every hour" },
                { mode: "4h", label: "4 Hours", desc: "Reset every 4 hours" },
                { mode: "24h", label: "Daily", desc: "Reset once per day" },
                { mode: "idle", label: "Idle Timeout", desc: "Reset after inactivity" },
                { mode: "never", label: "Never", desc: "Manual reset only" }
              ].map(item => (
                <div
                  key={item.mode}
                  className={`mode-card ${heartbeatMode === item.mode ? "active" : ""}`}
                  onClick={() => setHeartbeatMode(item.mode)}
                >
                  <h3>{item.label}</h3>
                  <p>{item.desc}</p>
                </div>
              ))}
            </div>

            {heartbeatMode === "idle" && (
              <div className="form-group" style={{ marginTop: "1.5rem" }}>
                <label>Idle Timeout (minutes)</label>
                <input
                  type="number"
                  value={idleTimeoutMs / 60000}
                  onChange={e => setIdleTimeoutMs(Number(e.target.value) * 60000)}
                  min="1"
                  max="1440"
                />
                <p className="input-hint">Agent will reset context after this many minutes of inactivity.</p>
              </div>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => setStep(15)}>Continue</button>
              <button className="secondary" onClick={() => setStep(13)}>Back</button>
            </div>
          </div>
        );
      case 15:
        return (
          <div className="step-view">
            <h2>Build your AI powered business</h2>
            <p className="step-description">Select specialized business functions to add pre-configured sub-agents to your setup.</p>

            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                {Object.values(BUSINESS_FUNCTION_PRESETS).map(bf => (
                  <div
                    key={bf.id}
                    className={`mode-card ${selectedBusinessFunctions.includes(bf.id) ? "active" : ""}`}
                    onClick={() => {
                      setSelectedBusinessFunctions(prev =>
                        prev.includes(bf.id) ? prev.filter(id => id !== bf.id) : [...prev, bf.id]
                      );
                    }}
                    style={{
                      padding: "1rem",
                      borderRadius: "10px",
                      border: selectedBusinessFunctions.includes(bf.id) ? "2px solid var(--primary)" : "1px solid var(--border)",
                      backgroundColor: selectedBusinessFunctions.includes(bf.id) ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                      <span style={{ fontSize: "1.2rem" }}>{bf.emoji}</span>
                      <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{bf.name}</span>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{bf.description}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      {bf.subAgents.length} sub-agent{bf.subAgents.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                ))}
                {/* Custom team of agents card */}
                <div
                  className={`mode-card ${selectedBusinessFunctions.includes("custom-team") ? "active" : ""}`}
                  onClick={() => {
                    setSelectedBusinessFunctions(prev =>
                      prev.includes("custom-team") ? prev.filter(id => id !== "custom-team") : [...prev, "custom-team"]
                    );
                  }}
                  style={{
                    padding: "1rem",
                    borderRadius: "10px",
                    border: selectedBusinessFunctions.includes("custom-team") ? "2px solid var(--primary)" : "1px solid var(--border)",
                    backgroundColor: selectedBusinessFunctions.includes("custom-team") ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
                    cursor: "pointer"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <span style={{ fontSize: "1.2rem" }}>🛠️</span>
                    <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Custom team of agents</span>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Manually configure a custom multi-agent team.</div>
                </div>
              </div>

              {selectedBusinessFunctions.includes("custom-team") && (
                <div className="form-group" style={{ marginTop: "1rem" }}>
                  <label>Number of Custom Agents</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={numAgents}
                    onChange={(e) => {
                      const num = parseInt(e.target.value) || 1;
                      setNumAgents(Math.max(1, Math.min(5, num)));
                    }}
                    autoComplete="off"
                  />
                </div>
              )}
            </div>

            <div className="button-group" style={{ marginTop: "1.5rem" }}>
              <button className="primary" onClick={() => {
                // Use local variables to track state changes within the click handler
                // to avoid React batching issues with reading stale state
                let willEnableMultiAgent = enableMultiAgent;
                let nextAgentConfigs = [...agentConfigs];
                const allCronJobs: CronJobConfig[] = [...cronJobs];

                // Apply business function presets (excluding custom-team)
                const presetFunctions = selectedBusinessFunctions.filter(id => id !== "custom-team");
                if (presetFunctions.length > 0) {
                  const allAgents: AgentConfigData[] = [];

                  for (const bfId of presetFunctions) {
                    const bf = BUSINESS_FUNCTION_PRESETS[bfId];
                    if (!bf) continue;

                    // Add sub-agents from each business function
                    for (const sub of bf.subAgents) {
                      allAgents.push({
                        id: sub.id,
                        name: sub.name,
                        model: sub.model,
                        fallbackModels: [],
                        skills: sub.skills,
                        vibe: "",
                        emoji: "🤖",
                        identityMd: sub.identityMd,
                        userMd: "",
                        soulMd: sub.soulMd,
                        toolsMd: sub.toolsMd || "",
                        agentsMd: sub.agentsMd || "",
                        toolPolicy: normalizeToolPolicy(sub.toolPolicy),
                        cronJobs: [],
                      });
                    }

                    // Collect cron jobs
                    allCronJobs.push(...bf.cronJobs);
                  }

                  if (allAgents.length > 0) {
                    willEnableMultiAgent = true;
                    nextAgentConfigs = [...nextAgentConfigs, ...allAgents];
                  }
                }

                // Handle custom-team selection
                if (selectedBusinessFunctions.includes("custom-team")) {
                  willEnableMultiAgent = true;
                  // Add custom agents if needed
                  const existingCount = nextAgentConfigs.length;
                  if (existingCount < numAgents) {
                    for (let i = existingCount; i < numAgents; i++) {
                      nextAgentConfigs.push({
                        id: `agent-${i + 1}`,
                        name: `Agent ${i + 1}`,
                        model: model,
                        fallbackModels: [],
                        skills: [],
                        vibe: "",
                        emoji: agentEmoji,
                        identityMd: "",
                        userMd: "",
                        soulMd: "",
                        toolsMd: "",
                        agentsMd: "",
                        toolPolicy: createInheritedToolPolicy(),
                        cronJobs: [],
                      });
                    }
                  }
                }

                // Apply state updates
                setCronJobs(allCronJobs);
                setEnableMultiAgent(willEnableMultiAgent);
                setAgentConfigs(nextAgentConfigs);
                setNumAgents(nextAgentConfigs.length || numAgents);

                if (willEnableMultiAgent && nextAgentConfigs.length > 0) {
                  setCurrentAgentConfigIdx(0);
                  setActiveWorkspaceTab("identity");
                  setStep(15.5);
                } else {
                  setStep(15.7);
                }
              }} disabled={loading}>
                {selectedBusinessFunctions.length > 0 ? "Configure Agents" : "Next"}
              </button>
              <button className="secondary" onClick={() => setStep(isPresetAgent ? 10.5 : 11.1)} disabled={loading}>Back</button>
            </div>
          </div>
        );
      case 15.5: {

        // Agent Configuration Loop
        if (!enableMultiAgent || currentAgentConfigIdx >= agentConfigs.length) {
          setStep(15.7);
          return null;
        }
        const currentAgent = agentConfigs[currentAgentConfigIdx];
        const currentAgentProvider = getBaseProviderFromModel(currentAgent.model);
        const currentAgentReferencedProviders = buildReferencedProviders({
          primaryModel: currentAgent.model,
          fallbackModels: currentAgent.fallbackModels || [],
        });

        return (
          <div className="step-view">
            <h2>Configure Agent {currentAgentConfigIdx + 1} of {agentConfigs.length}</h2>
            <p className="step-description">Set up the model, skills, and personality for {currentAgent.name || "this agent"}.</p>

            <div className="form-group">
              <label>Agent Name</label>
              <input
                value={currentAgent.name}
                onChange={(e) => {
                  const val = e.target.value;
                  const updated = [...agentConfigs];
                  updated[currentAgentConfigIdx].name = val;
                  if (updated[currentAgentConfigIdx].identityMd) {
                    updated[currentAgentConfigIdx].identityMd = updateIdentityField(updated[currentAgentConfigIdx].identityMd, "Name", val);
                  }
                  setAgentConfigs(updated);
                }}
                placeholder="e.g., CodeBot"
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label>Agent Emoji</label>
              <div className="emoji-grid" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {EMOJI_OPTIONS.map(e => (
                  <button
                    key={e}
                    className={`emoji-btn`}
                    onClick={() => {
                      const updated = [...agentConfigs];
                      updated[currentAgentConfigIdx].emoji = e;
                      if (updated[currentAgentConfigIdx].identityMd) {
                        updated[currentAgentConfigIdx].identityMd = updateIdentityField(updated[currentAgentConfigIdx].identityMd, "Emoji", e);
                      }
                      setAgentConfigs(updated);
                    }}
                    style={{
                      fontSize: "1.25rem",
                      padding: "0.4rem",
                      borderRadius: "8px",
                      border: currentAgent.emoji === e ? "2px solid var(--primary)" : "1px solid var(--border)",
                      background: currentAgent.emoji === e ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
                      cursor: "pointer",
                      minWidth: "40px"
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: "1.5rem" }}>
              <label>Persona Template</label>
              <Dropdown
                value={currentAgent.persona || "custom"}
                onChange={(val) => {
                  const updated = [...agentConfigs];
                  updated[currentAgentConfigIdx].persona = val;

                  if (val !== "custom" && PERSONA_TEMPLATES[val]) {
                    const t = PERSONA_TEMPLATES[val];
                    let newIdentity = t.identity;
                    let newSoul = t.soul;

                    if (updated[currentAgentConfigIdx].name) {
                      newIdentity = updateIdentityField(newIdentity, "Name", updated[currentAgentConfigIdx].name);
                      newSoul = updateSoulMission(newSoul, updated[currentAgentConfigIdx].name);
                    }

                    updated[currentAgentConfigIdx].identityMd = newIdentity;
                    updated[currentAgentConfigIdx].soulMd = newSoul;
                  }
                  setAgentConfigs(updated);
                }}
                options={[
                  { value: "custom", label: "Custom / Empty" },
                  ...Object.keys(PERSONA_TEMPLATES).filter(k => k !== "custom").sort().map(k => ({
                    value: k,
                    label: PERSONA_TEMPLATES[k].name
                  }))
                ]}
              />
            </div>

            <h3 style={{ marginTop: "2rem" }}>Agent Workspace</h3>
            <div className="workspace-tabs">
              {[
                { id: "identity", label: "IDENTITY.md" },
                { id: "soul", label: "SOUL.md" },
                { id: "tools", label: "TOOLS.md" },
                { id: "agents", label: "AGENTS.md" }
              ].map(tab => (
                <button
                  key={tab.id}
                  className={`tab ${activeWorkspaceTab === tab.id ? "active" : ""}`}
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="workspace-editor" style={{ marginBottom: "2rem" }}>
              {activeWorkspaceTab === "identity" && (
                <textarea
                  className="markdown-editor"
                  rows={8}
                  value={currentAgent.identityMd}
                  onChange={e => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].identityMd = e.target.value;
                    setAgentConfigs(updated);
                  }}
                  placeholder={`# IDENTITY.md\n- **Name:** ${currentAgent.name}\n- **Emoji:** ${currentAgent.emoji}`}
                />
              )}

              {activeWorkspaceTab === "soul" && (
                <textarea
                  className="markdown-editor"
                  rows={8}
                  value={currentAgent.soulMd}
                  onChange={e => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].soulMd = e.target.value;
                    setAgentConfigs(updated);
                  }}
                  placeholder={`# SOUL.md\n## Mission\nServe ${userName}.`}
                />
              )}

              {activeWorkspaceTab === "tools" && (
                <textarea
                  className="markdown-editor"
                  rows={8}
                  value={currentAgent.toolsMd}
                  onChange={e => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].toolsMd = e.target.value;
                    setAgentConfigs(updated);
                  }}
                  placeholder={`# TOOLS.md\nDefine tool usage policies for this agent...`}
                />
              )}

              {activeWorkspaceTab === "agents" && (
                <textarea
                  className="markdown-editor"
                  rows={8}
                  value={currentAgent.agentsMd}
                  onChange={e => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].agentsMd = e.target.value;
                    setAgentConfigs(updated);
                  }}
                  placeholder={`# AGENTS.md\nDefine sub-agent routing for this agent...`}
                />
              )}
            </div>

            <div className="form-group" style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "1rem" }}>
              <label>Primary Model</label>

              <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Provider</label>
              <Dropdown
                value={currentAgentProvider}
                onChange={(newProv) => {
                  const updated = [...agentConfigs];
                  const defaultModel = getProviderDefaultModel(newProv);
                  if (defaultModel) {
                    updated[currentAgentConfigIdx].model = defaultModel;
                  } else if (getProviderModelOptions(newProv).length > 0) {
                    updated[currentAgentConfigIdx].model = getProviderModelOptions(newProv)[0].value;
                  }
                  setAgentConfigs(updated);
                }}
                options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                  value: p,
                  label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                  icon: PROVIDER_LOGOS[p]
                }))}
              />

              {currentAgentProvider && MODELS_BY_PROVIDER[currentAgentProvider] && (
                <div style={{ marginTop: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Model</label>
                  <Dropdown
                    value={currentAgent.model}
                    onChange={(val) => {
                      const updated = [...agentConfigs];
                      updated[currentAgentConfigIdx].model = val;
                      setAgentConfigs(updated);
                    }}
                    searchable={MODELS_BY_PROVIDER[currentAgentProvider].length > 10}
                    options={getProviderModelOptions(currentAgentProvider)}
                  />
                </div>
              )}

              {currentAgentProvider === "lmstudio" && (
                <div style={{ marginTop: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>LM Studio Base URL</label>
                  <input type="text" placeholder="http://localhost:1234/v1" value={lmstudioBaseUrl} onChange={(e) => setLmstudioBaseUrl(e.target.value)} />
                </div>
              )}
              {currentAgentProvider === "local" && (
                <div style={{ marginTop: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Custom Base URL</label>
                  <input type="text" placeholder="http://localhost:8080/v1" value={localBaseUrl} onChange={(e) => setLocalBaseUrl(e.target.value)} />
                </div>
              )}
            </div>

            <div className="form-group" style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label>Fallback Model (Optional)</label>
                {currentAgent.fallbackModels[0] && (
                  <button className="secondary small" style={{ padding: "2px 8px", fontSize: "0.75rem", height: "auto" }} onClick={() => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].fallbackModels = [];
                    setAgentConfigs(updated);
                  }}>Clear</button>
                )}
              </div>

              {(() => {
                const currentFallbackModel = currentAgent.fallbackModels[0] || "";
                const currentFallbackProvider = getBaseProviderFromModel(currentFallbackModel);

                return (
                  <>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Provider</label>
                    <Dropdown
                      value={currentFallbackProvider || ""}
                      onChange={(newProv) => {
                        if (!newProv) return;
                        const updated = [...agentConfigs];
                        const defaultModel = getProviderDefaultModel(newProv);
                        if (defaultModel) {
                          updated[currentAgentConfigIdx].fallbackModels = [defaultModel];
                        } else if (getProviderModelOptions(newProv).length > 0) {
                          updated[currentAgentConfigIdx].fallbackModels = [getProviderModelOptions(newProv)[0].value];
                        }
                        setAgentConfigs(updated);
                      }}
                      options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                        value: p,
                        label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                        icon: PROVIDER_LOGOS[p]
                      }))}
                    />

                    {currentFallbackProvider && MODELS_BY_PROVIDER[currentFallbackProvider] && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Model</label>
                        <Dropdown
                          value={currentFallbackModel}
                          onChange={(val) => {
                            const updated = [...agentConfigs];
                            updated[currentAgentConfigIdx].fallbackModels = [val];
                            setAgentConfigs(updated);
                          }}
                          searchable={MODELS_BY_PROVIDER[currentFallbackProvider].length > 10}
                          options={getProviderModelOptions(currentFallbackProvider)}
                        />
                      </div>
                    )}

                    {currentFallbackProvider === "lmstudio" && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>LM Studio Base URL</label>
                        <input type="text" placeholder="http://localhost:1234/v1" value={lmstudioBaseUrl} onChange={(e) => setLmstudioBaseUrl(e.target.value)} />
                      </div>
                    )}
                    {currentFallbackProvider === "local" && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Custom Base URL</label>
                        <input type="text" placeholder="http://localhost:8080/v1" value={localBaseUrl} onChange={(e) => setLocalBaseUrl(e.target.value)} />
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {currentAgentReferencedProviders.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ marginBottom: "0.5rem" }}>Provider Authentication</h3>
                <p className="step-description">Configure auth once for the remote providers used by this agent.</p>
                {currentAgentReferencedProviders.map(targetProvider => renderProviderAuthEditor(targetProvider))}
              </div>
            )}

            <div className="form-group">
              <label>Skills</label>
              <div className="skills-grid" style={{ marginTop: "0.5rem", maxHeight: "200px", overflowY: "auto" }}>
                {availableSkills.map(skill => (
                  <div
                    key={skill.id}
                    className={`skill-card ${currentAgent.skills.includes(skill.id) ? "active" : ""}`}
                    onClick={() => {
                      const updated = [...agentConfigs];
                      const skills = updated[currentAgentConfigIdx].skills;
                      if (skills.includes(skill.id)) {
                        updated[currentAgentConfigIdx].skills = skills.filter(s => s !== skill.id);
                      } else {
                        updated[currentAgentConfigIdx].skills.push(skill.id);
                      }
                      setAgentConfigs(updated);
                    }}
                    style={{ padding: "0.75rem" }}
                  >
                    <div style={{ display: "flex", alignItems: "center" }}>
                      {SKILL_ICONS[skill.id] && (
                        <img
                          src={SKILL_ICONS[skill.id]}
                          alt=""
                          style={{
                            width: "16px",
                            height: "16px",
                            objectFit: "contain",
                            borderRadius: "3px",
                            backgroundColor: "white",
                            padding: "1px",
                            marginRight: "6px"
                          }}
                        />
                      )}
                      <div className="skill-name" style={{ fontSize: "0.85rem" }}>{skill.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tool Access */}
            <div className="form-group" style={{ marginTop: "1rem" }}>
              <ToolPolicyEditor
                policy={currentAgent.toolPolicy}
                inheritedPolicy={toolPolicy}
                onChange={(nextPolicy) => {
                  const updated = [...agentConfigs];
                  updated[currentAgentConfigIdx].toolPolicy = nextPolicy;
                  setAgentConfigs(updated);
                }}
                title="Tool Access"
                description="Per-agent overrides follow the same OpenClaw tool profile model."
                showElevatedToggle
                allowInherit
              />
            </div>

            {/* Cron Jobs */}
            <div className="form-group" style={{ marginTop: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label>Cron Jobs</label>
                <button className="secondary" style={{ padding: "2px 10px", fontSize: "0.75rem", height: "auto" }} onClick={() => {
                  const updated = [...agentConfigs];
                  updated[currentAgentConfigIdx].cronJobs = [...updated[currentAgentConfigIdx].cronJobs, { name: "", schedule: "", command: "" }];
                  setAgentConfigs(updated);
                }}>+ Add</button>
              </div>
              {currentAgent.cronJobs.map((cron, cronIdx) => (
                <div key={cronIdx} style={{ padding: "0.75rem", border: "1px solid var(--border)", borderRadius: "8px", marginTop: "0.5rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <input
                      placeholder="Job name"
                      value={cron.name}
                      onChange={e => {
                        const updated = [...agentConfigs];
                        updated[currentAgentConfigIdx].cronJobs[cronIdx].name = e.target.value;
                        setAgentConfigs(updated);
                      }}
                      style={{ flex: 1 }}
                    />
                    <button className="secondary" style={{ padding: "2px 8px", fontSize: "0.75rem", height: "auto", color: "var(--error)" }} onClick={() => {
                      const updated = [...agentConfigs];
                      updated[currentAgentConfigIdx].cronJobs = updated[currentAgentConfigIdx].cronJobs.filter((_, i) => i !== cronIdx);
                      setAgentConfigs(updated);
                    }}>Remove</button>
                  </div>
                  <input
                    placeholder="Schedule (e.g. 0 9 * * *)"
                    value={cron.schedule}
                    onChange={e => {
                      const updated = [...agentConfigs];
                      updated[currentAgentConfigIdx].cronJobs[cronIdx].schedule = e.target.value;
                      setAgentConfigs(updated);
                    }}
                    style={{ marginBottom: "0.5rem" }}
                  />
                  <input
                    placeholder="Command"
                    value={cron.command}
                    onChange={e => {
                      const updated = [...agentConfigs];
                      updated[currentAgentConfigIdx].cronJobs[cronIdx].command = e.target.value;
                      setAgentConfigs(updated);
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Add/Remove Agent buttons */}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button className="secondary" style={{ fontSize: "0.8rem" }} onClick={() => {
                const newAgent: AgentConfigData = {
                  id: `agent-${agentConfigs.length + 1}`,
                  name: `Agent ${agentConfigs.length + 1}`,
                  model: model,
                  fallbackModels: [],
                  skills: [],
                  vibe: "",
                  emoji: agentEmoji,
                  identityMd: "",
                  userMd: "",
                  soulMd: "",
                  toolsMd: "",
                  agentsMd: "",
                  toolPolicy: createInheritedToolPolicy(),
                  cronJobs: [],
                };
                setAgentConfigs([...agentConfigs, newAgent]);
                setNumAgents(agentConfigs.length + 1);
              }}>+ Add Agent</button>
              {agentConfigs.length > 1 && (
                <button className="secondary" style={{ fontSize: "0.8rem", color: "var(--error)" }} onClick={() => {
                  const updated = agentConfigs.filter((_, i) => i !== currentAgentConfigIdx);
                  setAgentConfigs(updated);
                  setNumAgents(updated.length);
                  if (currentAgentConfigIdx >= updated.length) {
                    setCurrentAgentConfigIdx(Math.max(0, updated.length - 1));
                  }
                }}>Remove This Agent</button>
              )}
            </div>

            <div className="button-group" style={{ marginTop: "1.5rem" }}>
              <button className="primary" onClick={() => {
                if (currentAgentConfigIdx < agentConfigs.length - 1) {
                  setCurrentAgentConfigIdx(currentAgentConfigIdx + 1);
                  setActiveWorkspaceTab("identity");
                } else {
                  // Auto-update main agent's AGENTS.md with routing config
                  if (agentConfigs.length > 0) {
                    const routingLines = agentConfigs.map(a => `- **${a.name}** (${a.id}): ${a.skills.join(", ") || "general"}`).join("\n");
                    const agentsMdContent = `# AGENTS.md - Agent Routing\n\n## Available Sub-Agents\n${routingLines}\n`;
                    setAgentsMd(agentsMdContent);
                  }
                  setStep(15.7);
                }
              }} disabled={loading}>
                {currentAgentConfigIdx < agentConfigs.length - 1 ? "Next Agent" : "Next"}
              </button>
              <button className="secondary" onClick={() => {
                if (currentAgentConfigIdx > 0) {
                  setCurrentAgentConfigIdx(currentAgentConfigIdx - 1);
                  setActiveWorkspaceTab("identity");
                } else {
                  setStep(15);
                }
              }} disabled={loading}>Back</button>
            </div>
          </div>
        );
      }


      case 15.7:
        return (
          <div className="step-view">
            <h2>Extra Settings</h2>
            <p className="step-description">Configure advanced gateway, runtime, security, and session settings.</p>

            {/* Gateway Settings */}
            <div className="accordion-section" style={{ marginBottom: "1rem" }}>
              <button
                className="accordion-header"
                onClick={() => setExtraSettingsOpen(prev => ({ ...prev, gateway: !prev.gateway }))}
                style={{
                  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "1rem", background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderRadius: extraSettingsOpen.gateway ? "12px 12px 0 0" : "12px",
                  cursor: "pointer", fontWeight: 600, fontSize: "0.9rem"
                }}
              >
                <span>Gateway Settings</span>
                <span className={`accordion-chevron ${extraSettingsOpen.gateway ? "rotated" : ""}`}>▼</span>
              </button>
              {extraSettingsOpen.gateway && (
                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 12px 12px", background: "var(--bg-card)" }}>
                  <div className="form-group">
                    <label>Port</label>
                    <input type="number" value={gatewayPort} onChange={(e) => setGatewayPort(parseInt(e.target.value))} />
                  </div>
                  <div className="form-group" style={{ marginTop: "1rem" }}>
                    <label>Bind Address</label>
                    <Dropdown value={gatewayBind} onChange={setGatewayBind} options={[
                      { value: "loopback", label: "Loopback (127.0.0.1)", description: "Only accessible from this machine" },
                      { value: "all", label: "All Interfaces (0.0.0.0)", description: "Accessible from local network" }
                    ]} />
                  </div>
                  <div className="form-group" style={{ marginTop: "1rem" }}>
                    <label>Auth Mode</label>
                    <Dropdown value={gatewayAuthMode} onChange={setGatewayAuthMode} options={[
                      { value: "token", label: "Token (Secure)", description: "Requires authentication token" },
                      { value: "none", label: "None (Insecure)", description: "No authentication required" }
                    ]} />
                  </div>
                  <div className="form-group" style={{ marginTop: "1rem" }}>
                    <label>Tailscale</label>
                    <Dropdown value={tailscaleMode} onChange={setTailscaleMode} options={[
                      { value: "off", label: "Disabled", description: "Standard networking" },
                      { value: "on", label: "Enabled", description: "Expose securely via Tailscale" }
                    ]} />
                  </div>
                </div>
              )}
            </div>

            {/* Runtime Environment */}
            <div className="accordion-section" style={{ marginBottom: "1rem" }}>
              <button
                className="accordion-header"
                onClick={() => setExtraSettingsOpen(prev => ({ ...prev, runtime: !prev.runtime }))}
                style={{
                  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "1rem", background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderRadius: extraSettingsOpen.runtime ? "12px 12px 0 0" : "12px",
                  cursor: "pointer", fontWeight: 600, fontSize: "0.9rem"
                }}
              >
                <span>Runtime Environment</span>
                <span className={`accordion-chevron ${extraSettingsOpen.runtime ? "rotated" : ""}`}>▼</span>
              </button>
              {extraSettingsOpen.runtime && (
                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 12px 12px", background: "var(--bg-card)" }}>
                  <div className="form-group">
                    <label>Node Package Manager</label>
                    <Dropdown value={nodeManager} onChange={setNodeManager} options={[
                      { value: "npm", label: "npm" },
                      { value: "pnpm", label: "pnpm" },
                      { value: "bun", label: "bun" }
                    ]} />
                  </div>
                </div>
              )}
            </div>

            {/* Security (Sandbox) */}
            <div className="accordion-section" style={{ marginBottom: "1rem" }}>
              <button
                className="accordion-header"
                onClick={() => setExtraSettingsOpen(prev => ({ ...prev, security: !prev.security }))}
                style={{
                  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "1rem", background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderRadius: extraSettingsOpen.security ? "12px 12px 0 0" : "12px",
                  cursor: "pointer", fontWeight: 600, fontSize: "0.9rem"
                }}
              >
                <span>Security (Sandbox)</span>
                <span className={`accordion-chevron ${extraSettingsOpen.security ? "rotated" : ""}`}>▼</span>
              </button>
              {extraSettingsOpen.security && (
                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 12px 12px", background: "var(--bg-card)" }}>
                  <div className="form-group">
                    <label>Sandbox Mode</label>
                    <Dropdown value={sandboxMode} onChange={setSandboxMode} options={[
                      { value: "full", label: "Full Sandbox", description: "REQUIRES DOCKER! Select only if Docker is installed." },
                      { value: "partial", label: "Partial Sandbox", description: "Standard isolation." },
                      { value: "none", label: "No Sandbox", description: "Unrestricted access." }
                    ]} />
                  </div>
                </div>
              )}
            </div>

            {/* Session Management */}
            <div className="accordion-section" style={{ marginBottom: "1rem" }}>
              <button
                className="accordion-header"
                onClick={() => setExtraSettingsOpen(prev => ({ ...prev, session: !prev.session }))}
                style={{
                  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "1rem", background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderRadius: extraSettingsOpen.session ? "12px 12px 0 0" : "12px",
                  cursor: "pointer", fontWeight: 600, fontSize: "0.9rem"
                }}
              >
                <span>Session Management</span>
                <span className={`accordion-chevron ${extraSettingsOpen.session ? "rotated" : ""}`}>▼</span>
              </button>
              {extraSettingsOpen.session && (
                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 12px 12px", background: "var(--bg-card)" }}>
                  <div className="mode-card-container" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    {[
                      { mode: "1h", label: "Hourly", desc: "Reset every hour" },
                      { mode: "4h", label: "4 Hours", desc: "Reset every 4 hours" },
                      { mode: "24h", label: "Daily", desc: "Reset once per day" },
                      { mode: "idle", label: "Idle Timeout", desc: "Reset after inactivity" },
                      { mode: "never", label: "Never", desc: "Manual reset only" }
                    ].map(item => (
                      <div
                        key={item.mode}
                        className={`mode-card ${heartbeatMode === item.mode ? "active" : ""}`}
                        onClick={() => setHeartbeatMode(item.mode)}
                      >
                        <h3>{item.label}</h3>
                        <p>{item.desc}</p>
                      </div>
                    ))}
                  </div>
                  {heartbeatMode === "idle" && (
                    <div className="form-group" style={{ marginTop: "1rem" }}>
                      <label>Idle Timeout (minutes)</label>
                      <input type="number" value={idleTimeoutMs / 60000} onChange={e => setIdleTimeoutMs(Number(e.target.value) * 60000)} min="1" max="1440" />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="button-group">
              <button className="primary" onClick={() => setStep(16)}>Next</button>
              <button className="secondary" onClick={() => setStep(enableMultiAgent ? 15.5 : 15)}>Back</button>
            </div>
          </div>
        );

      case 16:
        return (
          <div className="step-view">
            <h2>{initialConfigRef.current ? "Review Configuration" : "Deploy Your AI Agent"}</h2>
            <p className="step-description">{initialConfigRef.current ? "Review your changes before applying." : "Your agent is ready to be deployed."}</p>

            <div className="status-card" style={{
              padding: "1.5rem",
              backgroundColor: hasChanges ? "rgba(59, 130, 246, 0.1)" : "rgba(34, 197, 94, 0.1)",
              border: `1px solid ${hasChanges ? "var(--primary)" : "var(--success)"}`,
              borderRadius: "12px",
              marginBottom: "2rem",
              textAlign: "center"
            }}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>
                {hasChanges ? (initialConfigRef.current ? "📝" : "🚀") : "✅"}
              </div>
              <h3>{hasChanges ? (initialConfigRef.current ? "Configuration Updated" : "Ready to Deploy") : "No Changes Detected"}</h3>
              <p style={{ color: "var(--text-muted)" }}>
                {hasChanges
                  ? (initialConfigRef.current ? "You have modified the agent configuration. Click below to apply these changes." : "Your configuration is complete. Click below to deploy your agent.")
                  : "Your configuration matches the current active settings."}
              </p>
            </div>

            {(loading || error) && (
              <div className="progress-container" style={{ marginBottom: "2rem" }}>
                {loading && (
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: progress.includes("Gateway") ? "80%" : (progress.includes("skill") ? "50%" : "20%") }} />
                  </div>
                )}
                <p style={{ fontSize: "0.9rem", color: error ? "var(--error)" : "var(--primary)" }}>{error ? "Installation Failed" : progress}</p>
                <div className="logs-container">
                  <pre>{logs}</pre>
                </div>
              </div>
            )}

            {/* Validate Config */}
            {initialConfigRef.current && (
              <div style={{ marginBottom: "1.5rem" }}>
                <button
                  className="secondary"
                  style={{ width: "100%", marginBottom: "0.5rem" }}
                  disabled={validating}
                  onClick={async () => {
                    setValidating(true);
                    setValidateOutput("");
                    try {
                      const remoteConfig = targetEnvironment === "cloud" ? {
                        ip: remoteIp, user: remoteUser,
                        password: remotePassword || null,
                        privateKeyPath: remotePrivateKeyPath || null
                      } : null;
                      const output: string = await invoke("validate_openclaw_config", {
                        remote: remoteConfig,
                        isWsl: false
                      });
                      setValidateOutput(output || "Config is valid.");
                    } catch (e: any) {
                      setValidateOutput(`Validation error: ${e}`);
                    }
                    setValidating(false);
                  }}
                >
                  {validating ? "Validating..." : "Validate Config"}
                </button>
                {validateOutput && (
                  <div className="logs-container">
                    <pre style={{ fontSize: "0.8rem" }}>{validateOutput}</pre>
                  </div>
                )}
              </div>
            )}

            <div className="button-group">
              {hasChanges ? (
                <button className="primary" onClick={handleInstall} disabled={loading}>
                  {loading ? (initialConfigRef.current ? "Updating..." : "Installing...") : (initialConfigRef.current ? "Update Configuration" : "Finish Setup")}
                </button>
              ) : (
                <button className="primary" onClick={() => setStep(17)}>
                  Next
                </button>
              )}
              <button className="secondary" onClick={() => setStep(mode === "advanced" ? 15.7 : 9)} disabled={loading}>Back</button>
            </div>
          </div>
        );

      case 10.5:
        return (
          <div className="step-view">
            <h2>Customize {agentName ? `${agentName}'s` : "your agent's"} personality</h2>
            <p className="step-description">Edit your agent's identity, personality, and mission.</p>

            <div className="form-group" style={{ marginBottom: "1.5rem" }}>
              <label>Persona Template</label>
              <Dropdown
                value={selectedPersona}
                onChange={(val) => {
                  setSelectedPersona(val);
                  if (val !== "custom" && PERSONA_TEMPLATES[val]) {
                    const t = PERSONA_TEMPLATES[val];
                    let newIdentity = t.identity;
                    let newSoul = t.soul;

                    if (agentName) {
                      newIdentity = updateIdentityField(newIdentity, "Name", agentName);
                      newSoul = updateSoulMission(newSoul, agentName);
                    }

                    setIdentityMd(newIdentity);
                    setSoulMd(newSoul);
                  }
                }}
                options={[
                  { value: "custom", label: "Custom / Empty" },
                  ...Object.keys(PERSONA_TEMPLATES).filter(k => k !== "custom").sort().map(k => ({
                    value: k,
                    label: PERSONA_TEMPLATES[k].name
                  }))
                ]}
              />
            </div>

            <div className="workspace-tabs">
              {[
                { id: "identity", label: "IDENTITY.md" },
                { id: "user", label: "USER.md" },
                { id: "soul", label: "SOUL.md" },
                { id: "tools", label: "TOOLS.md" },
                { id: "agents", label: "AGENTS.md" }
              ].map(tab => (
                <button
                  key={tab.id}
                  className={`tab ${activeWorkspaceTab === tab.id ? "active" : ""}`}
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="workspace-editor">
              {activeWorkspaceTab === "identity" && (
                <textarea
                  className="markdown-editor"
                  rows={12}
                  value={identityMd}
                  onChange={e => setIdentityMd(e.target.value)}
                  placeholder={`# IDENTITY.md - Who Am I?\n- **Name:** ${agentName}\n- **Emoji:** ${agentEmoji}\n\nAdd more details about your agent's identity...`}
                />
              )}
              {activeWorkspaceTab === "user" && (
                <textarea
                  className="markdown-editor"
                  rows={12}
                  value={userMd}
                  onChange={e => setUserMd(e.target.value)}
                  placeholder={`# USER.md - About Your Human\n- **Name:** ${userName}\n\nAdd more details about yourself...`}
                />
              )}
              {activeWorkspaceTab === "soul" && (
                <textarea
                  className="markdown-editor"
                  rows={12}
                  value={soulMd}
                  onChange={e => setSoulMd(e.target.value)}
                  placeholder={`# SOUL.md\n## Mission\nServe ${userName}.\n\nAdd your agent's mission statement and guiding principles...`}
                />
              )}
              {activeWorkspaceTab === "tools" && (
                <textarea
                  className="markdown-editor"
                  rows={12}
                  value={toolsMd}
                  onChange={e => setToolsMd(e.target.value)}
                  placeholder={`# TOOLS.md\nDefine tool usage policies and instructions for your agent...`}
                />
              )}
              {activeWorkspaceTab === "agents" && (
                <textarea
                  className="markdown-editor"
                  rows={12}
                  value={agentsMd}
                  onChange={e => setAgentsMd(e.target.value)}
                  placeholder={`# AGENTS.md\nDefine agent routing and sub-agent configuration...`}
                />
              )}
            </div>

            <p className="input-hint" style={{ marginTop: "1rem" }}>
              Leave blank to use auto-generated defaults. Changes can be edited later in the workspace folder.
            </p>

            <div className="button-group" style={{ gap: "0.5rem" }}>
              <button
                className="secondary"
                disabled={!workspaceModified || savingWorkspace}
                onClick={() => handleSaveWorkspace()}
                style={{ flex: "0 0 auto", minWidth: "150px" }}
              >
                {savingWorkspace ? "Saving..." : "💾 Save Changes"}
              </button>
              <button className="primary" onClick={() => setStep(isPresetAgent ? 15 : 13)} style={{ flex: 1 }}>
                Next
              </button>
              <button className="secondary" onClick={() => setStep(9)} style={{ flex: "0 0 auto" }}>Back</button>
            </div>
          </div>
        );
      case 17:
        return (
          <div className="step-view">
            <h2>Setup Complete! 🦞</h2>
            <p className="step-description">
              OpenClaw is running {targetEnvironment === "cloud" ? `on ${remoteIp}` : "locally"} and ready for your commands.
            </p>

            {targetEnvironment === "cloud" && (
              <div style={{
                padding: "1rem",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                borderRadius: "8px",
                marginBottom: "1.5rem",
                border: "1px solid rgba(59, 130, 246, 0.3)"
              }}>
                <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--primary)" }}>
                  {tunnelActive ? "🔒 SSH Tunnel Active" : "⚠️ Tunnel Inactive"}
                </h4>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
                  {tunnelActive
                    ? `Remote gateway (${remoteIp}:18789) is forwarded to localhost:18789`
                    : "SSH tunnel is not active"}
                </p>
                {tunnelActive ? (
                  <button
                    className="secondary"
                    style={{ marginTop: "1rem", width: "100%" }}
                    onClick={async () => {
                      try {
                        await invoke("stop_ssh_tunnel");
                        setTunnelActive(false);
                      } catch (e) {
                        console.error("Failed to stop tunnel:", e);
                      }
                    }}
                  >
                    Stop SSH Tunnel
                  </button>
                ) : (
                  <button
                    className="primary"
                    style={{ marginTop: "1rem", width: "100%" }}
                    onClick={() => handleToggleTunnel()}
                  >
                    Establish SSH Tunnel
                  </button>
                )}
              </div>
            )}

            {deferredOAuthQueue.length > 0 && (
              <div style={{
                padding: "1rem",
                backgroundColor: "var(--bg-card)",
                borderRadius: "8px",
                marginBottom: "1.5rem",
                border: "1px solid var(--border)"
              }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Deferred OpenClaw Authentication</h3>
                <p className="step-description" style={{ marginBottom: "0.75rem" }}>
                  OpenClaw is installed. Clawnetes will open a terminal for each OAuth provider, replace any stale OpenClaw callback session on the known localhost port, and then sync the imported profile back into the app.
                </p>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  {deferredOAuthQueue.map(item => {
                    const result = oauthCompletionResults[item.id];
                    const status = result?.status || (oauthCompletionRunning ? "pending" : "pending");
                    const color = status === "success" ? "var(--success)" : status === "error" ? "var(--danger, #dc2626)" : "var(--text-muted)";
                    return (
                      <div key={item.id} style={{ padding: "0.75rem", border: "1px solid var(--border)", borderRadius: "8px" }}>
                        <div style={{ fontWeight: 600 }}>{item.label}</div>
                        <div style={{ fontSize: "0.85rem", color }}>
                          {result?.message || (oauthCompletionRunning ? "Waiting for terminal authentication..." : "Pending terminal authentication")}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button
                  className="secondary"
                  style={{ width: "100%", marginTop: "1rem" }}
                  disabled={oauthCompletionRunning}
                  onClick={() => {
                    runDeferredOAuthQueue().catch((e) => {
                      console.error("Deferred OAuth retry failed:", e);
                      setOauthCompletionRunning(false);
                    });
                  }}
                >
                  {oauthCompletionRunning ? "Running OpenClaw Authentication..." : "Retry Deferred OAuth"}
                </button>
              </div>
            )}

            <div className="pairing-result">
              {!isPaired && (
                <>
                  <h3>Telegram Pairing</h3>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.5rem" }}>
                    Send any message to your bot to receive your code.
                  </p>
                  <div className="pairing-code-display">{pairingCode.includes("Ready") ? "READY" : pairingCode}</div>

                  {telegramToken && (
                    <div className="form-group" style={{ marginTop: "2rem" }}>
                      <input
                        type="text"
                        placeholder="Enter code (e.g. 3RQ8EBFE)"
                        value={pairingInput}
                        onChange={(e) => setPairingInput(e.target.value.toUpperCase())}
                        style={{ textAlign: "center", letterSpacing: "2px", fontWeight: "bold" }}
                      />
                      <button className="primary" style={{ width: "100%", marginTop: "1rem" }} onClick={handlePairing} disabled={!pairingInput || pairingStatus === "Verifying..."}>
                        {pairingStatus === "Verifying..." ? "Verifying..." : "Pair Agent"}
                      </button>
                      {pairingStatus && (
                        <p style={{ marginTop: "1rem", fontWeight: "bold", color: pairingStatus.includes("Error") ? "var(--error)" : "var(--success)" }}>
                          {pairingStatus}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* WhatsApp QR Pairing */}
              {messagingChannel === "whatsapp" && !whatsappPaired && (
                <div style={{ marginTop: "2rem", padding: "1.5rem", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
                  <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>WhatsApp Pairing</h3>
                  <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                    Link your WhatsApp account to enable the WhatsApp channel.
                  </p>
                  {!whatsappPhoneSubmitted ? (
                    <div>
                      <label style={{ fontSize: "0.9rem", marginBottom: "0.5rem", display: "block" }}>Your WhatsApp Phone Number</label>
                      <input
                        type="tel"
                        placeholder="+1234567890"
                        value={whatsappPhoneNumber}
                        onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                        style={{ marginBottom: "0.75rem" }}
                      />
                      <p className="input-hint">Include country code, e.g. +1234567890.</p>
                      <button
                        className="primary"
                        style={{ width: "100%" }}
                        disabled={!whatsappPhoneNumber.trim()}
                        onClick={() => setWhatsappPhoneSubmitted(true)}
                      >
                        Continue
                      </button>
                    </div>
                  ) : !whatsappQrStep ? (
                    <button
                      className="primary"
                      style={{ width: "100%" }}
                      disabled={whatsappQrLoading}
                      onClick={async () => {
                        setWhatsappQrLoading(true);
                        setWhatsappQrStep(true);
                        try {
                          const remoteArg = targetEnvironment === "cloud" ? { ip: remoteIp, user: remoteUser, password: remotePassword || null, privateKeyPath: remotePrivateKeyPath || null } : null;
                          const qrDataUrl: string = await invoke("start_whatsapp_login", { gatewayPort, remote: remoteArg });
                          setWhatsappQrDataUrl(qrDataUrl);
                          await invoke("wait_whatsapp_login", { gatewayPort, remote: remoteArg });
                          // Treat any return (true or false) as success — the gateway sometimes
                          // returns connected:false even when the scan succeeded (credentials saved).
                          // Only an exception means something genuinely failed.
                          setWhatsappQrDataUrl("");
                          setWhatsappPaired(true);
                          invoke("restart_openclaw_gateway", { remote: remoteArg })
                            .catch(console.error);
                        } catch (err) {
                          console.error(err);
                          alert("WhatsApp pairing error: " + err);
                          setWhatsappQrDataUrl("");
                          setWhatsappQrStep(false);
                        }
                        setWhatsappQrLoading(false);
                      }}
                    >
                      {whatsappQrLoading ? "Connecting to gateway (may take ~30s)..." : "Start WhatsApp Pairing"}
                    </button>
                  ) : (
                    <div style={{ textAlign: "center" }}>
                      {whatsappQrDataUrl ? (
                        <>
                          <img
                            src={whatsappQrDataUrl}
                            alt="WhatsApp QR Code"
                            style={{ width: "220px", height: "220px", borderRadius: "8px", marginBottom: "1rem" }}
                          />
                          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                            Open WhatsApp &rarr; Linked Devices &rarr; Link a Device &rarr; Scan this QR
                          </p>
                          <button
                            className="secondary"
                            style={{ marginTop: "0.5rem" }}
                            onClick={async () => {
                              try {
                                const remoteArg = targetEnvironment === "cloud" ? { ip: remoteIp, user: remoteUser, password: remotePassword || null, privateKeyPath: remotePrivateKeyPath || null } : null;
                                const qrDataUrl: string = await invoke("start_whatsapp_login", { gatewayPort, remote: remoteArg });
                                setWhatsappQrDataUrl(qrDataUrl);
                                await invoke("wait_whatsapp_login", { gatewayPort, remote: remoteArg });
                                setWhatsappQrDataUrl("");
                                setWhatsappPaired(true);
                                invoke("restart_openclaw_gateway", { remote: remoteArg })
                                  .catch(console.error);
                              } catch (err) {
                                console.error(err);
                                alert("WhatsApp pairing error: " + err);
                                setWhatsappQrDataUrl("");
                              }
                            }}
                          >
                            Refresh QR
                          </button>
                        </>
                      ) : (
                        <p style={{ color: "var(--text-muted)" }}>Waiting for QR code from gateway...</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {messagingChannel === "whatsapp" && whatsappPaired && (
                <div style={{ marginTop: "1rem", padding: "1rem", background: "rgba(34, 197, 94, 0.1)", border: "1px solid var(--success)", borderRadius: "8px", textAlign: "center" }}>
                  <p style={{ color: "var(--success)", fontWeight: 600, margin: 0 }}>WhatsApp linked successfully!</p>
                </div>
              )}

              {true && (
                <div className="advanced-setup-prompt" style={{ marginTop: "2rem", padding: "1.5rem", backgroundColor: "rgba(59, 130, 246, 0.1)", borderRadius: "12px", border: "1px solid var(--primary)" }}>
                  <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Configuration Complete</h3>
                  {mode !== "advanced" ? (
                    <>
                      <p style={{ marginBottom: "0.75rem", fontSize: "1rem" }}>Your agent is live. But right now, it's a solo worker.</p>
                      <p style={{ marginBottom: "1rem", fontSize: "1.05rem", fontWeight: 600 }}>Give it a team.</p>
                      <p style={{ marginBottom: "1rem", fontSize: "0.9rem", lineHeight: "1.7", color: "var(--text-main)" }}>
                        Deploy a fleet of specialized AI agents that research, write, code, manage email, track tasks, and handle customers — all working together, 24/7, while you focus on what matters.
                      </p>
                      <div style={{ marginBottom: "1.25rem", fontSize: "0.85rem", lineHeight: "2", color: "var(--text-muted)" }}>
                        <div>Multi-agent teams &bull; 40+ integrations &bull; Scheduled automations</div>
                        <div>CRM, support, social media &bull; Smart failover &bull; Security controls</div>
                      </div>
                    </>
                  ) : (
                    <p style={{ marginBottom: "1.5rem" }}>Your agent is paired and ready.</p>
                  )}
                  <div className="button-group" style={{ gap: "1rem" }}>
                    <button className="primary" onClick={() => open(dashboardUrl)}>
                      Open Web Dashboard
                    </button>
                    {mode !== "advanced" && (
                      <button className="secondary" onClick={handleAdvancedTransition}>
                        Continue to Advanced Settings
                      </button>
                    )}
                    <button className="secondary" onClick={() => invoke("close_app")}>
                      Exit Setup
                    </button>
                  </div>
                  <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); open("https://aimodelscompass.gumroad.com/l/clawnetes"); }}
                      style={{ color: "var(--text-muted)", fontSize: "0.9rem", textDecoration: "underline", cursor: "pointer" }}
                    >
                      If you find OpenClaw useful, please consider making a small donation to support development.
                    </a>
                  </div>
                </div>
              )}
            </div>

            {false && (
              <div className="button-group" style={{ flexDirection: "column", gap: "10px" }}>
                <button className="primary" style={{ width: "100%" }} onClick={() => open(dashboardUrl)}>
                  Open Web Dashboard {targetEnvironment === "cloud" && "(via Tunnel)"}
                </button>
                <button className="secondary" style={{ width: "100%" }} onClick={() => invoke("close_app")}>Exit Setup</button>
              </div>
            )}
            <p style={{ marginTop: "2rem", fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "center" }}>
              Terminal access: <code>openclaw tui</code> {targetEnvironment === "cloud" && `(SSH to ${remoteIp})`}
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-container">
      <div className="top-bar">
        <span className="top-bar-title">Clawnetes</span>
      </div>
      <div className="step-progress">
        {stepsList
          .filter(s => !s.hidden)
          .filter(s => mode === "advanced" || !s.advanced)
          .filter(s => !skipBasicConfig || (s.id !== 8 && s.id !== 9))
          .map((s) => (
            <div key={s.id} className={`step-dot ${getStepStatus(s.id)}`} />
          ))}
      </div>

      <main className="main-content">
        <div className="content-wrapper">
          {renderStep()}
        </div>
      </main>

    </div>
  );
}

export default App;
