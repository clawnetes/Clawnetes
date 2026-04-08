import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, openDialog, openExternal } from "./lib/tauri";
import "./App.css";
import { PERSONA_TEMPLATES } from "./presets/personaTemplates";
import { MODELS_BY_PROVIDER, DEFAULT_MODELS, PROVIDER_LOGOS, EMOJI_OPTIONS, SKILL_ICONS } from "./presets/modelsByProvider";
import { AVAILABLE_SKILLS } from "./presets/availableSkills";
import { AGENT_TYPE_PRESETS } from "./presets/agentPresets";
import { BUSINESS_FUNCTION_PRESETS } from "./presets/businessFunctionPresets";
import { updateIdentityField, updateSoulMission } from "./utils/markdownHelpers";
import { getAgentSessionInitIds } from "./utils/agentSessions";
import { getAdvancedTransitionAction } from "./utils/licenseGate";
import { getMessagingChannelFromConfig, getTelegramPairingDisplayCode, hasMessagingSettingsChanged, isMessagingLinked, shouldShowTelegramPairing, shouldShowWhatsAppPairing } from "./utils/messagingPairing";
import { applyModelProviderAuth, buildDeferredOAuthQueue, buildReferencedProviders, createDefaultProviderAuth, ensureProviderAuth, getBaseProvider, getBaseProviderFromModel, getDefaultModelForProvider, getDisplayModelOptions, getProviderAuthOptions, isOAuthMethod, LOCAL_PROVIDERS, normalizeModelRefForUi, normalizeProviderAuths, OAUTH_METHODS_BY_PROVIDER } from "./utils/providerAuth";
import ToolPolicyEditor from "./components/ToolPolicyEditor";
import { createInheritedToolPolicy, DEFAULT_TOOL_POLICY, deriveToolPolicyFromLegacy, getSkillIdSet, materializeToolPolicy, normalizeSkillAndToolSelection, normalizeToolPolicy } from "./utils/toolSelection";
import { constructConfigPayload as buildConfigPayload, buildAgentToolsPayload as buildAgentTools } from "./utils/configPayload";
import { executeDeferredOAuthQueue } from "./utils/oauthCompletion";
import { toConfigSandboxMode } from "./utils/sandboxMode";
import {
  continueToAdvancedSettings as continueToAdvancedSettingsController,
  handleAdvancedTransition as handleAdvancedTransitionController,
  handleInstall as handleInstallController,
  handleMaintenanceAction as handleMaintenanceActionController,
  handleToggleTunnel as handleToggleTunnelController,
  loadExistingConfig as loadExistingConfigController,
} from "./utils/wizardControllers";
import Dropdown from "./components/Dropdown";
import type { AgentTypeId, AgentConfigData, BusinessFunctionId, ChatTranscriptScrollSnapshot, CronJobConfig, GatewayChatBootstrap, ProviderAuthConfig, ToolPolicy } from "./types";
import { useWizardState, fieldSetter } from "./hooks/useWizardState";
import { WizardContext } from "./context/WizardContext";
import { clearAllChatShellStorage } from "./lib/chatShellStorage";
import {
  loadEnvironments,
  removeEnvironment,
  upsertEnvironment,
  setActiveEnvironmentId,
  type StoredEnvironment,
} from "./lib/environmentStorage";
import { clearLastRemoteConnectionIfMatches } from "./lib/remoteConnectionStorage";
import StepWelcome from "./components/steps/StepWelcome";
import StepSecurity from "./components/steps/StepSecurity";
import StepIdentity from "./components/steps/StepIdentity";
import StepAgentProfile from "./components/steps/StepAgentProfile";
import StepAgentType from "./components/steps/StepAgentType";
import StepSystemCheck from "./components/steps/StepSystemCheck";
import StepGateway from "./components/steps/StepGateway";
import StepChannels from "./components/steps/StepChannels";
import StepRuntime from "./components/steps/StepRuntime";
import StepEnvironment from "./components/steps/StepEnvironment";
import StepToolAccess from "./components/steps/StepToolAccess";
import StepSecurityConfig from "./components/steps/StepSecurityConfig";
import StepSession from "./components/steps/StepSession";
import StepServiceKeys from "./components/steps/StepServiceKeys";
import StepExtraSettings from "./components/steps/StepExtraSettings";
import StepConnectBrain from "./components/steps/StepConnectBrain";
import StepSkills from "./components/steps/StepSkills";
import StepReview from "./components/steps/StepReview";
import StepConfigReview from "./components/steps/StepConfigReview";
import StepPersonality from "./components/steps/StepPersonality";
import StepBusinessFunctions from "./components/steps/StepBusinessFunctions";
import StepModels from "./components/steps/StepModels";
import StepMaintenance from "./components/steps/StepMaintenance";
import StepAgentConfigLoop from "./components/steps/StepAgentConfigLoop";
import StepComplete from "./components/steps/StepComplete";
import ChatShell from "./components/chat/ChatShell";
import ConfigureDrawer from "./components/chat/ConfigureDrawer";
import { TEXT_ENTRY_PROPS } from "./components/ui/textEntryProps";

function App() {
  const [state, dispatch] = useWizardState();
  const initialConfigRef = useRef<any>(null);
  const loadExistingConfigRef = useRef<() => Promise<any>>(() => Promise.resolve());
  const [appScreen, setAppScreen] = useState<"loading" | "setup" | "chat" | "command-center">("loading");
  const [configUpdating, setConfigUpdating] = useState(false);
  const [pendingMaintenanceConfirm, setPendingMaintenanceConfirm] = useState<"repair" | "audit" | "update" | "uninstall" | null>(null);
  const [chatBootstrap, setChatBootstrap] = useState<GatewayChatBootstrap | null>(null);
  const [chatBootstrapping, setChatBootstrapping] = useState(false);
  const [chatBootstrapError, setChatBootstrapError] = useState("");
  const [pendingChatReturnScrollSnapshot, setPendingChatReturnScrollSnapshot] = useState<ChatTranscriptScrollSnapshot | null>(null);
  const [storedEnvironments, setStoredEnvironments] = useState<StoredEnvironment[]>([]);
  const [addingEnvFromChat, setAddingEnvFromChat] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string>("main");

  // Destructure state for backwards-compatible access throughout the component
  const {
    step, mode, skipBasicConfig, targetEnvironment,
    remoteIp, remoteUser, remotePassword, remotePrivateKeyPath,
    sshStatus, sshError, tunnelActive,
    checks, loading, error, logs, pairingCode, installingNode, nodeInstallError,
    userName, agentName, selectedPersona, agentEmoji, agentType,
    apiKey, authMethod, provider, model,
    telegramToken, progress, dashboardUrl, openClawVersion,
    maintenanceStatus, selectedMaint, maintCompleted,
    showLicenseModal, licenseKey, verifyingLicense, licenseError,
    licenseUnlocked, licenseStatusLoaded, licenseStatusError,
    serviceKeys, providerAuths, providerAuthBusy, providerAuthErrors,
    oauthCompletionRunning, oauthCompletionStarted, oauthCompletionResults,
    currentServiceIdx, isConfiguringService,
    gatewayPort, gatewayBind, gatewayAuthMode, tailscaleMode, nodeManager,
    selectedSkills, sandboxMode, toolPolicy,
    enableFallbacks, fallbackModels, heartbeatMode, idleTimeoutMs,
    toolsMd, agentsMd, heartbeatMd, memoryMd, memoryEnabled,
    identityMd, userMd, soulMd,
    activeWorkspaceTab, initialWorkspace, workspaceModified, savingWorkspace,
    customSkillName, customSkillContent, showCustomSkillForm,
    selectedBusinessFunctions, cronJobs, extraSettingsOpen,
    enableMultiAgent, numAgents, agentConfigs, currentAgentConfigIdx,
    ollamaModels, ollamaDetecting, lmstudioBaseUrl, lmstudioModels, lmstudioDetecting,
    localBaseUrl, localModels, localDetecting,
    thinkingLevel, messagingChannel,
    whatsappDmPolicy, whatsappPhoneNumber, whatsappPhoneSubmitted,
    whatsappQrDataUrl, whatsappPaired, whatsappQrStep, whatsappQrLoading,
    pairingInput, pairingStatus, isPaired,
    validateOutput, validating,
  } = state;

  // Create setter functions with same signatures as the original useState setters
  const setStep = fieldSetter(dispatch, "step");
  const setMode = fieldSetter(dispatch, "mode");
  const setSkipBasicConfig = fieldSetter(dispatch, "skipBasicConfig");
  const setTargetEnvironment = fieldSetter(dispatch, "targetEnvironment");
  const setRemoteIp = fieldSetter(dispatch, "remoteIp");
  const setRemoteUser = fieldSetter(dispatch, "remoteUser");
  const setRemotePassword = fieldSetter(dispatch, "remotePassword");
  const setRemotePrivateKeyPath = fieldSetter(dispatch, "remotePrivateKeyPath");
  const setSshStatus = fieldSetter(dispatch, "sshStatus");
  const setSshError = fieldSetter(dispatch, "sshError");
  const setTunnelActive = fieldSetter(dispatch, "tunnelActive");
  const setChecks = fieldSetter(dispatch, "checks");
  const setLoading = fieldSetter(dispatch, "loading");
  const setError = fieldSetter(dispatch, "error");
  const setLogs = fieldSetter(dispatch, "logs");
  const setPairingCode = fieldSetter(dispatch, "pairingCode");
  const setInstallingNode = fieldSetter(dispatch, "installingNode");
  const setNodeInstallError = fieldSetter(dispatch, "nodeInstallError");
  const setUserName = fieldSetter(dispatch, "userName");
  const setAgentName = fieldSetter(dispatch, "agentName");
  const setSelectedPersona = fieldSetter(dispatch, "selectedPersona");
  const setAgentEmoji = fieldSetter(dispatch, "agentEmoji");
  const setAgentType = fieldSetter(dispatch, "agentType");
  const setApiKey = fieldSetter(dispatch, "apiKey");
  const setAuthMethod = fieldSetter(dispatch, "authMethod");
  const setProvider = fieldSetter(dispatch, "provider");
  const setModel = fieldSetter(dispatch, "model");
  const setTelegramToken = fieldSetter(dispatch, "telegramToken");
  const setProgress = fieldSetter(dispatch, "progress");
  const setDashboardUrl = fieldSetter(dispatch, "dashboardUrl");
  const setOpenClawVersion = fieldSetter(dispatch, "openClawVersion");
  const setMaintenanceStatus = fieldSetter(dispatch, "maintenanceStatus");
  const setSelectedMaint = fieldSetter(dispatch, "selectedMaint");
  const setMaintCompleted = fieldSetter(dispatch, "maintCompleted");
  const setShowLicenseModal = fieldSetter(dispatch, "showLicenseModal");
  const setLicenseKey = fieldSetter(dispatch, "licenseKey");
  const setVerifyingLicense = fieldSetter(dispatch, "verifyingLicense");
  const setLicenseError = fieldSetter(dispatch, "licenseError");
  const setLicenseUnlocked = fieldSetter(dispatch, "licenseUnlocked");
  const setLicenseStatusLoaded = fieldSetter(dispatch, "licenseStatusLoaded");
  const setLicenseStatusError = fieldSetter(dispatch, "licenseStatusError");
  const setServiceKeys = fieldSetter(dispatch, "serviceKeys");
  const setProviderAuths = fieldSetter(dispatch, "providerAuths");
  const setProviderAuthBusy = fieldSetter(dispatch, "providerAuthBusy");
  const setProviderAuthErrors = fieldSetter(dispatch, "providerAuthErrors");
  const setOauthCompletionRunning = fieldSetter(dispatch, "oauthCompletionRunning");
  const setOauthCompletionStarted = fieldSetter(dispatch, "oauthCompletionStarted");
  const setOauthCompletionResults = fieldSetter(dispatch, "oauthCompletionResults");
  const setCurrentServiceIdx = fieldSetter(dispatch, "currentServiceIdx");
  const setIsConfiguringService = fieldSetter(dispatch, "isConfiguringService");
  const setGatewayPort = fieldSetter(dispatch, "gatewayPort");
  const setGatewayBind = fieldSetter(dispatch, "gatewayBind");
  const setGatewayAuthMode = fieldSetter(dispatch, "gatewayAuthMode");
  const setTailscaleMode = fieldSetter(dispatch, "tailscaleMode");
  const setNodeManager = fieldSetter(dispatch, "nodeManager");
  const setSelectedSkills = fieldSetter(dispatch, "selectedSkills");
  const setSandboxMode = fieldSetter(dispatch, "sandboxMode");
  const setToolPolicy = fieldSetter(dispatch, "toolPolicy");
  const setEnableFallbacks = fieldSetter(dispatch, "enableFallbacks");
  const setFallbackModels = fieldSetter(dispatch, "fallbackModels");
  const setHeartbeatMode = fieldSetter(dispatch, "heartbeatMode");
  const setIdleTimeoutMs = fieldSetter(dispatch, "idleTimeoutMs");
  const setToolsMd = fieldSetter(dispatch, "toolsMd");
  const setAgentsMd = fieldSetter(dispatch, "agentsMd");
  const setHeartbeatMd = fieldSetter(dispatch, "heartbeatMd");
  const setMemoryMd = fieldSetter(dispatch, "memoryMd");
  const setMemoryEnabled = fieldSetter(dispatch, "memoryEnabled");
  const setSelectedBusinessFunctions = fieldSetter(dispatch, "selectedBusinessFunctions");
  const setCronJobs = fieldSetter(dispatch, "cronJobs");
  const setExtraSettingsOpen = fieldSetter(dispatch, "extraSettingsOpen");
  const setEnableMultiAgent = fieldSetter(dispatch, "enableMultiAgent");
  const setNumAgents = fieldSetter(dispatch, "numAgents");
  const setAgentConfigs = fieldSetter(dispatch, "agentConfigs");
  const setCurrentAgentConfigIdx = fieldSetter(dispatch, "currentAgentConfigIdx");
  const setIdentityMd = fieldSetter(dispatch, "identityMd");
  const setUserMd = fieldSetter(dispatch, "userMd");
  const setSoulMd = fieldSetter(dispatch, "soulMd");
  const setActiveWorkspaceTab = fieldSetter(dispatch, "activeWorkspaceTab");
  const setInitialWorkspace = fieldSetter(dispatch, "initialWorkspace");
  const setWorkspaceModified = fieldSetter(dispatch, "workspaceModified");
  const setSavingWorkspace = fieldSetter(dispatch, "savingWorkspace");
  const setCustomSkillName = fieldSetter(dispatch, "customSkillName");
  const setCustomSkillContent = fieldSetter(dispatch, "customSkillContent");
  const setShowCustomSkillForm = fieldSetter(dispatch, "showCustomSkillForm");
  const setPairingInput = fieldSetter(dispatch, "pairingInput");
  const setPairingStatus = fieldSetter(dispatch, "pairingStatus");
  const setIsPaired = fieldSetter(dispatch, "isPaired");
  const setOllamaModels = fieldSetter(dispatch, "ollamaModels");
  const setOllamaDetecting = fieldSetter(dispatch, "ollamaDetecting");
  const setLmstudioBaseUrl = fieldSetter(dispatch, "lmstudioBaseUrl");
  const setLmstudioModels = fieldSetter(dispatch, "lmstudioModels");
  const setLmstudioDetecting = fieldSetter(dispatch, "lmstudioDetecting");
  const setLocalBaseUrl = fieldSetter(dispatch, "localBaseUrl");
  const setLocalModels = fieldSetter(dispatch, "localModels");
  const setLocalDetecting = fieldSetter(dispatch, "localDetecting");
  const setThinkingLevel = fieldSetter(dispatch, "thinkingLevel");
  const setMessagingChannel = fieldSetter(dispatch, "messagingChannel");
  const setWhatsappDmPolicy = fieldSetter(dispatch, "whatsappDmPolicy");
  const setWhatsappPhoneNumber = fieldSetter(dispatch, "whatsappPhoneNumber");
  const setWhatsappPhoneSubmitted = fieldSetter(dispatch, "whatsappPhoneSubmitted");
  const setWhatsappQrDataUrl = fieldSetter(dispatch, "whatsappQrDataUrl");
  const setWhatsappPaired = fieldSetter(dispatch, "whatsappPaired");
  const setWhatsappQrStep = fieldSetter(dispatch, "whatsappQrStep");
  const setWhatsappQrLoading = fieldSetter(dispatch, "whatsappQrLoading");
  const setValidateOutput = fieldSetter(dispatch, "validateOutput");
  const setValidating = fieldSetter(dispatch, "validating");

  const servicesToConfigure = [
    { id: "goplaces", name: "Google Places", placeholder: "API Key" },
    { id: "notion", name: "Notion", placeholder: "Internal Integration Token" },
    { id: "elevenlabs", name: "ElevenLabs (SAG)", placeholder: "API Key" },
    { id: "nano-banana", name: "Nano Banana Pro", placeholder: "API Key" },
    { id: "openai-images", name: "OpenAI Image Gen", placeholder: "API Key" }
  ];


  const availableSkills = AVAILABLE_SKILLS;
  const availableSkillIds = getSkillIdSet(availableSkills);

  // Apply agent type preset - sets all relevant state from a preset
  function applyAgentTypePreset(typeId: AgentTypeId) {
    setAgentType(typeId);
    if (typeId === "custom") return;

    const preset = AGENT_TYPE_PRESETS[typeId];
    if (!preset) return;

    // Set provider and model
    const nextAuth = providerAuths[preset.provider] || createDefaultProviderAuth(preset.provider);
    setProvider(preset.provider);
    setModel(preset.model);
    setApiKey(nextAuth.token);
    setAuthMethod(nextAuth.auth_method);

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

  const buildActiveRemoteConfig = useCallback(() => {
    if (targetEnvironment !== "cloud") {
      return null;
    }

    return {
      ip: remoteIp,
      user: remoteUser,
      password: remotePassword || null,
      privateKeyPath: remotePrivateKeyPath || null,
    };
  }, [remoteIp, remotePassword, remotePrivateKeyPath, remoteUser, targetEnvironment]);

  const bootstrapGatewayChat = useCallback(async () => {
    setChatBootstrapping(true);
    setChatBootstrapError("");

    try {
      const bootstrap = await invoke<GatewayChatBootstrap>("prepare_gateway_chat_connection", {
        gatewayPort,
        remote: buildActiveRemoteConfig(),
      });
      setChatBootstrap(bootstrap);
      setAppScreen("chat");
      await loadExistingConfigRef.current().catch(() => {});
      // Save this environment to the registry
      const saved = upsertEnvironment({
        type: targetEnvironment as "local" | "cloud",
        remoteIp: targetEnvironment === "cloud" ? remoteIp : undefined,
        remoteUser: targetEnvironment === "cloud" ? remoteUser : undefined,
        remotePassword: targetEnvironment === "cloud" ? remotePassword : undefined,
        remotePrivateKeyPath: targetEnvironment === "cloud" ? remotePrivateKeyPath : undefined,
      });
      setActiveEnvironmentId(saved.id);
      setStoredEnvironments(loadEnvironments());
    } catch (error) {
      setChatBootstrap(null);
      setChatBootstrapError(String(error));
    } finally {
      setChatBootstrapping(false);
    }
  }, [buildActiveRemoteConfig, gatewayPort, targetEnvironment, remoteIp, remoteUser]);

  useEffect(() => { void checkSystem(true, false); setStoredEnvironments(loadEnvironments()); }, []);

  const activeStoredEnvironmentId = chatBootstrap ? storedEnvironments.find(
    (e) => e.type === (chatBootstrap.targetEnvironment as "local" | "cloud")
      && (chatBootstrap.targetEnvironment === "local" || (e.remoteIp === remoteIp && e.remoteUser === remoteUser)),
  )?.id || null : null;

  const handleSwitchEnvironment = useCallback((envId: string) => {
    const envs = loadEnvironments();
    const env = envs.find((e) => e.id === envId);
    if (!env) return;

    if (env.type === "cloud") {
      setTargetEnvironment("cloud");
      setRemoteIp(env.remoteIp || "");
      setRemoteUser(env.remoteUser || "");
      setRemotePassword(env.remotePassword || "");
      setRemotePrivateKeyPath(env.remotePrivateKeyPath || "");
      setChatBootstrap(null);
      return;
    }

    // Local — switch immediately
    setTargetEnvironment("local");
    setRemoteIp("");
    setRemoteUser("");
    setRemotePassword("");
    setRemotePrivateKeyPath("");
    setChatBootstrap(null);
  }, [setTargetEnvironment, setRemoteIp, setRemoteUser, setRemotePassword, setRemotePrivateKeyPath]);

  const handleRemoveEnvironment = useCallback((envId: string) => {
    const env = loadEnvironments().find((entry) => entry.id === envId);
    if (!env || env.type !== "cloud" || env.id === activeStoredEnvironmentId) {
      return;
    }

    removeEnvironment(env.id);
    if (env.remoteIp && env.remoteUser) {
      clearLastRemoteConnectionIfMatches(env.remoteIp, env.remoteUser);
    }
    setStoredEnvironments(loadEnvironments());
  }, [activeStoredEnvironmentId]);

  const handleAddEnvironment = useCallback(() => {
    setTargetEnvironment("cloud");
    setRemoteIp("");
    setRemoteUser("");
    setRemotePassword("");
    setRemotePrivateKeyPath("");
    setSshStatus("idle");
    setSshError("");
    setStep(1);
    setAddingEnvFromChat(true);
    setAppScreen("setup");
  }, [setTargetEnvironment, setRemoteIp, setRemoteUser, setRemotePassword, setRemotePrivateKeyPath, setSshStatus, setSshError, setStep]);

  const handleBackToChat = useCallback(() => {
    setAddingEnvFromChat(false);
    setAppScreen("chat");
  }, []);

  useEffect(() => {
    if (appScreen !== "chat") return;
    if (chatBootstrapping || chatBootstrap) return;
    void bootstrapGatewayChat();
  }, [appScreen, chatBootstrap, chatBootstrapping, bootstrapGatewayChat]);

  useEffect(() => {
    let cancelled = false;

    const loadSavedLicenseState = async () => {
      try {
        const unlocked = await invoke<boolean>("has_saved_license");
        if (cancelled) return;
        setLicenseUnlocked(unlocked);
        setLicenseStatusError("");
      } catch (e) {
        if (cancelled) return;
        setLicenseUnlocked(false);
        setLicenseStatusError(String(e));
      } finally {
        if (!cancelled) {
          setLicenseStatusLoaded(true);
        }
      }
    };

    loadSavedLicenseState();

    return () => {
      cancelled = true;
    };
  }, []);

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
          const status: boolean = await invoke("check_messaging_link_status", {
            channel: messagingChannel,
            remote: remoteConfig
          });
          if (messagingChannel === "telegram") {
            setIsPaired(status);
          } else if (messagingChannel === "whatsapp") {
            setWhatsappPaired(status);
            if (status) setWhatsappPhoneSubmitted(true);
          }
        } catch (e) { console.error("Failed to check pairing status:", e); }
      };
      if (messagingChannel !== "none") checkPairing();
    }
  }, [step, messagingChannel, targetEnvironment, remoteIp, remoteUser, remotePassword, remotePrivateKeyPath]);

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
    setProviderAuths(prev => ensureProviderAuth(prev, provider));
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

  function mergeProviderAuth(
    currentProviderAuths: Record<string, ProviderAuthConfig>,
    targetProvider: string,
    nextAuth: ProviderAuthConfig,
  ) {
    const normalizedProvider = getBaseProvider(targetProvider);
    return {
      ...currentProviderAuths,
      [normalizedProvider]: nextAuth,
    };
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

  const configPayloadInput = {
    provider, apiKey, authMethod, model, userName, agentName, agentEmoji, agentType,
    telegramToken, gatewayPort, gatewayBind, gatewayAuthMode, tailscaleMode, nodeManager,
    selectedSkills, serviceKeys, providerAuths, sandboxMode, toolPolicy, enableFallbacks,
    fallbackModels, heartbeatMode, idleTimeoutMs, identityMd, userMd, soulMd, toolsMd,
    agentsMd, heartbeatMd, memoryMd, memoryEnabled, enableMultiAgent, agentConfigs, isPaired,
    cronJobs, localBaseUrl, lmstudioBaseUrl, thinkingLevel, messagingChannel, whatsappDmPolicy,
    whatsappPhoneNumber, mode,
  };
  const configPayloadRef = useRef(configPayloadInput);
  configPayloadRef.current = configPayloadInput;

  const continueToAdvancedSettings = useCallback(async () => {
    await continueToAdvancedSettingsController({
      step,
      licenseStatusLoaded,
      licenseUnlocked,
      licenseStatusError,
      setMode,
      setPairingStatus,
      setSkipBasicConfig,
      setMaintCompleted,
      setStep,
      setLicenseError,
      setShowLicenseModal,
      initialConfigRef,
    });
  }, [
    initialConfigRef,
    licenseStatusError,
    licenseStatusLoaded,
    licenseUnlocked,
    setLicenseError,
    setMaintCompleted,
    setMode,
    setPairingStatus,
    setShowLicenseModal,
    setSkipBasicConfig,
    setStep,
    step,
  ]);

  const handleAdvancedTransition = useCallback(async () => {
    await handleAdvancedTransitionController({
      step,
      licenseStatusLoaded,
      licenseUnlocked,
      licenseStatusError,
      setMode,
      setPairingStatus,
      setSkipBasicConfig,
      setMaintCompleted,
      setStep,
      setLicenseError,
      setShowLicenseModal,
      initialConfigRef,
    });
  }, [
    initialConfigRef,
    licenseStatusError,
    licenseStatusLoaded,
    licenseUnlocked,
    setLicenseError,
    setMaintCompleted,
    setMode,
    setPairingStatus,
    setShowLicenseModal,
    setSkipBasicConfig,
    setStep,
    step,
  ]);

  async function runDeferredOAuthQueue() {
    if (oauthCompletionRunning || deferredOAuthQueue.length === 0) return;

    setOauthCompletionRunning(true);
    setOauthCompletionStarted(true);
    const { nextProviderAuths, successfulItems } = await executeDeferredOAuthQueue({
      queue: deferredOAuthQueue,
      initialProviderAuths: providerAuths,
      invokeProviderAuth: (item) => invoke<ProviderAuthConfig>("start_provider_auth", {
        provider: item.targetProvider,
        method: item.authMethod,
        oauthProviderId: item.oauthProviderId,
        remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null,
      }),
      onItemStart: (item) => {
        setOauthCompletionResults(prev => ({
          ...prev,
          [item.id]: { status: "pending", message: "Opening a terminal for interactive OpenClaw authentication..." },
        }));
      },
      onItemSuccess: (item, result) => {
        updateProviderAuth(item.targetProvider, result);
        setOauthCompletionResults(prev => ({
          ...prev,
          [item.id]: { status: "success", message: `Connected via ${item.label}. OpenClaw imported the auth profile.` },
        }));
      },
      onItemError: (item, message) => {
        setOauthCompletionResults(prev => ({
          ...prev,
          [item.id]: { status: "error", message },
        }));
      },
      onProviderBusyChange: (providerId, busy) => {
        setProviderAuthBusy(prev => ({ ...prev, [providerId]: busy }));
      },
      onProviderErrorChange: (providerId, message) => {
        setProviderAuthErrors(prev => ({ ...prev, [providerId]: message }));
      },
    });

    if (successfulItems.length > 0 && targetEnvironment !== "cloud") {
      try {
        await invoke("configure_agent", {
          config: {
            ...buildConfigPayload(configPayloadInput, nextProviderAuths),
            preserve_state: true,
          },
          remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null,
        });
      } catch (e: any) {
        const message = `OAuth succeeded, but saving the imported auth profile failed: ${String(e)}`;
        setOauthCompletionResults(prev => {
          const next = { ...prev };
          for (const item of successfulItems) {
            next[item.id] = { status: "error", message };
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
              {...TEXT_ENTRY_PROPS}
              type="password"
              data-testid="input-api-key"
              placeholder={auth.auth_method === "setup-token" ? "Paste `claude setup-token` output" : normalizedProvider === "google" ? "Paste your Gemini API key" : `Paste your ${normalizedProvider} API key`}
              value={auth.token}
              onChange={(e) => updateProviderAuth(normalizedProvider, { token: e.target.value })}
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
            {normalizedProvider === "google" && auth.auth_method === "google-gemini-cli" && !hasCredential && (
              <p className="input-hint" style={{ marginTop: "0.25rem", color: "var(--warning, #b45309)" }}>
                This is an unofficial Google Code Assist integration. Some users have reported Google account restrictions after using third-party Gemini CLI clients. If Google rejects it, use the Gemini API key option instead, or set `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT_ID` before retrying.
              </p>
            )}
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
      await checkSystem(true, false);
    } catch (e: any) {
      setNodeInstallError("Failed to install: " + e);
    } finally {
      setInstallingNode(false);
    }
  }

  async function checkSystem(skipRedirect = false, allowInstalledChat = true) {
    // Always check local system on initial load
    const res: any = await invoke("check_prerequisites");
    setChecks({
      node: res.node_installed,
      docker: res.docker_running,
      openclaw: res.openclaw_installed
    });
    const version: string = await invoke("get_openclaw_version");
    setOpenClawVersion(version);

    if (res.openclaw_installed) {
      if (allowInstalledChat) {
        setAppScreen("chat");
      } else {
        setStep(1);
        setAppScreen("setup");
      }
      return true;
    } else if (!skipRedirect) {
      setStep(0.5);
      setAppScreen("setup");
    } else {
      setAppScreen("setup");
    }
    return res.openclaw_installed;
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

      if (res.openclaw_installed) {
        setAppScreen("chat");
        return true;
      }
      return res.openclaw_installed;
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
      preserve_state: null,
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
    return buildAgentTools(policy, inheritedPolicy, availableSkillIds);
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
      sandbox_mode: toConfigSandboxMode(initial.sandbox_mode),
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

  function getCurrentMessagingSettings() {
    return {
      channel: messagingChannel,
      telegramToken,
      whatsappDmPolicy,
      whatsappPhoneNumber,
    };
  }

  function getInitialMessagingSettings(initial: any) {
    return {
      channel: getMessagingChannelFromConfig(initial || {}),
      telegramToken: initial?.telegram_token || "",
      whatsappDmPolicy: initial?.whatsapp_dm_policy || null,
      whatsappPhoneNumber: initial?.whatsapp_phone_number || "",
    };
  }

  const handleInstall = useCallback(async () => {
    await handleInstallController({
      state: {
        targetEnvironment,
        remoteIp,
        remoteUser,
        remotePassword,
        remotePrivateKeyPath,
        checks,
        isPaired,
        whatsappPaired,
        messagingChannel,
        telegramToken,
        whatsappDmPolicy,
        whatsappPhoneNumber,
        gatewayPort,
        selectedSkills,
      },
      configPayloadInput,
      initialConfigRef,
      transformInitialToPayload,
      normalizeForComparison,
      isDeepEqual,
      setLoading,
      setError,
      setProgress,
      setLogs,
      setIsPaired,
      setWhatsappPaired,
      setWhatsappPhoneSubmitted,
      setOpenClawVersion,
      setChecks,
      setTunnelActive,
      setPairingCode,
      setDashboardUrl,
      setStep,
    });
  }, [
    checks,
    configPayloadInput,
    initialConfigRef,
    isPaired,
    isDeepEqual,
    messagingChannel,
    normalizeForComparison,
    remoteIp,
    remotePassword,
    remotePrivateKeyPath,
    remoteUser,
    selectedSkills,
    setChecks,
    setDashboardUrl,
    setError,
    setIsPaired,
    setLoading,
    setLogs,
    setOpenClawVersion,
    setPairingCode,
    setProgress,
    setStep,
    setTunnelActive,
    setWhatsappPaired,
    setWhatsappPhoneSubmitted,
    gatewayPort,
    targetEnvironment,
    telegramToken,
    transformInitialToPayload,
    whatsappDmPolicy,
    whatsappPaired,
    whatsappPhoneNumber,
  ]);

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

  const handleMaintenanceAction = useCallback(async (action: string) => {
    return await handleMaintenanceActionController({
      state: {
        targetEnvironment,
        sshStatus,
        remoteIp,
        remoteUser,
        remotePassword,
        remotePrivateKeyPath,
        gatewayPort,
      },
      setLoading,
      setMaintenanceStatus,
      setLogs,
      setChecks,
      setMaintCompleted,
    }, action);
  }, [
    gatewayPort,
    remoteIp,
    remotePassword,
    remotePrivateKeyPath,
    remoteUser,
    setChecks,
    setLoading,
    setLogs,
    setMaintCompleted,
    setMaintenanceStatus,
    sshStatus,
    targetEnvironment,
  ]);

  const loadExistingConfig = useCallback(async () => {
    return loadExistingConfigController({
      state: {
        targetEnvironment,
        remoteIp,
        remoteUser,
        remotePassword,
        remotePrivateKeyPath,
      },
      initialConfigRef,
      availableSkillIds,
      getLoadedTopLevelToolPolicy,
      getLoadedAgentToolPolicy,
      setLoading,
      setMaintenanceStatus,
      setMode,
      setProvider,
      setApiKey,
      setAuthMethod,
      setProviderAuths,
      setModel,
      setUserName,
      setAgentName,
      setAgentEmoji,
      setAgentType,
      setTelegramToken,
      setGatewayPort,
      setGatewayBind,
      setGatewayAuthMode,
      setTailscaleMode,
      setNodeManager,
      setSelectedSkills,
      setServiceKeys,
      setSandboxMode,
      setToolPolicy,
      setFallbackModels,
      setEnableFallbacks,
      setHeartbeatMode,
      setIdleTimeoutMs,
      setIdentityMd,
      setUserMd,
      setSoulMd,
      setInitialWorkspace,
      setToolsMd,
      setAgentsMd,
      setHeartbeatMd,
      setMemoryMd,
      setMemoryEnabled,
      setCronJobs,
      setMessagingChannel,
      setWhatsappPaired,
      setWhatsappPhoneSubmitted,
      setWhatsappPhoneNumber,
      setWhatsappDmPolicy,
      setThinkingLevel,
      setLmstudioBaseUrl,
      setLocalBaseUrl,
      setEnableMultiAgent,
      setNumAgents,
      setAgentConfigs,
      setIsPaired,
    });
  }, [
    availableSkillIds,
    getLoadedAgentToolPolicy,
    getLoadedTopLevelToolPolicy,
    initialConfigRef,
    remoteIp,
    remotePassword,
    remotePrivateKeyPath,
    remoteUser,
    setAgentConfigs,
    setAgentEmoji,
    setAgentName,
    setAgentType,
    setAgentsMd,
    setApiKey,
    setAuthMethod,
    setCronJobs,
    setEnableFallbacks,
    setEnableMultiAgent,
    setFallbackModels,
    setGatewayAuthMode,
    setGatewayBind,
    setGatewayPort,
    setHeartbeatMd,
    setHeartbeatMode,
    setIdentityMd,
    setIdleTimeoutMs,
    setInitialWorkspace,
    setIsPaired,
    setLmstudioBaseUrl,
    setLoading,
    setLocalBaseUrl,
    setMaintenanceStatus,
    setMemoryEnabled,
    setMemoryMd,
    setMessagingChannel,
    setMode,
    setModel,
    setNodeManager,
    setNumAgents,
    setProvider,
    setProviderAuths,
    setSandboxMode,
    setSelectedSkills,
    setServiceKeys,
    setSoulMd,
    setTailscaleMode,
    setTelegramToken,
    setThinkingLevel,
    setToolPolicy,
    setToolsMd,
    setUserMd,
    setUserName,
    setWhatsappDmPolicy,
    setWhatsappPaired,
    setWhatsappPhoneNumber,
    setWhatsappPhoneSubmitted,
    targetEnvironment,
  ]);
  loadExistingConfigRef.current = loadExistingConfig;

  const restartGatewayAfterPanelUpdate = useCallback(async () => {
    setConfigUpdating(true);
    try {
      await invoke("restart_openclaw_gateway", {
        remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null,
      });
    } finally {
      setConfigUpdating(false);
    }
  }, [targetEnvironment, buildActiveRemoteConfig]);

  const handleToggleTunnel = useCallback(async () => {
    await handleToggleTunnelController({
      state: {
        tunnelActive,
        remoteIp,
        remoteUser,
        remotePassword,
        remotePrivateKeyPath,
        gatewayPort,
      },
      setLoading,
      setTunnelActive,
      setMaintenanceStatus,
    });
  }, [
    remoteIp,
    remotePassword,
    remotePrivateKeyPath,
    remoteUser,
    setLoading,
    setMaintenanceStatus,
    setTunnelActive,
    tunnelActive,
  ]);

  const openChatWorkspace = useCallback(() => {
    setChatBootstrap(null);
    setChatBootstrapError("");
    setLogs("");
    setMaintenanceStatus("");
    setMaintCompleted(false);
    setAppScreen("chat");
  }, [setLogs, setMaintCompleted, setMaintenanceStatus]);

  const openCommandCenter = useCallback((snapshot: ChatTranscriptScrollSnapshot | null) => {
    setPendingChatReturnScrollSnapshot(snapshot);
    if (!loading) {
      setLogs("");
      setMaintenanceStatus("");
      setMaintCompleted(false);
    }
    setAppScreen("command-center");
  }, [loading, setLogs, setMaintCompleted, setMaintenanceStatus]);

  const handleReconfigureFromDrawer = useCallback(async () => {
    const loaded = await loadExistingConfig();
    if (!loaded) return;
    setPendingChatReturnScrollSnapshot(null);
    setChatBootstrap(null);
    setChatBootstrapError("");
    setAppScreen("setup");
    setMode("advanced");
    setStep(6);
  }, [loadExistingConfig, setMode, setStep]);

  useEffect(() => {
    if (appScreen !== "chat" && appScreen !== "command-center") {
      setPendingChatReturnScrollSnapshot(null);
    }
  }, [appScreen]);

  const requestMaintenanceConfirmation = useCallback((action: "repair" | "audit" | "update" | "uninstall") => {
    if (loading) return;
    setPendingMaintenanceConfirm(action);
  }, [loading]);

  const closeMaintenanceConfirmation = useCallback(() => {
    if (loading) return;
    setPendingMaintenanceConfirm(null);
  }, [loading]);

  const completeUninstallFlow = useCallback(() => {
    clearAllChatShellStorage();
    setChatBootstrap(null);
    setChatBootstrapError("");
    setLogs("");
    setMaintenanceStatus("");
    setMaintCompleted(false);
    setAppScreen("setup");
    setStep(0.5);
  }, [setLogs, setMaintCompleted, setMaintenanceStatus, setStep]);

  const confirmMaintenanceAction = useCallback(async () => {
    if (!pendingMaintenanceConfirm) return;

    const action = pendingMaintenanceConfirm;
    setPendingMaintenanceConfirm(null);
    const succeeded = await handleMaintenanceAction(action);

    if (action === "uninstall" && succeeded) {
      completeUninstallFlow();
      return;
    }

    if (succeeded) {
      setChatBootstrap(null);
    }
  }, [completeUninstallFlow, handleMaintenanceAction, pendingMaintenanceConfirm]);

  const handleDrawerMaintenanceAction = useCallback(async (action: "repair" | "audit" | "update" | "uninstall") => {
    requestMaintenanceConfirmation(action);
  }, [requestMaintenanceConfirmation]);

  const toggleSkill = (id: string) => {
    setSelectedSkills(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  // ── Panel handlers (for right panel in chat) ──

  const handlePanelModelChange = useCallback(async (newModel: string) => {
    let nextAgentConfigs = configPayloadRef.current.agentConfigs;
    const nextProvider = getBaseProviderFromModel(newModel) || configPayloadRef.current.provider;
    
    let nextApiKey = configPayloadRef.current.apiKey;
    let nextAuthMethod = configPayloadRef.current.authMethod;

    if (activeAgentId && activeAgentId !== "main") {
      // Sub-agent: update that agent's model in agentConfigs
      nextAgentConfigs = nextAgentConfigs.map(a =>
        a.id === activeAgentId ? { ...a, model: newModel } : a
      );
      setAgentConfigs(nextAgentConfigs);
    } else {
      // Main agent: update main model state
      const nextAuth = configPayloadRef.current.providerAuths[nextProvider] || createDefaultProviderAuth(nextProvider);
      nextApiKey = nextAuth.token;
      nextAuthMethod = nextAuth.auth_method;

      setProvider(nextProvider);
      setModel(newModel);
      setApiKey(nextApiKey);
      setAuthMethod(nextAuthMethod);
    }
    try {
      const payload = buildConfigPayload({
        ...configPayloadRef.current,
        agentConfigs: nextAgentConfigs,
        provider: (activeAgentId === "main" || !activeAgentId) ? nextProvider : configPayloadRef.current.provider,
        model: (activeAgentId === "main" || !activeAgentId) ? newModel : configPayloadRef.current.model,
        apiKey: (activeAgentId === "main" || !activeAgentId) ? nextApiKey : configPayloadRef.current.apiKey,
        authMethod: (activeAgentId === "main" || !activeAgentId) ? nextAuthMethod : configPayloadRef.current.authMethod,
      });
      await invoke("configure_agent", { config: { ...payload, preserve_state: true }, remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null });
      await restartGatewayAfterPanelUpdate();
    } catch (e) {
      console.error("Failed to update model:", e);
    }
  }, [activeAgentId, restartGatewayAfterPanelUpdate, setAgentConfigs, setModel, setProvider, setApiKey, setAuthMethod, targetEnvironment, buildActiveRemoteConfig]);

  const handlePanelFallbacksChange = useCallback(async (newFallbacks: string[]) => {
    setFallbackModels(newFallbacks);
    try {
      const payload = buildConfigPayload({ ...configPayloadRef.current, fallbackModels: newFallbacks });
      await invoke("configure_agent", { config: { ...payload, preserve_state: true }, remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null });
      await restartGatewayAfterPanelUpdate();
    } catch (e) {
      console.error("Failed to update fallback models:", e);
    }
  }, [restartGatewayAfterPanelUpdate, setFallbackModels]);

  const handlePanelLocalBaseUrlChange = useCallback(async (provider: "lmstudio" | "local", baseUrl: string) => {
    if (provider === "lmstudio") {
      setLmstudioBaseUrl(baseUrl);
    } else {
      setLocalBaseUrl(baseUrl);
    }
    try {
      const payload = buildConfigPayload({
        ...configPayloadRef.current,
        lmstudioBaseUrl: provider === "lmstudio" ? baseUrl : configPayloadRef.current.lmstudioBaseUrl,
        localBaseUrl: provider === "local" ? baseUrl : configPayloadRef.current.localBaseUrl,
      });
      await invoke("configure_agent", { config: { ...payload, preserve_state: true }, remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null });
      await restartGatewayAfterPanelUpdate();
    } catch (e) {
      console.error("Failed to update local base URL:", e);
    }
  }, [buildActiveRemoteConfig, restartGatewayAfterPanelUpdate, setLmstudioBaseUrl, setLocalBaseUrl, targetEnvironment]);

  const handlePanelProviderAuthChange = useCallback(async (targetProvider: string, auth: ProviderAuthConfig) => {
    const nextProviderAuths = mergeProviderAuth(configPayloadRef.current.providerAuths, targetProvider, auth);
    updateProviderAuth(targetProvider, auth);
    
    const isCurrentProvider = getBaseProvider(targetProvider) === getBaseProvider(configPayloadRef.current.provider);
    if (isCurrentProvider) {
      setApiKey(auth.token);
      setAuthMethod(auth.auth_method);
    }

    try {
      const payload = buildConfigPayload({
        ...configPayloadRef.current,
        providerAuths: nextProviderAuths,
        apiKey: isCurrentProvider ? auth.token : configPayloadRef.current.apiKey,
        authMethod: isCurrentProvider ? auth.auth_method : configPayloadRef.current.authMethod,
      });
      await invoke("configure_agent", { config: { ...payload, preserve_state: true }, remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null });
      await restartGatewayAfterPanelUpdate();
    } catch (e) {
      console.error("Failed to update provider auth:", e);
    }
  }, [restartGatewayAfterPanelUpdate, setApiKey, setAuthMethod, targetEnvironment, buildActiveRemoteConfig]);

  const handlePanelStartOAuth = useCallback(async (targetProvider: string, targetAuthMethod: string, oauthProviderId: string): Promise<ProviderAuthConfig> => {
    const result = await invoke<ProviderAuthConfig>("start_provider_auth", {
      provider: targetProvider,
      method: targetAuthMethod,
      oauthProviderId,
      remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null,
    });
    const nextProviderAuths = mergeProviderAuth(configPayloadRef.current.providerAuths, targetProvider, result);
    updateProviderAuth(targetProvider, result);

    const isCurrentProvider = getBaseProvider(targetProvider) === getBaseProvider(configPayloadRef.current.provider);
    if (isCurrentProvider) {
      setApiKey(result.token);
      setAuthMethod(result.auth_method);
    }

    try {
      const payload = buildConfigPayload({
        ...configPayloadRef.current,
        providerAuths: nextProviderAuths,
        apiKey: isCurrentProvider ? result.token : configPayloadRef.current.apiKey,
        authMethod: isCurrentProvider ? result.auth_method : configPayloadRef.current.authMethod,
      });
      await invoke("configure_agent", { config: { ...payload, preserve_state: true }, remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null });
      await restartGatewayAfterPanelUpdate();
    } catch (e) {
      console.error("OAuth succeeded but saving failed:", e);
    }
    return result;
  }, [targetEnvironment, buildActiveRemoteConfig, restartGatewayAfterPanelUpdate, setApiKey, setAuthMethod]);

  const handlePanelDetectLocalModels = useCallback(async (provider: "ollama" | "lmstudio" | "local", baseUrl?: string): Promise<string[]> => {
    const remote = targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null;
    if (provider === "ollama") {
      return invoke<string[]>("get_ollama_models", { remote });
    }
    return invoke<string[]>("get_lmstudio_models", {
      baseUrl: baseUrl || (provider === "lmstudio" ? "http://localhost:1234" : "http://localhost:8080"),
      remote,
    });
  }, [targetEnvironment, buildActiveRemoteConfig]);

  const [skillsSaving, setSkillsSaving] = useState(false);
  const [toolsSaving, setToolsSaving] = useState(false);

  const handlePanelSaveSkillsConfig = useCallback(async (newSkills: string[], newServiceKeys: Record<string, string>) => {
    setSkillsSaving(true);
    setSelectedSkills(newSkills);
    setServiceKeys(newServiceKeys);
    try {
      const payload = buildConfigPayload({
        ...configPayloadRef.current,
        selectedSkills: newSkills,
        serviceKeys: newServiceKeys,
      });
      await invoke("configure_agent", { config: { ...payload, preserve_state: true }, remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null });
      await restartGatewayAfterPanelUpdate();
    } catch (e) {
      console.error("Failed to save skills config:", e);
    } finally {
      setSkillsSaving(false);
    }
  }, [restartGatewayAfterPanelUpdate, setSelectedSkills, setServiceKeys]);

  const handleSaveToolPolicy = useCallback(async (newPolicy: ToolPolicy) => {
    setToolsSaving(true);
    setToolPolicy(newPolicy);
    try {
      const payload = buildConfigPayload({
        ...configPayloadRef.current,
        toolPolicy: newPolicy,
      });
      await invoke("configure_agent", { config: { ...payload, preserve_state: true }, remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null });
      await restartGatewayAfterPanelUpdate();
    } catch (e) {
      console.error("Failed to save tool policy:", e);
    } finally {
      setToolsSaving(false);
    }
  }, [restartGatewayAfterPanelUpdate, setToolPolicy]);

  const handleSaveAdvancedSettings = useCallback(async (
    newHeartbeatMode: string,
    newIdleTimeoutMs: number,
    newSandboxMode: string
  ) => {
    setLoading(true);
    setHeartbeatMode(newHeartbeatMode);
    setIdleTimeoutMs(newIdleTimeoutMs);
    setSandboxMode(newSandboxMode);
    try {
      const payload = buildConfigPayload({
        ...configPayloadRef.current,
        heartbeatMode: newHeartbeatMode,
        idleTimeoutMs: newIdleTimeoutMs,
        sandboxMode: newSandboxMode,
      });
      await invoke("configure_agent", { config: { ...payload, preserve_state: true }, remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null });
      await restartGatewayAfterPanelUpdate();
    } catch (e) {
      console.error("Failed to save advanced settings:", e);
    } finally {
      setLoading(false);
    }
  }, [restartGatewayAfterPanelUpdate, setHeartbeatMode, setIdleTimeoutMs, setSandboxMode, setLoading]);

  const handlePanelIdentitySave = useCallback(async (tab: string, content: string) => {
    const currentConfig = configPayloadRef.current;

    // Update the local state for the changed tab
    switch (tab) {
      case "identity": setIdentityMd(content); break;
      case "soul": setSoulMd(content); break;
      case "tools": setToolsMd(content); break;
      case "agents": setAgentsMd(content); break;
      case "heartbeat": setHeartbeatMd(content); break;
      case "memory": setMemoryMd(content); break;
    }
    try {
      const remote = targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null;
      if (!remote && (tab === "identity" || tab === "soul")) {
        // Local mode + identity/soul: use save_workspace_files (writes .md files directly)
        const newIdentity = tab === "identity" ? content : currentConfig.identityMd;
        const newSoul = tab === "soul" ? content : currentConfig.soulMd;
        await invoke("save_workspace_files", {
          agentId: null,
          identity: newIdentity,
          user: currentConfig.userMd,
          soul: newSoul,
        });
      } else {
        // Remote mode (all tabs) OR Local non-identity/soul: use configure_agent to persist
        const overrides: Record<string, string> = {};
        overrides[`${tab}Md`] = content;
        const payload = buildConfigPayload({ ...currentConfig, ...overrides });
        await invoke("configure_agent", { config: { ...payload, preserve_state: true }, remote });
      }
    } catch (e) {
      console.error(`Failed to save ${tab}:`, e);
    }
  }, [targetEnvironment, buildActiveRemoteConfig, setAgentsMd, setHeartbeatMd, setIdentityMd, setMemoryMd, setSoulMd, setToolsMd]);

  const handlePanelSetupIntegration = useCallback(async (skillId: string) => {
    if (!selectedSkills.includes(skillId)) {
      const newSkills = [...selectedSkills, skillId];
      await handlePanelSaveSkillsConfig(newSkills, serviceKeys);
    }
  }, [handlePanelSaveSkillsConfig, selectedSkills, serviceKeys]);

  const handlePanelAddAgent = useCallback(async (newAgent: AgentConfigData) => {
    const currentConfig = configPayloadRef.current;
    const nextAgentConfigs = [...currentConfig.agentConfigs, newAgent];

    setAgentConfigs(nextAgentConfigs);
    setEnableMultiAgent(true);
    setNumAgents(nextAgentConfigs.length);

    try {
      const payload = buildConfigPayload({
        ...currentConfig,
        agentConfigs: nextAgentConfigs,
        enableMultiAgent: true,
      });
      await invoke("configure_agent", { config: { ...payload, preserve_state: true }, remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null });
      await restartGatewayAfterPanelUpdate();
    } catch (e) {
      console.error("Failed to add agent:", e);
    }
  }, [targetEnvironment, buildActiveRemoteConfig, restartGatewayAfterPanelUpdate, setAgentConfigs, setEnableMultiAgent, setNumAgents]);

  const handlePanelRemoveAgent = useCallback(async (agentId: string) => {
    if (!agentId || agentId === "main") return;

    const currentConfig = configPayloadRef.current;
    const nextAgentConfigs = currentConfig.agentConfigs.filter((agent) => agent.id !== agentId);
    const nextEnableMultiAgent = nextAgentConfigs.length > 0;

    setAgentConfigs(nextAgentConfigs);
    setEnableMultiAgent(nextEnableMultiAgent);
    setNumAgents(nextEnableMultiAgent ? nextAgentConfigs.length : 1);
    if (activeAgentId === agentId) {
      setActiveAgentId("main");
    }

    try {
      const payload = buildConfigPayload({
        ...currentConfig,
        agentConfigs: nextAgentConfigs,
        enableMultiAgent: nextEnableMultiAgent,
      });
      await invoke("configure_agent", {
        config: { ...payload, preserve_state: true },
        remote: targetEnvironment === "cloud" ? buildActiveRemoteConfig() : null,
      });
      await restartGatewayAfterPanelUpdate();
    } catch (e) {
      console.error("Failed to remove agent:", e);
    }
  }, [
    activeAgentId,
    buildActiveRemoteConfig,
    restartGatewayAfterPanelUpdate,
    setActiveAgentId,
    setAgentConfigs,
    setEnableMultiAgent,
    setNumAgents,
    targetEnvironment,
  ]);

  const getStepStatus = (stepId: number) => {
    if (step === stepId) return "active";
    if (step > stepId) return "completed";
    return "";
  };



  const currentPayload = buildConfigPayload(configPayloadInput);
  const initialPayload = transformInitialToPayload(initialConfigRef.current);
  const hasChanges = !initialConfigRef.current || !isDeepEqual(initialPayload, currentPayload);
  const remoteSummary = targetEnvironment === "cloud"
    ? `${remoteUser || "remote-user"}@${remoteIp || "remote-host"}${tunnelActive ? " via SSH tunnel" : ""}`
    : "Running against the local OpenClaw gateway on loopback.";

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <StepMaintenance
            handleMaintenanceAction={handleMaintenanceAction}
            onRequestConfirmation={requestMaintenanceConfirmation}
            loadExistingConfig={loadExistingConfig}
            formatSshError={formatSshError}
          />
        );
      case 0.5:
        return <StepWelcome />;
      case 1:
        return <StepEnvironment handleSshCheck={handleSshCheck} checkSystem={checkSystem} checkRemoteSystem={checkRemoteSystem} />;
      case 2:
        return <StepSystemCheck installLocalNode={installLocalNode} />;
      case 3:
        return <StepSecurity />;
      case 5:
        return <StepIdentity />;
      case 6:
        return <StepAgentProfile />;
      case 6.5:
        return <StepAgentType applyAgentTypePreset={applyAgentTypePreset} />;
      case 6.7:
        return <StepConfigReview renderProviderAuthEditor={renderProviderAuthEditor} getProviderAuth={getProviderAuth} />;
      case 7:
        return <StepGateway />;
      case 8:
        return <StepConnectBrain renderProviderAuthEditor={renderProviderAuthEditor} getProviderDefaultModel={getProviderDefaultModel} getProviderModelOptions={getProviderModelOptions} />;
      case 9:
        return <StepChannels handleAdvancedTransition={handleAdvancedTransition} />;
      case 10:
        return <StepRuntime />;
      case 11:
        return <StepSkills handleInstall={handleInstall} />;
      case 11.1:
        return <StepToolAccess />;
      case 11.5:
        return <StepServiceKeys />;
      case 12:
        return <StepSecurityConfig />;
      case 13:
        return <StepModels renderProviderAuthEditor={renderProviderAuthEditor} getProviderDefaultModel={getProviderDefaultModel} getProviderModelOptions={getProviderModelOptions} />;
      case 14:
        return <StepSession />;
      case 15:
        return <StepBusinessFunctions />;
      case 15.5:
        return <StepAgentConfigLoop renderProviderAuthEditor={renderProviderAuthEditor} getProviderDefaultModel={getProviderDefaultModel} getProviderModelOptions={getProviderModelOptions} />;


      case 15.7:
        return <StepExtraSettings />;

      case 16:
        return <StepReview handleInstall={handleInstall} hasChanges={hasChanges} initialConfigRef={initialConfigRef} />;

      case 10.5:
        return <StepPersonality handleSaveWorkspace={handleSaveWorkspace} />;
      case 17:
        return <StepComplete handleToggleTunnel={handleToggleTunnel} handlePairing={handlePairing} handleAdvancedTransition={handleAdvancedTransition} runDeferredOAuthQueue={runDeferredOAuthQueue} deferredOAuthQueue={deferredOAuthQueue} onOpenWorkspace={openChatWorkspace} />;
      default:
        return null;
    }
  };

  return (
    <WizardContext.Provider value={{ state, dispatch }}>
    <div className="app-container">
      {appScreen === "loading" ? (
        <main className="main-content">
          <div className="content-wrapper">
            <div className="step-view">
              <h2>Preparing Clawnetes</h2>
              <p className="step-description">Checking your OpenClaw installation and gateway state.</p>
            </div>
          </div>
        </main>
      ) : appScreen === "chat" ? (
        <>
          <ChatShell
            bootstrap={chatBootstrap}
            bootstrapping={chatBootstrapping}
            bootstrapError={chatBootstrapError}
            onRetryConnection={() => {
              setChatBootstrap(null);
              void bootstrapGatewayChat();
            }}
            onOpenConfigure={openCommandCenter}
            returnScrollSnapshot={pendingChatReturnScrollSnapshot}
            onConsumeReturnScrollSnapshot={() => setPendingChatReturnScrollSnapshot(null)}
            environments={storedEnvironments}
            activeEnvironmentId={activeStoredEnvironmentId}
            onSwitchEnvironment={handleSwitchEnvironment}
            onAddEnvironment={handleAddEnvironment}
            onRemoveEnvironment={handleRemoveEnvironment}
            onAgentSwitch={setActiveAgentId}
            agents={agentConfigs}
            activeAgentId={activeAgentId}
            agentModelRef={model}
            agentFallbackCount={fallbackModels.length}
            agentFallbackModels={fallbackModels}
            localBaseUrl={localBaseUrl}
            lmstudioBaseUrl={lmstudioBaseUrl}
            agentSkills={selectedSkills}
            serviceKeys={serviceKeys}
            onModelChange={handlePanelModelChange}
            onFallbacksChange={handlePanelFallbacksChange}
            onLocalBaseUrlChange={handlePanelLocalBaseUrlChange}
            providerAuths={providerAuths}
            onProviderAuthChange={handlePanelProviderAuthChange}
            onStartOAuth={handlePanelStartOAuth}
            onDetectLocalModels={handlePanelDetectLocalModels}
            onSaveSkillsConfig={handlePanelSaveSkillsConfig}
            skillsSaving={skillsSaving}
            onSetupIntegration={handlePanelSetupIntegration}
            identityMd={identityMd}
            soulMd={soulMd}
            toolsMd={toolsMd}
            agentsMd={agentsMd}
            heartbeatMd={heartbeatMd}
            memoryMd={memoryMd}
            onIdentitySave={handlePanelIdentitySave}
            identitySaving={savingWorkspace}
            onAddAgent={handlePanelAddAgent}
            onRemoveAgent={handlePanelRemoveAgent}
            isConfigUpdating={configUpdating}
            targetEnvironment={targetEnvironment}
            remoteSummary={remoteSummary}
            gatewayPort={gatewayPort}
            gatewayBind={gatewayBind}
            gatewayAuthMode={gatewayAuthMode}
            heartbeatMode={heartbeatMode}
            sandboxMode={sandboxMode}
            toolPolicy={toolPolicy}
            toolsSaving={loading}
            settingsBusy={loading}
            idleTimeoutMs={idleTimeoutMs}
            onSaveToolPolicy={handleSaveToolPolicy}
            onSaveAdvancedSettings={handleSaveAdvancedSettings}
            maintenanceStatus={maintenanceStatus}
            onRepair={() => void handleDrawerMaintenanceAction("repair")}
            onAudit={() => void handleDrawerMaintenanceAction("audit")}
            onUpgrade={() => void handleDrawerMaintenanceAction("update")}
            onReconfigure={() => void handleReconfigureFromDrawer()}
            onUninstall={() => void handleDrawerMaintenanceAction("uninstall")}
          />
        </>
      ) : appScreen === "command-center" ? (
        <ConfigureDrawer
            busy={loading}
            maintenanceStatus={maintenanceStatus}
            logs={logs}
            targetEnvironment={targetEnvironment}
            remoteSummary={remoteSummary}
            onClose={openChatWorkspace}
            onRepair={() => void handleDrawerMaintenanceAction("repair")}
            onAudit={() => void handleDrawerMaintenanceAction("audit")}
            onUpgrade={() => void handleDrawerMaintenanceAction("update")}
            onReconfigure={() => void handleReconfigureFromDrawer()}
            onUninstall={() => void handleDrawerMaintenanceAction("uninstall")}
          />
      ) : (
        <>
          <div className="top-bar">
            {addingEnvFromChat && (
              <button
                className="secondary"
                onClick={handleBackToChat}
                style={{ position: "absolute", left: "0.75rem", display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem", padding: "0.3rem 0.6rem" }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="11" y1="7" x2="3" y2="7" /><polyline points="6,4 3,7 6,10" />
                </svg>
                Back to chat
              </button>
            )}
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
        </>
      )}

      {showLicenseModal && (
        <div className="modal-overlay" style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.7)", zIndex: 1000,
          display: "flex", justifyContent: "center", alignItems: "center"
        }}>
          <div className="modal-content" style={{
            backgroundColor: "var(--bg-card)", padding: "2rem", borderRadius: "12px",
            width: "400px", maxWidth: "90%", border: "1px solid var(--border)"
          }}>
            <h3 style={{ marginTop: 0 }}>Advanced Setup License</h3>
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
              Advanced features require a license key. You can purchase one from Gumroad.
            </p>

            <div className="form-group" style={{ marginTop: "1.5rem" }}>
              <label>License Key</label>
              <input
                {...TEXT_ENTRY_PROPS}
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                autoFocus
              />
            </div>

            <div style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); openExternal("https://aimodelscompass.gumroad.com/l/clawnetes-license"); }}
                style={{ color: "var(--primary)" }}
              >
                Get a license key &rarr;
              </a>
            </div>

            {licenseError && (
              <div className="error" style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--error)" }}>
                {licenseError}
              </div>
            )}

            <div className="button-group" style={{ marginTop: "2rem" }}>
              <button
                className="primary"
                disabled={!licenseKey.trim() || verifyingLicense}
                onClick={async () => {
                  setVerifyingLicense(true);
                  setLicenseError("");
                  try {
                    await invoke("verify_and_store_license", { key: licenseKey.trim() });
                    setLicenseUnlocked(true);
                    setLicenseStatusError("");
                    setShowLicenseModal(false);
                    setVerifyingLicense(false);
                    await continueToAdvancedSettings();
                  } catch (e) {
                    setVerifyingLicense(false);
                    setLicenseError(String(e));
                  }
                }}
              >
                {verifyingLicense ? "Verifying..." : "Verify & Continue"}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setShowLicenseModal(false);
                  setLicenseError("");
                }}
                disabled={verifyingLicense}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingMaintenanceConfirm && (
        <div className="modal-overlay">
          <div className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="maintenance-confirm-title">
            <h3 id="maintenance-confirm-title" style={{ marginTop: 0 }}>
              {pendingMaintenanceConfirm === "repair"
                ? "Repair System"
                : pendingMaintenanceConfirm === "audit"
                  ? "Security Audit"
                  : pendingMaintenanceConfirm === "update"
                    ? "Upgrade OpenClaw"
                    : "Uninstall OpenClaw"}
            </h3>
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
              {pendingMaintenanceConfirm === "repair"
                ? "Run OpenClaw system repair now?"
                : pendingMaintenanceConfirm === "audit"
                  ? "Run OpenClaw security audit and apply fixes now?"
                  : pendingMaintenanceConfirm === "update"
                    ? "Upgrade OpenClaw now?"
                    : "Are you absolutely sure you want to completely remove OpenClaw and all its data?"}
            </p>
            <div className="button-group" style={{ marginTop: "1.5rem" }}>
              <button className="primary" onClick={() => void confirmMaintenanceAction()} disabled={loading} type="button">
                Yes
              </button>
              <button className="secondary" onClick={closeMaintenanceConfirmation} disabled={loading} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </WizardContext.Provider>
  );
}

export default App;
