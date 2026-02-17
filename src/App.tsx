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
import RadioCard from "./components/RadioCard";
import type { AgentTypeId, AgentConfigData, BusinessFunctionId, CronJobConfig } from "./types";

function App() {
  const handleAdvancedTransition = async () => {
    // Check if we already verified license in this session
    if (maintCompleted) {
       setStep(7);
       return;
    }
    setShowLicenseModal(true);
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

  // License
  const [showLicenseModal, setShowLicenseModal] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");
  const [verifyingLicense, setVerifyingLicense] = useState(false);
  const [licenseError, setLicenseError] = useState("");

  // Service Keys State
  const [serviceKeys, setServiceKeys] = useState<Record<string, string>>({});
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
  const [toolsMode, setToolsMode] = useState("allowlist");
  const [allowedTools, setAllowedTools] = useState<string[]>(["filesystem", "terminal", "browser"]);
  const [deniedTools, setDeniedTools] = useState<string[]>([]);

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

  // NEW: Multi-Agent (Step 15)
  const [enableMultiAgent, setEnableMultiAgent] = useState(false);
  const [numAgents, setNumAgents] = useState(1);
  const [agentConfigs, setAgentConfigs] = useState<Array<{
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
    persona?: string;
  }>>([]);
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
  const [theme, setTheme] = useState("light");

  const availableSkills = AVAILABLE_SKILLS;

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
    setToolsMode(preset.toolsMode);
    setAllowedTools(preset.allowedTools);

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
    { id: 7, name: "Gateway", advanced: true },
    { id: 8, name: "Brain", hidden: isPresetAgent },
    { id: 9, name: "Channels" },
    { id: 10, name: "Runtime", advanced: true },
    { id: 10.5, name: "Workspace", advanced: true },
    { id: 11, name: "Skills", advanced: true, hidden: isPresetAgent },
    { id: 12, name: "Security+", advanced: true, hidden: isPresetAgent },
    { id: 13, name: "Models", advanced: true, hidden: isPresetAgent },
    { id: 14, name: "Session", advanced: true, hidden: isPresetAgent },
    { id: 15, name: "Functions", advanced: true },
    { id: 15.5, name: "Agents", advanced: true, hidden: true },
    { id: 16, name: "Review" },
    { id: 17, name: "Pairing" }
  ];

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
        } catch(e) { console.error("Failed to check pairing status:", e); }
      };
      checkPairing();
    }
  }, [step]);

  useEffect(() => {
    if (theme === "light") {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
    }
  }, [theme]);

  // Update default auth method when provider changes
  useEffect(() => {
    if (provider === "anthropic") setAuthMethod("token");
    else if (provider === "google") setAuthMethod("token");
    else if (provider === "openai") setAuthMethod("token");
    else setAuthMethod("token");
  }, [provider]);

  // Workspace change detection
  useEffect(() => {
    const modified =
      identityMd !== initialWorkspace.identity ||
      userMd !== initialWorkspace.user ||
      soulMd !== initialWorkspace.soul;
    setWorkspaceModified(modified);
  }, [identityMd, userMd, soulMd, initialWorkspace]);

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

  // Helper to transform the loaded config (from get_current_config) 
  // into the structure expected by configure_agent, for comparison.
  function transformInitialToPayload(initial: any) {
    if (!initial) return null;
    const defaultIdentity = `# IDENTITY.md - Who Am I?
- **Name:** ${initial.agent_name}
- **Emoji:** ${initial.agent_emoji || "🦞"}
---
Managed by ClawSetup.`;

    const mappedSandboxMode = initial.sandbox_mode === "full" ? "all" : (initial.sandbox_mode === "partial" ? "non-main" : (initial.sandbox_mode === "none" ? "off" : initial.sandbox_mode));

    return {
      provider: initial.provider,
      api_key: initial.api_key,
      auth_method: initial.auth_method,
      model: initial.model,
      user_name: initial.user_name,
      agent_name: initial.agent_name,
      agent_vibe: initial.agent_vibe || "",
      telegram_token: initial.telegram_token || "",
      gateway_port: initial.gateway_port,
      gateway_bind: initial.gateway_bind,
      gateway_auth_mode: initial.gateway_auth_mode,
      tailscale_mode: initial.tailscale_mode,
      node_manager: initial.node_manager,
      skills: initial.skills || [],
      service_keys: initial.service_keys || {},
      sandbox_mode: mappedSandboxMode,
      tools_mode: initial.tools_mode,
      allowed_tools: initial.tools_mode === "allowlist" ? (initial.allowed_tools || []) : null,
      denied_tools: initial.tools_mode === "denylist" ? (initial.denied_tools || []) : null,
      fallback_models: (initial.fallback_models && initial.fallback_models.length > 0) ? initial.fallback_models : null,
      heartbeat_mode: initial.heartbeat_mode,
      idle_timeout_ms: initial.heartbeat_mode === "idle" ? initial.idle_timeout_ms : null,
      identity_md: initial.identity_md || defaultIdentity,
      user_md: initial.user_md || null,
      soul_md: initial.soul_md || null,
      agents: initial.enable_multi_agent && initial.agent_configs ? initial.agent_configs.map((a: any) => ({
        id: a.id,
        name: a.name,
        model: a.model,
        fallback_models: (a.fallback_models && a.fallback_models.length > 0) ? a.fallback_models : null,
        skills: (a.skills && a.skills.length > 0) ? a.skills : null,
        vibe: a.vibe || "",
        identity_md: a.identity_md || `# IDENTITY.md - Who Am I?
- **Name:** ${a.name}
- **Emoji:** ${a.emoji || "🦞"}
---
Managed by ClawSetup.`,
        user_md: a.user_md || null,
        soul_md: a.soul_md || null
      })) : null,
      preserve_state: isPaired,
      agent_type: initial.agent_type || "custom",
      tools_md: initial.tools_md || null,
      agents_md: initial.agents_md || null,
      heartbeat_md: initial.heartbeat_md || null,
      memory_md: initial.memory_md || null,
      memory_enabled: initial.memory_enabled || false,
      cron_jobs: initial.cron_jobs || null,
    };
  }

  function constructConfigPayload() {
    const mappedSandboxMode = sandboxMode === "full" ? "all" : (sandboxMode === "partial" ? "non-main" : "off");
    const defaultIdentity = `# IDENTITY.md - Who Am I?
- **Name:** ${agentName}
- **Emoji:** ${agentEmoji}
---
Managed by ClawSetup.`;

    // For preset agents, always include preset-configured fields
    const usePresetFields = isPresetAgent || mode === "advanced";

    return {
        provider,
        api_key: apiKey,
        auth_method: authMethod,
        model,
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
        sandbox_mode: usePresetFields ? mappedSandboxMode : null,
        tools_mode: usePresetFields ? toolsMode : null,
        allowed_tools: usePresetFields && toolsMode === "allowlist" ? allowedTools : null,
        denied_tools: usePresetFields && toolsMode === "denylist" ? deniedTools : null,
        fallback_models: usePresetFields && enableFallbacks ? fallbackModels.filter(m => m) : null,
        heartbeat_mode: usePresetFields ? heartbeatMode : null,
        idle_timeout_ms: usePresetFields && heartbeatMode === "idle" ? idleTimeoutMs : null,
        identity_md: (usePresetFields && identityMd) ? identityMd : defaultIdentity,
        user_md: usePresetFields && userMd ? userMd : null,
        soul_md: usePresetFields && soulMd ? soulMd : null,
        agents: enableMultiAgent ? agentConfigs.map(a => ({
          id: a.id,
          name: a.name,
          model: a.model,
          fallback_models: a.fallbackModels.length > 0 ? a.fallbackModels : null,
          skills: a.skills.length > 0 ? a.skills : null,
          vibe: a.vibe,
          identity_md: a.identityMd || `# IDENTITY.md - Who Am I?
- **Name:** ${a.name}
- **Emoji:** ${a.emoji || "🦞"}
---
Managed by ClawSetup.`,
          user_md: a.userMd || null,
          soul_md: a.soulMd || null
        })) : null,
        preserve_state: isPaired,
        // New preset fields
        agent_type: agentType,
        tools_md: usePresetFields && toolsMd ? toolsMd : null,
        agents_md: usePresetFields && agentsMd ? agentsMd : null,
        heartbeat_md: usePresetFields && heartbeatMd ? heartbeatMd : null,
        memory_md: usePresetFields && memoryMd ? memoryMd : null,
        memory_enabled: usePresetFields ? memoryEnabled : false,
        cron_jobs: cronJobs.length > 0 ? cronJobs : null,
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
    // Ensure we preserve state if we found it was paired
    configPayload.preserve_state = actualIsPaired;

    if (initialConfigRef.current) {
        const initialPayload = transformInitialToPayload(initialConfigRef.current);
        if (isDeepEqual(initialPayload, configPayload)) {
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
        setProgress("Installing OpenClaw (this may take a minute)...");
        setLogs("Installing OpenClaw (this may take a minute)...");
        if (!checks.openclaw) {
          await invoke("install_openclaw");
          const version: string = await invoke("get_openclaw_version");
          setOpenClawVersion(version);
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

        setProgress("Starting Gateway (this may take 20-30 seconds)...");
        setLogs("Starting Gateway...");
        await invoke("start_gateway");

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
      
      // Populate state
      setProvider(config.provider);
      setApiKey(config.api_key);
      setAuthMethod(config.auth_method);
      setModel(config.model);
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
      
      setSelectedSkills(config.skills);
      // Service keys might be partial, merge them?
      setServiceKeys(config.service_keys);
      
      setSandboxMode(config.sandbox_mode);
      setToolsMode(config.tools_mode);
      setAllowedTools(config.allowed_tools);
      setDeniedTools(config.denied_tools);
      
      setFallbackModels(config.fallback_models);
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

      setEnableMultiAgent(config.enable_multi_agent);
      if (config.enable_multi_agent && config.agent_configs) {
          setNumAgents(config.agent_configs.length);
          setAgentConfigs(config.agent_configs.map((a: any) => ({
              id: a.id,
              name: a.name,
              model: a.model,
              fallbackModels: a.fallback_models || [],
              skills: a.skills || [],
              vibe: a.vibe,
              emoji: a.emoji || "🦞",
              identityMd: a.identity_md || "",
              userMd: a.user_md || "",
              soulMd: a.soul_md || ""
          })));
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
            <div className="button-group" style={{gap: "10px", marginBottom: "2rem"}}>
              <button
                className="primary"
                style={{flex: 1}}
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
                  style={{flex: 1}}
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
            <h3 style={{marginBottom: "1rem"}}>Maintenance Options</h3>
            <div className="mode-card-container" style={{gridTemplateColumns: "1fr", gap: "1rem"}}>
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
                style={selectedMaint === "uninstall" ? {borderColor: "var(--error)", backgroundColor: "rgba(239, 68, 68, 0.05)"} : {}}
                onClick={() => !loading && setSelectedMaint("uninstall")}
              >
                <h3 style={selectedMaint === "uninstall" ? {color: "var(--error)"} : {}}>🗑 Uninstall Completely</h3>
                <p>Remove the OpenClaw CLI and all {targetEnvironment === "local" ? "local" : "remote"} configuration/data files.</p>
              </div>
            </div>

            {!loading && (
              <div className="button-group" style={{gap: "10px", marginTop: "1.5rem"}}>
                <button
                  className="primary"
                  style={{flex: 1}}
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
                  <button className="secondary" style={{flex: 1}} onClick={() => invoke("close_app")}>Exit Setup</button>
                )}
              </div>
            )}

            {maintenanceStatus && (
              <div className="progress-container" style={{marginTop: "2rem"}}>
                <p style={{fontSize: "0.9rem", color: maintenanceStatus.includes("❌") ? "var(--error)" : maintenanceStatus.includes("✅") ? "var(--success)" : "var(--primary)"}}>{maintenanceStatus}</p>
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
            <h1 className="welcome-title">Welcome to ClawSetup</h1>
            <p className="welcome-text">
              The fastest way to deploy your AI agent. Get started in minutes.
            </p>
            <div className="button-group" style={{justifyContent: "center"}}>
              <button 
                className="primary" 
                style={{minWidth: "200px", padding: "1rem 2rem", fontSize: "1.1rem"}}
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
              <div className="remote-config" style={{marginTop: "2rem"}}>
                <h3 style={{marginBottom: "1rem"}}>SSH Configuration</h3>
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
                  <div style={{display: "flex", gap: "0.5rem"}}>
                    <input
                      placeholder="/Users/you/.ssh/id_rsa"
                      value={remotePrivateKeyPath}
                      onChange={(e) => setRemotePrivateKeyPath(e.target.value)}
                      style={{flex: 1}}
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
                  style={{width: "100%", marginTop: "1rem"}}
                >
                  {sshStatus === "checking" ? "Testing..." : "Test Connection"}
                </button>

                {sshStatus === "success" && (
                  <div style={{marginTop: "1rem", padding: "0.75rem", backgroundColor: "rgba(34, 197, 94, 0.1)", borderRadius: "8px", border: "1px solid rgba(34, 197, 94, 0.3)"}}>
                    <strong style={{color: "rgb(34, 197, 94)"}}>✅ Success:</strong> <span style={{color: "var(--text)"}}>SSH connection established successfully!</span>
                  </div>
                )}

                {sshError && (
                  <div className="error" style={{marginTop: "1rem", padding: "0.75rem", backgroundColor: "rgba(239, 68, 68, 0.1)", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.3)"}}>
                    <strong style={{color: "rgb(239, 68, 68)"}}>❌ Error:</strong> <span style={{color: "var(--text)"}}>{sshError}</span>
                  </div>
                )}
              </div>
            )}

            <div className="button-group" style={{marginTop: "2rem"}}>
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
              <div className="error" style={{marginTop: "1rem", color: "var(--error)"}}>
                <p>Node.js is required.</p>
                {targetEnvironment === "local" && (
                   <div style={{display: "flex", gap: "10px", alignItems: "center", marginTop: "5px"}}>
                     <button
                       className="secondary small"
                       onClick={installLocalNode}
                       disabled={installingNode}
                       style={{padding: "4px 10px", fontSize: "0.8rem", cursor: "pointer"}}
                     >
                       {installingNode ? "Installing..." : "Install Now"}
                     </button>
                     {nodeInstallError && <span style={{fontSize: "0.8rem"}}>{nodeInstallError}</span>}
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
            <p style={{fontWeight: 600}}>Do you understand the risks and wish to continue?</p>
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
              <div className="emoji-grid" style={{display: "flex", gap: "0.5rem", flexWrap: "wrap"}}>
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
                      background: agentEmoji === e ? "rgba(255, 75, 43, 0.1)" : "var(--bg-card)",
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
            <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem"}}>
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
                    backgroundColor: agentType === t.id ? "rgba(255, 75, 43, 0.05)" : "var(--bg-card)",
                    cursor: "pointer",
                    textAlign: "center"
                  }}
                >
                  <div style={{fontSize: "2rem", marginBottom: "0.5rem"}}>{t.emoji}</div>
                  <div style={{fontWeight: 600, marginBottom: "0.25rem"}}>{t.name}</div>
                  <div style={{fontSize: "0.8rem", color: "var(--text-muted)"}}>{t.desc}</div>
                </div>
              ))}
            </div>
            <div className="button-group" style={{marginTop: "1.5rem"}}>
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
              <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.5rem"}}>
                <div className="status-card" style={{padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)"}}>
                  <div style={{fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem"}}>Model</div>
                  <div style={{fontWeight: 600, fontSize: "0.9rem"}}>{presetData.model.split("/").pop()}</div>
                </div>
                <div className="status-card" style={{padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)"}}>
                  <div style={{fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem"}}>Fallback</div>
                  <div style={{fontWeight: 600, fontSize: "0.9rem"}}>{presetData.fallbackModels[0]?.split("/").pop() || "None"}</div>
                </div>
                <div className="status-card" style={{padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)"}}>
                  <div style={{fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem"}}>Skills</div>
                  <div style={{fontWeight: 600, fontSize: "0.9rem"}}>{presetData.skills.length} configured</div>
                </div>
                <div className="status-card" style={{padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)"}}>
                  <div style={{fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem"}}>Heartbeat</div>
                  <div style={{fontWeight: 600, fontSize: "0.9rem"}}>{presetData.heartbeatMode === "never" ? "Disabled" : `Every ${presetData.heartbeatMode}`}</div>
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Skills Included</label>
              <div style={{display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem"}}>
                {selectedSkills.map(s => (
                  <span key={s} style={{
                    padding: "0.25rem 0.75rem",
                    borderRadius: "20px",
                    backgroundColor: "rgba(255, 75, 43, 0.1)",
                    border: "1px solid var(--primary)",
                    fontSize: "0.8rem",
                    fontWeight: 500
                  }}>
                    {SKILL_ICONS[s] && <img src={SKILL_ICONS[s]} alt="" style={{width: "14px", height: "14px", marginRight: "4px", verticalAlign: "middle", borderRadius: "3px"}} />}
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>AI Provider API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${provider} API key`}
                autoComplete="off"
              />
              <p className="input-hint" style={{marginTop: "0.25rem", fontSize: "0.8rem"}}>
                Required for {provider}. Get one from the provider's dashboard.
              </p>
            </div>

            {/* Show auth keys for skills that require them */}
            {selectedSkills.filter(s => {
              const skill = availableSkills.find(sk => sk.id === s);
              return skill?.requiresAuth;
            }).length > 0 && (
              <div className="form-group" style={{marginTop: "1rem"}}>
                <label>Skill API Keys (Optional)</label>
                {selectedSkills.filter(s => {
                  const skill = availableSkills.find(sk => sk.id === s);
                  return skill?.requiresAuth;
                }).map(s => {
                  const skill = availableSkills.find(sk => sk.id === s)!;
                  return (
                    <div key={s} style={{marginTop: "0.5rem"}}>
                      <label style={{fontSize: "0.85rem", color: "var(--text-muted)"}}>{skill.name}</label>
                      <input
                        type="password"
                        value={serviceKeys[s] || ""}
                        onChange={(e) => setServiceKeys({...serviceKeys, [s]: e.target.value})}
                        placeholder={skill.authPlaceholder || "API Key"}
                        autoComplete="off"
                      />
                    </div>
                  );
                })}
              </div>
            )}

            <div className="button-group" style={{marginTop: "1.5rem"}}>
              <button className="primary" disabled={!apiKey} onClick={() => setStep(9)}>Next</button>
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
              <RadioCard
                value={gatewayBind}
                onChange={setGatewayBind}
                columns={2}
                options={[
                  { value: "loopback", label: "Loopback (127.0.0.1)", description: "Only accessible from this machine" },
                  { value: "all", label: "All Interfaces (0.0.0.0)", description: "Accessible from local network" }
                ]}
              />
            </div>
            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Auth Mode</label>
              <RadioCard
                value={gatewayAuthMode}
                onChange={setGatewayAuthMode}
                columns={2}
                options={[
                  { value: "token", label: "Token (Secure)", description: "Requires authentication token" },
                  { value: "none", label: "None (Insecure)", description: "No authentication required" }
                ]}
              />
            </div>
            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Tailscale</label>
              <RadioCard
                value={tailscaleMode}
                onChange={setTailscaleMode}
                columns={2}
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
              <div style={{maxHeight: "300px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem"}}>
                <RadioCard
                  value={provider}
                  onChange={(p) => {
                    setProvider(p);
                    if (DEFAULT_MODELS[p]) {
                      setModel(DEFAULT_MODELS[p]);
                    } else if (MODELS_BY_PROVIDER[p] && MODELS_BY_PROVIDER[p].length > 0) {
                      setModel(MODELS_BY_PROVIDER[p][0].value);
                    }
                  }}
                  columns={2}
                  options={[
                    // Core providers
                    { value: "anthropic", label: "Anthropic", icon: PROVIDER_LOGOS["anthropic"] },
                    { value: "openai", label: "OpenAI", icon: PROVIDER_LOGOS["openai"] },
                    { value: "google", label: "Google Gemini", icon: PROVIDER_LOGOS["google"] },
                    { value: "google-vertex", label: "Google Vertex AI", icon: PROVIDER_LOGOS["google-vertex"] },
                    { value: "openrouter", label: "OpenRouter", icon: PROVIDER_LOGOS["openrouter"] },
                    { value: "xai", label: "xAI (Grok)", icon: PROVIDER_LOGOS["xai"] },
                  ]}
                />
              </div>
            </div>
            
            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Auth Method</label>
              <RadioCard
                value={authMethod}
                onChange={setAuthMethod}
                columns={1}
                options={[
                  ...(provider === "anthropic" ? [
                    { value: "token", label: "Anthropic API Key", description: "Standard API Key starting with sk-ant-..." },
                    { value: "setup-token", label: "Anthropic Token (from setup-token)", description: "Temporary token from CLI setup" }
                  ] : []),
                  ...(provider === "google" ? [
                    { value: "token", label: "Google Gemini API Key", description: "Standard API Key" }
                  ] : []),
                  ...(provider === "openai" ? [
                    { value: "token", label: "OpenAI API Key", description: "Standard API Key starting with sk-..." }
                  ] : []),
                  ...(!["anthropic", "google", "openai"].includes(provider) ? [
                     { value: "token", label: "API Key (Standard)", description: "Standard API Key for this provider" }
                  ] : [])
                ]}
              />
            </div>

            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Primary Model</label>
              {MODELS_BY_PROVIDER[provider] ? (
                 <div style={{maxHeight: "300px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem"}}>
                   <RadioCard
                     value={model}
                     onChange={setModel}
                     columns={1}
                     options={MODELS_BY_PROVIDER[provider].map(m => ({ value: m.value, label: m.label, description: m.description }))}
                   />
                 </div>
              ) : (
                <RadioCard
                   value={model}
                   onChange={setModel}
                   columns={1}
                   options={provider === "ollama" ? [
                     { value: "ollama/llama3.1", label: "Llama 3.1 (Local)" },
                     { value: "ollama/deepseek-r1", label: "DeepSeek R1 (Local)" }
                   ] : [
                     { value: model, label: model }
                   ]}
                />
              )}
            </div>

              <div className="form-group" style={{marginTop: "1.5rem"}}>
                <label>{authMethod === "setup-token" ? "Anthropic Setup Token" : "API Key"}</label>
                <input 
                  type="password" 
                  placeholder="Paste here..." 
                  value={apiKey} 
                  onChange={(e) => setApiKey(e.target.value)} 
                />
                {authMethod === "setup-token" && (
                  <p className="input-hint">
                    Run <code>claude setup-token</code> in your terminal and paste the result here.
                  </p>
                )}
              </div>

            
            <p className="input-hint" style={{marginBottom: "1rem", textAlign: "center"}}>
              You can skip this for now and configure it later via 'Reconfigure'.
            </p>
            <div className="button-group">
              <button className="primary" onClick={() => setStep(9)}>Next</button>
              <button className="secondary" onClick={() => setStep(mode === "advanced" ? 7 : 6)}>Back</button>
            </div>
          </div>
        );
      case 9:
        return (
          <div className="step-view">
            <h2>Messaging Channels</h2>
            <p className="step-description">Connect your agent to Telegram for easy access.</p>
            <div className="form-group">
              <label>Telegram Bot Token</label>
              <input type="password" placeholder="123456:ABC-..." value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} />
              <p className="input-hint">Get one from @BotFather on Telegram.</p>
            </div>
            
            <div className="button-group">
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
              <RadioCard
                value={nodeManager}
                onChange={setNodeManager}
                columns={3}
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
            <h2>Select Skills</h2>
            <p className="step-description">Enable capabilities and configure required keys.</p>
            <div className="skills-container" style={{maxHeight: "450px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem"}}>
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
                    <div className="skill-header" style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start"}}>
                      <div style={{display: "flex", alignItems: "center"}}>
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
                        <div className="skill-name" style={{fontWeight: 700}}>{skill.name}</div>
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
                    <div className="skill-desc" style={{fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: "1.4"}}>{skill.desc}</div>
                    
                    {skill.requiresAuth && selectedSkills.includes(skill.id) && (
                      <div className="skill-auth" style={{marginTop: "auto", paddingTop: "0.5rem"}}>
                        <input
                          type="password"
                          placeholder={skill.authPlaceholder || "API Key"}
                          value={serviceKeys[skill.id] || ""}
                          onChange={(e) => setServiceKeys({...serviceKeys, [skill.id]: e.target.value})}
                          onClick={(e) => e.stopPropagation()}
                          style={{width: "100%", fontSize: "0.8rem", padding: "0.5rem", borderRadius: "8px"}}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{marginTop: "1.5rem"}}>
              <button className="secondary" onClick={() => setShowCustomSkillForm(!showCustomSkillForm)}>
                {showCustomSkillForm ? "Hide" : "+ Add"} Custom Skill
              </button>
            </div>

            {showCustomSkillForm && (
              <div className="custom-skill-form" style={{marginTop: "1.5rem"}}>
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
                // Skip Step 11.5 as auth is handled inline
                if (mode === "advanced") {
                  setStep(12);
                } else {
                  handleInstall();
                }
              }}>Continue</button>
              <button className="secondary" onClick={() => setStep(10.5)}>Back</button>
            </div>
          </div>
        );
      case 11.5:
        return (
          <div className="step-view">
            <h2>Service Key: {servicesToConfigure[currentServiceIdx].name}</h2>
            <p className="step-description">Would you like to provide a key for this optional service now?</p>
            
            <div style={{marginBottom: "2rem"}}>
              <RadioCard
                value={isConfiguringService === true ? "yes" : "no"}
                onChange={(val) => setIsConfiguringService(val === "yes")}
                columns={2}
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
                  onChange={(e) => setServiceKeys({...serviceKeys, [servicesToConfigure[currentServiceIdx].id]: e.target.value})} 
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
              <RadioCard
                value={sandboxMode}
                onChange={setSandboxMode}
                columns={1}
                options={[
                  { value: "full", label: "Full Sandbox", description: "REQUIRES DOCKER! Select only if Docker is installed, otherwise this will break." },
                  { value: "partial", label: "Partial Sandbox", description: "Standard isolation." },
                  { value: "none", label: "No Sandbox", description: "Unrestricted access." }
                ]}
              />
            </div>

            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Tools Policy</label>
              <RadioCard
                value={toolsMode}
                onChange={setToolsMode}
                columns={1}
                options={[
                  { value: "allowlist", label: "Allowlist (Recommended)", description: "Only enable explicitly selected tools." },
                  { value: "denylist", label: "Denylist", description: "Block specific tools." },
                  { value: "all", label: "All Tools", description: "Enable all available tools." }
                ]}
              />
            </div>

            {toolsMode === "allowlist" && (
              <div className="form-group">
                <label>Allowed Tools</label>
                <div className="skills-grid">
                  {[
                    {id: "filesystem", name: "File System"},
                    {id: "terminal", name: "Terminal"},
                    {id: "browser", name: "Browser"},
                    {id: "network", name: "Network"}
                  ].map(tool => (
                    <div
                      key={tool.id}
                      className={`skill-card ${allowedTools.includes(tool.id) ? "active" : ""}`}
                      onClick={() => {
                        setAllowedTools(prev =>
                          prev.includes(tool.id)
                            ? prev.filter(t => t !== tool.id)
                            : [...prev, tool.id]
                        );
                      }}
                    >
                      <div className="skill-name">{tool.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => setStep(13)}>Continue</button>
              <button className="secondary" onClick={() => setStep(11.5)}>Back</button>
            </div>
          </div>
        );
      case 13:
        return (
          <div className="step-view">
            <h2>Model Configuration</h2>
            <p className="step-description">Configure your primary and fallback models.</p>

            <div className="form-group" style={{marginBottom: "1.5rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px"}}>
              <label>Primary Model</label>
              <p className="step-description" style={{fontSize: "0.85rem", marginBottom: "0.75rem"}}>Change the primary model used by your agent.</p>

              <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Provider</label>
              <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                <RadioCard
                  value={provider}
                  onChange={(p) => {
                    setProvider(p);
                    if (DEFAULT_MODELS[p]) {
                      setModel(DEFAULT_MODELS[p]);
                    } else if (MODELS_BY_PROVIDER[p] && MODELS_BY_PROVIDER[p].length > 0) {
                      setModel(MODELS_BY_PROVIDER[p][0].value);
                    }
                  }}
                  columns={2}
                  options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                    value: p,
                    label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                    icon: PROVIDER_LOGOS[p]
                  }))}
                />
              </div>

              {MODELS_BY_PROVIDER[provider] && (
                <>
                  <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Model</label>
                  <div style={{maxHeight: "250px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem"}}>
                    <RadioCard
                      value={model}
                      onChange={setModel}
                      columns={1}
                      options={MODELS_BY_PROVIDER[provider].map(m => ({ value: m.value, label: m.label, description: m.description }))}
                    />
                  </div>
                </>
              )}
            </div>

            <h3 style={{marginTop: "1.5rem", marginBottom: "0.5rem"}}>Fallback Models</h3>
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
                  const currentProvider = currentModel.split('/')[0];
                  const needsAuth = currentProvider && currentProvider !== provider && !serviceKeys[currentProvider];
                  
                  return (
                    <div key={idx} className="form-group" style={{marginTop: "1.5rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px"}}>
                      <label>Fallback Model {idx + 1} {idx === 1 && "(Optional)"}</label>
                      
                      {/* Provider Selection */}
                      <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Provider</label>
                      <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                        <RadioCard
                          value={currentProvider || ""}
                          onChange={(newProv) => {
                            if (!newProv) return;
                            // Set default model for this provider
                            const newModels = [...fallbackModels];
                            if (DEFAULT_MODELS[newProv]) {
                              newModels[idx] = DEFAULT_MODELS[newProv];
                            } else if (MODELS_BY_PROVIDER[newProv] && MODELS_BY_PROVIDER[newProv].length > 0) {
                              newModels[idx] = MODELS_BY_PROVIDER[newProv][0].value;
                            }
                            setFallbackModels(newModels);
                          }}
                          columns={2}
                          options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                            value: p,
                            label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                            icon: PROVIDER_LOGOS[p]
                          }))}
                        />
                      </div>

                      {/* Model Selection */}
                      {currentProvider && MODELS_BY_PROVIDER[currentProvider] && (
                        <>
                          <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Model</label>
                          <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                            <RadioCard
                              value={currentModel}
                              onChange={(val) => {
                                const newModels = [...fallbackModels];
                                newModels[idx] = val;
                                setFallbackModels(newModels);
                              }}
                              columns={1}
                              options={MODELS_BY_PROVIDER[currentProvider].map(m => ({ value: m.value, label: m.label }))}
                            />
                          </div>
                        </>
                      )}

                      {/* Auth Selection */}
                      {currentModel && currentProvider && currentProvider !== provider && !["ollama"].includes(currentProvider) && (
                        <div style={{marginTop: "0.5rem"}}>
                          <label style={{fontSize: "0.85rem", color: "var(--text-muted)"}}>API Key for {currentProvider}</label>
                          <input
                            type="password"
                            placeholder={`API Key for ${currentProvider}`}
                            value={serviceKeys[currentProvider] || ""}
                            onChange={(e) => setServiceKeys({...serviceKeys, [currentProvider]: e.target.value})}
                            autoComplete="off"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => setStep(14)}>Continue</button>
              <button className="secondary" onClick={() => setStep(12)}>Back</button>
            </div>
          </div>
        );
      case 14:
        return (
          <div className="step-view">
            <h2>Session Management</h2>
            <p className="step-description">Control when the agent resets context to save costs.</p>

            <div className="mode-card-container" style={{gridTemplateColumns: "1fr 1fr"}}>
              {[
                {mode: "1h", label: "Hourly", desc: "Reset every hour"},
                {mode: "4h", label: "4 Hours", desc: "Reset every 4 hours"},
                {mode: "24h", label: "Daily", desc: "Reset once per day"},
                {mode: "idle", label: "Idle Timeout", desc: "Reset after inactivity"},
                {mode: "never", label: "Never", desc: "Manual reset only"}
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
              <div className="form-group" style={{marginTop: "1.5rem"}}>
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
            <h2>Business Functions & Multi-Agent</h2>
            <p className="step-description">Add specialized business functions with pre-configured sub-agents, or set up custom multi-agent configurations.</p>

            <div style={{marginBottom: "1.5rem"}}>
              <label style={{fontWeight: 600, marginBottom: "0.75rem", display: "block"}}>Business Functions</label>
              <p className="input-hint" style={{marginBottom: "0.75rem"}}>Select functions to add pre-configured sub-agents to your setup.</p>
              <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem"}}>
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
                      backgroundColor: selectedBusinessFunctions.includes(bf.id) ? "rgba(255, 75, 43, 0.05)" : "var(--bg-card)",
                      cursor: "pointer"
                    }}
                  >
                    <div style={{display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem"}}>
                      <span style={{fontSize: "1.2rem"}}>{bf.emoji}</span>
                      <span style={{fontWeight: 600, fontSize: "0.9rem"}}>{bf.name}</span>
                    </div>
                    <div style={{fontSize: "0.8rem", color: "var(--text-muted)"}}>{bf.description}</div>
                    <div style={{fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem"}}>
                      {bf.subAgents.length} sub-agent{bf.subAgents.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{borderTop: "1px solid var(--border)", paddingTop: "1.5rem"}}>
              <label style={{fontWeight: 600, marginBottom: "0.5rem", display: "block"}}>Custom Multi-Agent</label>
              <div className="mode-card-container">
                <div className={`mode-card ${!enableMultiAgent ? "active" : ""}`} onClick={() => setEnableMultiAgent(false)}>
                  <h3>Single Agent</h3>
                  <p>Use one agent with the configured settings.</p>
                </div>
                <div className={`mode-card ${enableMultiAgent ? "active" : ""}`} onClick={() => setEnableMultiAgent(true)}>
                  <h3>Custom Multi-Agent</h3>
                  <p>Manually configure multiple agents (2-5).</p>
                </div>
              </div>

              {enableMultiAgent && (
                <div className="form-group" style={{marginTop: "1rem"}}>
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

            <div className="button-group" style={{marginTop: "1.5rem"}}>
              <button className="primary" onClick={() => {
                // Apply business function presets
                if (selectedBusinessFunctions.length > 0) {
                  const allAgents: typeof agentConfigs = [];
                  const allCronJobs: CronJobConfig[] = [];

                  for (const bfId of selectedBusinessFunctions) {
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
                      });
                    }

                    // Collect cron jobs
                    allCronJobs.push(...bf.cronJobs);
                  }

                  if (allAgents.length > 0) {
                    setEnableMultiAgent(true);
                    setAgentConfigs(prev => [...prev, ...allAgents]);
                    setNumAgents(prev => prev + allAgents.length);
                  }
                  setCronJobs(allCronJobs);
                }

                if (enableMultiAgent) {
                  if (agentConfigs.length === 0 || agentConfigs.length !== numAgents) {
                    const configs = Array.from({ length: numAgents }, (_, i) => {
                      const existingConfig = agentConfigs[i];
                      if (existingConfig && existingConfig.id) return existingConfig;
                      return {
                        id: `agent-${i + 1}`,
                        name: `Agent ${i + 1}`,
                        model: model,
                        fallbackModels: [],
                        skills: [],
                        vibe: "",
                        emoji: agentEmoji,
                        identityMd: "",
                        userMd: "",
                        soulMd: ""
                      };
                    });
                    setAgentConfigs(configs);
                  }
                  setCurrentAgentConfigIdx(0);
                  setActiveWorkspaceTab("identity");
                  setStep(15.5);
                } else {
                  setStep(16);
                }
              }} disabled={loading}>
                {enableMultiAgent || selectedBusinessFunctions.length > 0 ? "Configure Agents" : "Next"}
              </button>
              <button className="secondary" onClick={() => setStep(14)} disabled={loading}>Back</button>
            </div>
          </div>
        );
      case 15.5:

        // Agent Configuration Loop
        if (!enableMultiAgent || currentAgentConfigIdx >= agentConfigs.length) {
          setStep(16);
          return null;
        }
        const currentAgent = agentConfigs[currentAgentConfigIdx];
        const currentAgentProvider = currentAgent.model.split('/')[0];

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
              <div className="emoji-grid" style={{display: "flex", gap: "0.5rem", flexWrap: "wrap"}}>
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
                      background: currentAgent.emoji === e ? "rgba(255, 75, 43, 0.1)" : "var(--bg-card)",
                      cursor: "pointer",
                      minWidth: "40px"
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group" style={{marginBottom: "1.5rem"}}>
              <label>Persona Template</label>
              <div style={{maxHeight: "150px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem"}}>
                <RadioCard
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
                  columns={2}
                  options={[
                    { value: "custom", label: "Custom / Empty" },
                    ...Object.keys(PERSONA_TEMPLATES).filter(k => k !== "custom").sort().map(k => ({
                      value: k,
                      label: PERSONA_TEMPLATES[k].name
                    }))
                  ]}
                />
              </div>
            </div>

            <h3 style={{marginTop: "2rem"}}>Agent Workspace</h3>
            <div className="workspace-tabs">
              {[
                {id: "identity", label: "IDENTITY.md"},
                {id: "soul", label: "SOUL.md"}
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

            <div className="workspace-editor" style={{marginBottom: "2rem"}}>
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
            </div>

            <div className="form-group" style={{padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "1rem"}}>
              <label>Primary Model</label>
              
              <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Provider</label>
              <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                <RadioCard
                   value={currentAgentProvider}
                   onChange={(newProv) => {
                     const updated = [...agentConfigs];
                     if (DEFAULT_MODELS[newProv]) {
                       updated[currentAgentConfigIdx].model = DEFAULT_MODELS[newProv];
                     } else if (MODELS_BY_PROVIDER[newProv] && MODELS_BY_PROVIDER[newProv].length > 0) {
                       updated[currentAgentConfigIdx].model = MODELS_BY_PROVIDER[newProv][0].value;
                     }
                     setAgentConfigs(updated);
                   }}
                   columns={2}
                   options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                     value: p,
                     label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                     icon: PROVIDER_LOGOS[p]
                   }))}
                />
              </div>
              
              {currentAgentProvider && MODELS_BY_PROVIDER[currentAgentProvider] && (
                <>
                  <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Model</label>
                  <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                    <RadioCard
                       value={currentAgent.model}
                       onChange={(val) => {
                         const updated = [...agentConfigs];
                         updated[currentAgentConfigIdx].model = val;
                         setAgentConfigs(updated);
                       }}
                       columns={1}
                       options={MODELS_BY_PROVIDER[currentAgentProvider].map(m => ({ value: m.value, label: m.label }))}
                    />
                  </div>
                </>
              )}
              
              {currentAgentProvider && currentAgentProvider !== provider && !serviceKeys[currentAgentProvider] && !["ollama"].includes(currentAgentProvider) && (
                 <div style={{marginTop: "0.5rem"}}>
                   <label style={{fontSize: "0.85rem", color: "var(--text-muted)"}}>API Key for {currentAgentProvider}</label>
                   <input
                     type="password"
                     placeholder={`API Key for ${currentAgentProvider}`}
                     value={serviceKeys[currentAgentProvider] || ""}
                     onChange={(e) => setServiceKeys({...serviceKeys, [currentAgentProvider]: e.target.value})}
                     autoComplete="off"
                   />
                 </div>
              )}
            </div>
            
             <div className="form-group" style={{padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "1rem"}}>
               <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                 <label>Fallback Model (Optional)</label>
                 {currentAgent.fallbackModels[0] && (
                   <button className="secondary small" style={{padding: "2px 8px", fontSize: "0.75rem", height: "auto"}} onClick={() => {
                     const updated = [...agentConfigs];
                     updated[currentAgentConfigIdx].fallbackModels = [];
                     setAgentConfigs(updated);
                   }}>Clear</button>
                 )}
               </div>

               {(() => {
                 const currentFallbackModel = currentAgent.fallbackModels[0] || "";
                 const currentFallbackProvider = currentFallbackModel.split('/')[0];
                 
                 return (
                   <>
                     <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Provider</label>
                     <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                       <RadioCard
                         value={currentFallbackProvider || ""}
                         onChange={(newProv) => {
                           if (!newProv) return;
                           const updated = [...agentConfigs];
                           if (DEFAULT_MODELS[newProv]) {
                             updated[currentAgentConfigIdx].fallbackModels = [DEFAULT_MODELS[newProv]];
                           } else if (MODELS_BY_PROVIDER[newProv] && MODELS_BY_PROVIDER[newProv].length > 0) {
                             updated[currentAgentConfigIdx].fallbackModels = [MODELS_BY_PROVIDER[newProv][0].value];
                           }
                           setAgentConfigs(updated);
                         }}
                         columns={2}
                         options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                           value: p,
                           label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                           icon: PROVIDER_LOGOS[p]
                         }))}
                       />
                     </div>

                     {currentFallbackProvider && MODELS_BY_PROVIDER[currentFallbackProvider] && (
                       <>
                         <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Model</label>
                         <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                           <RadioCard
                             value={currentFallbackModel}
                             onChange={(val) => {
                               const updated = [...agentConfigs];
                               updated[currentAgentConfigIdx].fallbackModels = [val];
                               setAgentConfigs(updated);
                             }}
                             columns={1}
                             options={MODELS_BY_PROVIDER[currentFallbackProvider].map(m => ({ value: m.value, label: m.label }))}
                           />
                         </div>
                       </>
                     )}

                     {currentFallbackProvider && currentFallbackProvider !== provider && currentFallbackProvider !== currentAgentProvider && !serviceKeys[currentFallbackProvider] && !["ollama"].includes(currentFallbackProvider) && (
                       <div style={{marginTop: "0.5rem"}}>
                          <label style={{fontSize: "0.85rem", color: "var(--text-muted)"}}>API Key for {currentFallbackProvider}</label>
                          <input
                            type="password"
                            placeholder={`API Key for ${currentFallbackProvider}`}
                            value={serviceKeys[currentFallbackProvider] || ""}
                            onChange={(e) => setServiceKeys({...serviceKeys, [currentFallbackProvider]: e.target.value})}
                            autoComplete="off"
                          />
                       </div>
                     )}
                   </>
                 );
               })()}
             </div>

            <div className="form-group">
              <label>Skills</label>
              <div className="skills-grid" style={{marginTop: "0.5rem", maxHeight: "200px", overflowY: "auto"}}>
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
                    style={{padding: "0.75rem"}}
                  >
                    <div style={{display: "flex", alignItems: "center"}}>
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
                      <div className="skill-name" style={{fontSize: "0.85rem"}}>{skill.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="button-group" style={{marginTop: "1.5rem"}}>
              <button className="primary" onClick={() => {
                if (currentAgentConfigIdx < agentConfigs.length - 1) {
                  setCurrentAgentConfigIdx(currentAgentConfigIdx + 1);
                  setActiveWorkspaceTab("identity");
                } else {
                  setStep(16);
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
               <div style={{fontSize: "2rem", marginBottom: "1rem"}}>
                 {hasChanges ? (initialConfigRef.current ? "📝" : "🚀") : "✅"}
               </div>
               <h3>{hasChanges ? (initialConfigRef.current ? "Configuration Updated" : "Ready to Deploy") : "No Changes Detected"}</h3>
               <p style={{color: "var(--text-muted)"}}>
                 {hasChanges 
                   ? (initialConfigRef.current ? "You have modified the agent configuration. Click below to apply these changes." : "Your configuration is complete. Click below to deploy your agent.")
                   : "Your configuration matches the current active settings."}
               </p>
            </div>

            {(loading || error) && (
              <div className="progress-container" style={{marginBottom: "2rem"}}>
                {loading && (
                  <div className="progress-bar">
                    <div className="progress-fill" style={{width: progress.includes("Gateway") ? "80%" : (progress.includes("skill") ? "50%" : "20%")}} />
                  </div>
                )}
                <p style={{fontSize: "0.9rem", color: error ? "var(--error)" : "var(--primary)"}}>{error ? "Installation Failed" : progress}</p>
                <div className="logs-container">
                  <pre>{logs}</pre>
                </div>
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
              <button className="secondary" onClick={() => setStep(mode === "advanced" ? (enableMultiAgent ? 15.5 : 15) : 9)} disabled={loading}>Back</button>
            </div>
          </div>
        );

      case 10.5:
        return (
          <div className="step-view">
            <h2>Customize Workspace</h2>
            <p className="step-description">Edit your agent's identity, personality, and mission.</p>

            <div className="form-group" style={{marginBottom: "1.5rem"}}>
              <label>Persona Template</label>
              <div style={{maxHeight: "150px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem"}}>
                <RadioCard
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
                  columns={2}
                  options={[
                    { value: "custom", label: "Custom / Empty" },
                    ...Object.keys(PERSONA_TEMPLATES).filter(k => k !== "custom").sort().map(k => ({
                      value: k,
                      label: PERSONA_TEMPLATES[k].name
                    }))
                  ]}
                />
              </div>
            </div>

            <div className="workspace-tabs">
              {[
                {id: "identity", label: "IDENTITY.md"},
                {id: "user", label: "USER.md"},
                {id: "soul", label: "SOUL.md"}
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
            </div>

            <p className="input-hint" style={{marginTop: "1rem"}}>
              Leave blank to use auto-generated defaults. Changes can be edited later in the workspace folder.
            </p>

            <div className="button-group" style={{gap: "0.5rem"}}>
              <button
                className="secondary"
                disabled={!workspaceModified || savingWorkspace}
                onClick={() => handleSaveWorkspace()}
                style={{flex: "0 0 auto", minWidth: "150px"}}
              >
                {savingWorkspace ? "Saving..." : "💾 Save Changes"}
              </button>
              <button className="primary" onClick={() => setStep(11)} style={{flex: 1}}>
                Next
              </button>
              <button className="secondary" onClick={() => setStep(10)} style={{flex: "0 0 auto"}}>Back</button>
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
                <h4 style={{margin: "0 0 0.5rem 0", color: "var(--primary)"}}>
                  {tunnelActive ? "🔒 SSH Tunnel Active" : "⚠️ Tunnel Inactive"}
                </h4>
                <p style={{fontSize: "0.85rem", color: "var(--text-muted)", margin: 0}}>
                  {tunnelActive
                    ? `Remote gateway (${remoteIp}:18789) is forwarded to localhost:18789`
                    : "SSH tunnel is not active"}
                </p>
                {tunnelActive ? (
                  <button
                    className="secondary"
                    style={{marginTop: "1rem", width: "100%"}}
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
                    style={{marginTop: "1rem", width: "100%"}}
                    onClick={() => handleToggleTunnel()}
                  >
                    Establish SSH Tunnel
                  </button>
                )}
              </div>
            )}

            <div className="pairing-result">
               {!isPaired && (
                 <>
                   <h3>Telegram Pairing</h3>
                   <p style={{color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.5rem"}}>
                     Send any message to your bot to receive your code.
                   </p>
                   <div className="pairing-code-display">{pairingCode.includes("Ready") ? "READY" : pairingCode}</div>

                   {telegramToken && (
                     <div className="form-group" style={{marginTop: "2rem"}}>
                       <input
                         type="text"
                         placeholder="Enter code (e.g. 3RQ8EBFE)"
                         value={pairingInput}
                         onChange={(e) => setPairingInput(e.target.value.toUpperCase())}
                         style={{textAlign: "center", letterSpacing: "2px", fontWeight: "bold"}}
                       />
                       <button className="primary" style={{width: "100%", marginTop: "1rem"}} onClick={handlePairing} disabled={!pairingInput || pairingStatus === "Verifying..."}>
                         {pairingStatus === "Verifying..." ? "Verifying..." : "Pair Agent"}
                       </button>
                       {pairingStatus && (
                         <p style={{marginTop: "1rem", fontWeight: "bold", color: pairingStatus.includes("Error") ? "var(--error)" : "var(--success)"}}>
                           {pairingStatus}
                         </p>
                       )}
                     </div>
                   )}
                 </>
               )}
               
               {true && (
                  <div className="advanced-setup-prompt" style={{marginTop: "2rem", padding: "1.5rem", backgroundColor: "rgba(59, 130, 246, 0.1)", borderRadius: "12px", border: "1px solid var(--primary)"}}>
                    <h3 style={{marginTop: 0, marginBottom: "0.5rem"}}>Configuration Complete</h3>
                    {mode !== "advanced" ? (
                      <>
                        <p style={{marginBottom: "0.75rem", fontSize: "1rem"}}>Your agent is live. But right now, it's a solo worker.</p>
                        <p style={{marginBottom: "1rem", fontSize: "1.05rem", fontWeight: 600}}>Give it a team.</p>
                        <p style={{marginBottom: "1rem", fontSize: "0.9rem", lineHeight: "1.7", color: "var(--text-main)"}}>
                          Deploy a fleet of specialized AI agents that research, write, code, manage email, track tasks, and handle customers — all working together, 24/7, while you focus on what matters.
                        </p>
                        <div style={{marginBottom: "1.25rem", fontSize: "0.85rem", lineHeight: "2", color: "var(--text-muted)"}}>
                          <div>Multi-agent teams &bull; 40+ integrations &bull; Scheduled automations</div>
                          <div>CRM, support, social media &bull; Smart failover &bull; Security controls</div>
                        </div>
                        <p style={{marginBottom: "1.5rem"}}><strong style={{fontSize: "1.1rem"}}>$9.99</strong> <span style={{fontSize: "0.85rem", color: "var(--text-muted)"}}>once &bull; yours forever</span></p>
                      </>
                    ) : (
                      <p style={{marginBottom: "1.5rem"}}>Your agent is paired and ready.</p>
                    )}
                    <div className="button-group" style={{gap: "1rem"}}>
                       <button className="primary" onClick={() => open(dashboardUrl)}>
                         Open Web Dashboard
                       </button>
                       {mode !== "advanced" && (
                         <button className="secondary" onClick={() => setShowLicenseModal(true)} style={{backgroundColor: "var(--primary)", color: "#fff", border: "none"}}>
                           Unlock Advanced - $9.99
                         </button>
                       )}
                       <button className="secondary" onClick={() => invoke("close_app")}>
                         Exit Setup
                       </button>
                    </div>
                  </div>
               )}
            </div>

            {false && (
              <div className="button-group" style={{flexDirection: "column", gap: "10px"}}>
                <button className="primary" style={{width: "100%"}} onClick={() => open(dashboardUrl)}>
                  Open Web Dashboard {targetEnvironment === "cloud" && "(via Tunnel)"}
                </button>
                <button className="secondary" style={{width: "100%"}} onClick={() => invoke("close_app")}>Exit Setup</button>
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
      <aside className="sidebar">
        <div className="logo">
          🦞 ClawSetup
        </div>
        <ul className="step-list">
          {stepsList
            .filter(s => !s.hidden)
            .filter(s => mode === "advanced" || !s.advanced)
            .filter(s => !skipBasicConfig || (s.id !== 8 && s.id !== 9))
            .map((s, idx) => (
              <li key={s.id} className={`step-indicator ${getStepStatus(s.id)}`}>
                <span className="step-number">{idx + 1}</span>
                {s.name}
              </li>
            ))}
        </ul>
        <div style={{marginTop: "auto", paddingTop: "1rem"}}>
          <button 
            className="secondary" 
            style={{width: "100%", justifyContent: "space-between", padding: "0.5rem 1rem"}}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <span style={{fontSize: "0.85rem"}}>Theme</span>
            <span>{theme === "dark" ? "🌙" : "☀️"}</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="content-wrapper">
          {renderStep()}
        </div>
      </main>

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
            <h3 style={{marginTop: 0}}>Advanced Setup License</h3>
            <p style={{fontSize: "0.9rem", color: "var(--text-muted)"}}>
              Advanced features require a license key. You can purchase one from Gumroad.
            </p>
            
            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>License Key</label>
              <input 
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                autoFocus
              />
            </div>
            
            <div style={{marginTop: "1rem", fontSize: "0.85rem"}}>
              <a 
                href="#" 
                onClick={(e) => { e.preventDefault(); open("https://aimodelscompass.gumroad.com/l/clawsetup"); }}
                style={{color: "var(--primary)"}}
              >
                Get a license key &rarr;
              </a>
            </div>

            {licenseError && (
              <div className="error" style={{marginTop: "1rem", fontSize: "0.85rem", color: "var(--error)"}}>
                {licenseError}
              </div>
            )}

            <div className="button-group" style={{marginTop: "2rem"}}>
              <button 
                className="primary" 
                disabled={!licenseKey || verifyingLicense}
                onClick={async () => {
                  setVerifyingLicense(true);
                  setLicenseError("");
                  try {
                    await invoke("verify_license", { key: licenseKey.trim() });
                    // Success
                    setVerifyingLicense(false);
                    setShowLicenseModal(false);
                    setMode("advanced");
                    setPairingStatus("");
                    setSkipBasicConfig(true); setMaintCompleted(true);
                    setStep(7);
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
    
    </div>
  );
}

export default App;
