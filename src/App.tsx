import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/shell";
import { open as openDialog } from "@tauri-apps/api/dialog";
import "./App.css";

function App() {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState("basic"); // "basic" or "advanced"
  const [checks, setChecks] = useState({ node: false, docker: false, openclaw: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [logs, setLogs] = useState("");
  const [pairingCode, setPairingCode] = useState("");

  // Form Data
  const [userName, setUserName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentVibe, setAgentVibe] = useState("Professional");
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

  // Environment selection
  const [targetEnvironment, setTargetEnvironment] = useState("local");

  // SSH Remote Configuration
  const [remoteIp, setRemoteIp] = useState("");
  const [remoteUser, setRemoteUser] = useState("");
  const [remotePassword, setRemotePassword] = useState("");
  const [remotePrivateKeyPath, setRemotePrivateKeyPath] = useState("");
  const [sshStatus, setSshStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [sshError, setSshError] = useState("");
  const [tunnelActive, setTunnelActive] = useState(false);

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

  // NEW: Security Best Practices (Step 11)
  const [sandboxMode, setSandboxMode] = useState("full");
  const [toolsMode, setToolsMode] = useState("allowlist");
  const [allowedTools, setAllowedTools] = useState<string[]>(["filesystem", "terminal", "browser"]);
  const [deniedTools, setDeniedTools] = useState<string[]>([]);

  // NEW: Fallback Models (Step 12)
  const [enableFallbacks, setEnableFallbacks] = useState(false);
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);

  // NEW: Session Management (Step 13)
  const [heartbeatMode, setHeartbeatMode] = useState("1h");
  const [idleTimeoutMs, setIdleTimeoutMs] = useState(3600000);

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
    identityMd: string;
    userMd: string;
    soulMd: string;
  }>>([]);
  const [currentAgentConfigIdx, setCurrentAgentConfigIdx] = useState(0);
  const [isConfiguringAgent, setIsConfiguringAgent] = useState(false);

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

  const availableSkills = [
    { id: "github", name: "GitHub", desc: "Interact with GitHub using gh CLI" },
    { id: "weather", name: "Weather", desc: "Get current weather and forecasts" },
    { id: "openai-whisper", name: "Whisper", desc: "Local speech-to-text" },
    { id: "apple-notes", name: "Apple Notes", desc: "Manage Apple Notes on macOS" },
    { id: "things-mac", name: "Things", desc: "Manage Things 3 on macOS" },
    { id: "coding-agent", name: "Coding Agent", desc: "Run Codex, Claude Code, etc." }
  ];

  const stepsList = [
    { id: 0, name: "System State", hidden: true },
    { id: 1, name: "Environment" },
    { id: 2, name: "System Check" },
    { id: 3, name: "Security" },
    { id: 4, name: "Mode" },
    { id: 5, name: "Identity" },
    { id: 6, name: "Agent" },
    { id: 7, name: "Gateway", advanced: true },
    { id: 8, name: "Brain" },
    { id: 9, name: "Channels" },
    { id: 10, name: "Runtime", advanced: true },
    { id: 11, name: "Skills", advanced: true },
    { id: 12, name: "Security+", advanced: true },
    { id: 13, name: "Fallbacks", advanced: true },
    { id: 14, name: "Session", advanced: true },
    { id: 15, name: "Agents", advanced: true },
    { id: 16, name: "Workspace", advanced: true },
    { id: 17, name: "Pairing" }
  ];

  useEffect(() => { checkSystem(); }, []);

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

  async function checkSystem() {
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
      setStep(0);
      return true; // Indicate that we're going to maintenance
    }
    return false; // Continue with normal flow
  }

  async function checkRemoteSystem() {
    // Check remote system (called from Step 1 when cloud environment is selected)
    if (sshStatus === "success") {
      const res: any = await invoke("check_remote_prerequisites", {
        remote: {
          ip: remoteIp,
          user: remoteUser,
          password: remotePassword || null,
          private_key_path: remotePrivateKeyPath || null
        }
      });
      setChecks({
        node: res.node_installed,
        docker: res.docker_running,
        openclaw: res.openclaw_installed
      });
      const version: string = await invoke("get_remote_openclaw_version", {
        remote: {
          ip: remoteIp,
          user: remoteUser,
          password: remotePassword || null,
          private_key_path: remotePrivateKeyPath || null
        }
      });
      setOpenClawVersion(version);

      // If OpenClaw is already installed remotely, go to maintenance screen
      if (res.openclaw_installed) {
        setStep(0);
        return true; // Indicate that we're going to maintenance
      }
      return false; // Continue with normal flow
    }
    return false;
  }

  function formatSshError(error: string): string {
    const errorLower = error.toLowerCase();

    // Authentication errors
    if (errorLower.includes("no identities found in the ssh agent")) {
      return "SSH agent has no keys loaded. Try using a password or specifying a key file.";
    }
    if (errorLower.includes("all authentication methods failed")) {
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
      await invoke("test_ssh_connection", {
        remote: {
          ip: remoteIp,
          user: remoteUser,
          password: remotePassword || null,
          private_key_path: remotePrivateKeyPath || null
        }
      });
      setSshStatus("success");
      setSshError(""); // Clear any previous errors
      // Keep SSH status as "success" - don't reset it
      // This is needed for tunnel establishment and remote maintenance
    } catch (e) {
      setSshStatus("idle");
      const friendlyError = formatSshError(String(e));
      setSshError(friendlyError);
      // Clear error after 30 seconds
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

  async function handleInstall() {
    setLoading(true);
    setError(false);
    setProgress("Starting setup...");

    try {
      if (targetEnvironment === "cloud") {
        // Remote installation flow
        setProgress("Setting up OpenClaw on remote server...");
        setLogs("Installing OpenClaw on remote server...");

        const remoteConfig = {
          ip: remoteIp,
          user: remoteUser,
          password: remotePassword || null,
          private_key_path: remotePrivateKeyPath || null
        };

        await invoke("setup_remote_openclaw", {
          remote: remoteConfig,
          config: {
            provider,
            api_key: apiKey,
            auth_method: authMethod,
            model,
            user_name: userName,
            agent_name: agentName,
            agent_vibe: agentVibe,
            telegram_token: telegramToken,
            identity_md: mode === "advanced" && identityMd ? identityMd : null,
            user_md: mode === "advanced" && userMd ? userMd : null,
            soul_md: mode === "advanced" && soulMd ? soulMd : null,
          }
        });

        setProgress("Establishing SSH tunnel...");
        setLogs("Creating SSH tunnel to remote gateway...");
        await invoke("start_ssh_tunnel", { remote: remoteConfig });
        setTunnelActive(true);

        setProgress("Finalizing setup...");
        const instruction: string = await invoke("generate_pairing_code");
        setPairingCode(instruction);

        // Get dashboard URL (tunneled)
        setDashboardUrl("http://127.0.0.1:18789");

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
          config: {
            provider,
            api_key: apiKey,
            auth_method: authMethod,
            model,
            user_name: userName,
            agent_name: agentName,
            agent_vibe: agentVibe,
            telegram_token: telegramToken,
            gateway_port: gatewayPort,
            gateway_bind: gatewayBind,
            gateway_auth_mode: gatewayAuthMode,
            tailscale_mode: tailscaleMode,
            node_manager: nodeManager,
            skills: selectedSkills,
            service_keys: serviceKeys,
            // NEW: Advanced settings
            sandbox_mode: mode === "advanced" ? sandboxMode : null,
            tools_mode: mode === "advanced" ? toolsMode : null,
            allowed_tools: mode === "advanced" && toolsMode === "allowlist" ? allowedTools : null,
            denied_tools: mode === "advanced" && toolsMode === "denylist" ? deniedTools : null,
            fallback_models: mode === "advanced" && enableFallbacks ? fallbackModels.filter(m => m) : null,
            heartbeat_mode: mode === "advanced" ? heartbeatMode : null,
            idle_timeout_ms: mode === "advanced" && heartbeatMode === "idle" ? idleTimeoutMs : null,
            identity_md: mode === "advanced" && identityMd ? identityMd : null,
            user_md: mode === "advanced" && userMd ? userMd : null,
            soul_md: mode === "advanced" && soulMd ? soulMd : null,
            // Multi-agent support
            agents: enableMultiAgent ? agentConfigs.map(a => ({
              id: a.id,
              name: a.name,
              model: a.model,
              fallback_models: a.fallbackModels.length > 0 ? a.fallbackModels : null,
              skills: a.skills.length > 0 ? a.skills : null,
              vibe: a.vibe,
              identity_md: a.identityMd || null,
              user_md: a.userMd || null,
              soul_md: a.soulMd || null
            })) : null
          }
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
        const instruction: string = await invoke("generate_pairing_code");
        setPairingCode(instruction);

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
      await invoke("approve_pairing", { code: pairingInput });
      setPairingStatus("✅ Success! Bot paired.");
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
        private_key_path: remotePrivateKeyPath || null
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

  const isOAuthMethod = (method: string) => {
    return ["antigravity", "gemini_cli", "codex"].includes(method);
  };

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
                        private_key_path: remotePrivateKeyPath || null
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
                              private_key_path: remotePrivateKeyPath || null
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
                            private_key_path: remotePrivateKeyPath || null
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
                <p>Remove the OpenClaw CLI and all local configuration/data files.</p>
              </div>
            </div>

            {!loading && (
              <div className="button-group" style={{gap: "10px", marginTop: "1.5rem"}}>
                <button
                  className="primary"
                  style={{flex: 1}}
                  onClick={async () => {
                    if (selectedMaint === "reconfigure") {
                      // Go directly to Configuration Mode, preserving environment settings
                      setStep(4);
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
                  const alreadyInstalled = targetEnvironment === "cloud"
                    ? await checkRemoteSystem()
                    : await checkSystem();

                  // Only go to Step 2 if not already installed
                  if (!alreadyInstalled) {
                    setStep(2);
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
              <p className="error" style={{marginTop: "1rem", color: "var(--error)"}}>
                Please install Node.js (v18+) {targetEnvironment === "cloud" ? "on the remote server" : "on your system"} to continue.
              </p>
            )}
            <div className="button-group">
              <button className="primary" disabled={!checks.node} onClick={() => setStep(3)}>Continue</button>
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
              <button className="primary" onClick={() => setStep(4)}>I Understand</button>
              <button className="secondary" onClick={() => setStep(2)}>Back</button>
            </div>
          </div>
        );
      case 4:
        return (
          <div className="step-view">
            <h2>Configuration Mode</h2>
            <p className="step-description">Choose how much control you want over the initial setup.</p>
            <div className="mode-card-container">
              <div className={`mode-card ${mode === "basic" ? "active" : ""}`} onClick={() => setMode("basic")}>
                <h3>QuickStart</h3>
                <p>Fastest setup with sane defaults. Recommended for first-time users.</p>
              </div>
              <div className={`mode-card ${mode === "advanced" ? "active" : ""}`} onClick={() => setMode("advanced")}>
                <h3>Advanced</h3>
                <p>Full control over gateway, networking, and pre-installed skills.</p>
              </div>
            </div>
            <div className="button-group">
              <button className="primary" onClick={() => setStep(5)}>Continue</button>
              <button className="secondary" onClick={() => setStep(3)}>Back</button>
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
              <input autoFocus placeholder="e.g. David" value={userName} onChange={(e) => setUserName(e.target.value)} />
            </div>
            <div className="button-group">
              <button className="primary" disabled={!userName} onClick={() => setStep(6)}>Next</button>
              <button className="secondary" onClick={() => setStep(4)}>Back</button>
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
              <input autoFocus placeholder="e.g. Jeeves" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Agent Vibe</label>
              <select value={agentVibe} onChange={(e) => setAgentVibe(e.target.value)}>
                <option>Professional</option>
                <option>Friendly</option>
                <option>Chaos</option>
                <option>Helpful Assistant</option>
              </select>
            </div>
            <div className="button-group">
              <button className="primary" disabled={!agentName} onClick={() => setStep(mode === "advanced" ? 7 : 8)}>Next</button>
              <button className="secondary" onClick={() => setStep(5)}>Back</button>
            </div>
          </div>
        );
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
              <select value={gatewayBind} onChange={(e) => setGatewayBind(e.target.value)}>
                <option value="loopback">Loopback (127.0.0.1)</option>
                <option value="all">All Interfaces (0.0.0.0)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Auth Mode</label>
              <select value={gatewayAuthMode} onChange={(e) => setGatewayAuthMode(e.target.value)}>
                <option value="token">Token (Secure)</option>
                <option value="none">None (Insecure)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Tailscale</label>
              <select value={tailscaleMode} onChange={(e) => setTailscaleMode(e.target.value)}>
                <option value="off">Disabled</option>
                <option value="on">Enabled (Expose via Tailscale)</option>
              </select>
            </div>
            <div className="button-group">
              <button className="primary" onClick={() => setStep(8)}>Continue</button>
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
              <select value={provider} onChange={(e) => {
                const p = e.target.value;
                setProvider(p);
                if (p === "anthropic") setModel("anthropic/claude-opus-4-6");
                else if (p === "openai") setModel("openai/gpt-4o");
                else if (p === "google") setModel("google/gemini-2.0-flash-exp");
              }}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google Gemini</option>
                <option value="openrouter">OpenRouter</option>
                <option value="ollama">Ollama (Local)</option>
                {mode === "advanced" && (
                  <>
                    <option value="deepseek">DeepSeek</option>
                    <option value="xai">xAI (Grok)</option>
                    <option value="copilot">Copilot</option>
                  </>
                )}
              </select>
            </div>
            
            <div className="form-group">
              <label>Auth Method</label>
              <select value={authMethod} onChange={(e) => setAuthMethod(e.target.value)}>
                {provider === "anthropic" && (
                  <>
                    <option value="token">Anthropic API Key</option>
                    <option value="setup-token">Anthropic Token (from setup-token)</option>
                  </>
                )}
                {provider === "google" && (
                  <>
                    <option value="token">Google Gemini API Key</option>
                    <option value="antigravity">Google Antigravity OAuth</option>
                    <option value="gemini_cli">Google Gemini CLI OAuth</option>
                  </>
                )}
                {provider === "openai" && (
                  <>
                    <option value="token">OpenAI API Key</option>
                    <option value="codex">OpenAI Codex (ChatGPT OAuth)</option>
                  </>
                )}
                {provider !== "anthropic" && provider !== "google" && provider !== "openai" && (
                   <option value="token">API Key (Standard)</option>
                )}
              </select>
            </div>

            <div className="form-group">
              <label>Primary Model</label>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {provider === "anthropic" && (
                  <optgroup label="Anthropic">
                    <option value="anthropic/claude-opus-4-6">Claude Opus 4.6</option>
                    <option value="anthropic/claude-opus-4-5-20260201">Claude Opus 4.5</option>
                    <option value="anthropic/claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
                    <option value="anthropic/claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                    <option value="anthropic/claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                  </optgroup>
                )}
                {provider === "openai" && (
                  <optgroup label="OpenAI">
                    <option value="openai/gpt-4o">GPT-4o</option>
                    <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                    <option value="openai/gpt-5-preview">GPT-5 Preview</option>
                  </optgroup>
                )}
                {provider === "google" && (
                  <optgroup label="Google">
                    <option value="google/gemini-2.0-flash-exp">Gemini 2.0 Flash</option>
                    <option value="google/gemini-1.5-pro-latest">Gemini 1.5 Pro</option>
                    <option value="google/gemini-ultra-2.0">Gemini Ultra 2.0</option>
                  </optgroup>
                )}
                {provider === "openrouter" && (
                   <option value="openrouter/auto">Auto (OpenRouter)</option>
                )}
                {provider === "ollama" && (
                   <option value="ollama/llama3.1">Llama 3.1 (Local)</option>
                )}
              </select>
            </div>

            {!isOAuthMethod(authMethod) && (
              <div className="form-group">
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
            )}

            {isOAuthMethod(authMethod) && (
              <div style={{marginTop: "1rem"}}>
                <button className="primary" style={{width: "100%"}} disabled={loading} onClick={async () => {
                  setLoading(true);
                  try {
                    const res: string = await invoke("start_provider_auth", { provider, method: authMethod });
                    setApiKey(res);
                  } catch (e) { 
                    setLogs("Auth Error: " + e);
                  }
                  setLoading(false);
                }}>
                  {loading ? "Waiting for Browser..." : "Launch Browser Login"}
                </button>
                <p className="input-hint">A browser window will open to complete the authentication.</p>
              </div>
            )}

            <div className="button-group">
              <button className="primary" disabled={!isOAuthMethod(authMethod) && !apiKey} onClick={() => setStep(9)}>Next</button>
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
                if (mode === "advanced") setStep(10);
                else handleInstall();
              }} disabled={loading}>
                {mode === "advanced" ? "Continue" : (loading ? "Installing..." : "Finish Setup")}
              </button>
              <button className="secondary" onClick={() => setStep(8)} disabled={loading}>Back</button>
            </div>
            
            {(loading || error) && (
              <div className="progress-container">
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
            
            {error && (
              <div style={{marginTop: "2rem"}}>
                <button className="primary" style={{backgroundColor: "var(--error)", width: "100%"}} onClick={() => invoke("close_app")}>Exit Installation</button>
              </div>
            )}
          </div>
        );
      case 10:
        return (
          <div className="step-view">
            <h2>Runtime Environment</h2>
            <p className="step-description">Configure how the agent executes tools and skills.</p>
            <div className="form-group">
              <label>Node Package Manager</label>
              <select value={nodeManager} onChange={(e) => setNodeManager(e.target.value)}>
                <option value="npm">npm</option>
                <option value="pnpm">pnpm</option>
                <option value="bun">bun</option>
              </select>
            </div>
            <div className="button-group">
              <button className="primary" onClick={() => setStep(11)}>Next</button>
              <button className="secondary" onClick={() => setStep(9)}>Back</button>
            </div>
          </div>
        );
      case 11:
        return (
          <div className="step-view">
            <h2>Select Core Skills</h2>
            <p className="step-description">Enable the capabilities your agent will start with.</p>
            <div className="skills-grid">
              {availableSkills.map(skill => (
                <div
                  key={skill.id}
                  className={`skill-card ${selectedSkills.includes(skill.id) ? "active" : ""}`}
                  onClick={() => toggleSkill(skill.id)}
                >
                  <div className="skill-name">{skill.name}</div>
                  <div className="skill-desc">{skill.desc}</div>
                </div>
              ))}
            </div>

            <div style={{marginTop: "2rem"}}>
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
                setCurrentServiceIdx(0);
                setIsConfiguringService(false);
                setStep(11.5);
              }}>Continue</button>
              <button className="secondary" onClick={() => setStep(10)}>Back</button>
            </div>
          </div>
        );
      case 11.5:
        return (
          <div className="step-view">
            <h2>Service Key: {servicesToConfigure[currentServiceIdx].name}</h2>
            <p className="step-description">Would you like to provide a key for this optional service now?</p>
            
            <div className="mode-card-container" style={{marginBottom: "2rem"}}>
              <div className={`mode-card ${isConfiguringService === true ? "active" : ""}`} onClick={() => setIsConfiguringService(true)}>
                <h3>Yes</h3>
                <p>Configure {servicesToConfigure[currentServiceIdx].name} now.</p>
              </div>
              <div className={`mode-card ${isConfiguringService === false ? "active" : ""}`} onClick={() => setIsConfiguringService(false)}>
                <h3>Skip</h3>
                <p>I'll configure this later in the dashboard.</p>
              </div>
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
                      handleInstall();
                    }
                  }
                }}
              >
                {currentServiceIdx < servicesToConfigure.length - 1 ? "Next Service" : (mode === "advanced" ? "Continue to Advanced Settings" : (loading ? "Installing..." : "Finish Installation"))}
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
            {(loading || error) && (
               <div className="progress-container">
                  <p style={{fontSize: "0.9rem", color: error ? "var(--error)" : "var(--primary)"}}>{error ? "Installation Failed" : progress}</p>
                  <div className="logs-container">
                    <pre>{logs}</pre>
                  </div>
               </div>
            )}
            {error && (
              <div style={{marginTop: "2rem"}}>
                <button className="primary" style={{backgroundColor: "var(--error)", width: "100%"}} onClick={() => invoke("close_app")}>Exit Installation</button>
              </div>
            )}
          </div>
        );
      case 12:
        return (
          <div className="step-view">
            <h2>Security Configuration</h2>
            <p className="step-description">Configure security policies for your agent.</p>

            <div className="form-group">
              <label>Sandbox Mode</label>
              <select value={sandboxMode} onChange={e => setSandboxMode(e.target.value)}>
                <option value="full">Full Sandbox (Recommended)</option>
                <option value="partial">Partial Sandbox</option>
                <option value="none">No Sandbox</option>
              </select>
              <p className="input-hint">Full sandbox provides maximum isolation for agent operations.</p>
            </div>

            <div className="form-group">
              <label>Tools Policy</label>
              <select value={toolsMode} onChange={e => setToolsMode(e.target.value)}>
                <option value="allowlist">Allowlist (Recommended)</option>
                <option value="denylist">Denylist</option>
                <option value="all">All Tools</option>
              </select>
              <p className="input-hint">Allowlist mode only enables explicitly selected tools.</p>
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
            <h2>Fallback Models</h2>
            <p className="step-description">Configure backup models for increased reliability.</p>

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
                <div className="form-group" style={{marginTop: "1.5rem"}}>
                  <label>Fallback Model 1</label>
                  <select value={fallbackModels[0] || ""} onChange={e => {
                    const newModels = [...fallbackModels];
                    newModels[0] = e.target.value;
                    setFallbackModels(newModels);
                  }}>
                    <option value="">Select model...</option>
                    <option value="anthropic/claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
                    <option value="anthropic/claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                    <option value="openai/gpt-4o">GPT-4o</option>
                    <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                    <option value="google/gemini-2.0-flash-exp">Gemini 2.0 Flash</option>
                  </select>
                </div>
                {fallbackModels[0] && (
                  <div className="form-group">
                    <label>Fallback Model 2 (Optional)</label>
                    <select value={fallbackModels[1] || ""} onChange={e => {
                      const newModels = [...fallbackModels];
                      newModels[1] = e.target.value;
                      setFallbackModels(newModels);
                    }}>
                      <option value="">Select model...</option>
                      <option value="anthropic/claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
                      <option value="anthropic/claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                      <option value="openai/gpt-4o">GPT-4o</option>
                      <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                      <option value="google/gemini-2.0-flash-exp">Gemini 2.0 Flash</option>
                    </select>
                  </div>
                )}
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
            <h2>Multiple Agents</h2>
            <p className="step-description">Configure multiple specialized agents with unique models and skills.</p>

            <div className="mode-card-container">
              <div className={`mode-card ${!enableMultiAgent ? "active" : ""}`} onClick={() => setEnableMultiAgent(false)}>
                <h3>Single Agent</h3>
                <p>Use one agent with the configured settings.</p>
              </div>
              <div className={`mode-card ${enableMultiAgent ? "active" : ""}`} onClick={() => setEnableMultiAgent(true)}>
                <h3>Multi-Agent</h3>
                <p>Configure multiple agents (2-5) with different configurations.</p>
              </div>
            </div>

            {enableMultiAgent && (
              <div className="form-group" style={{marginTop: "2rem"}}>
                <label>Number of Agents</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={numAgents}
                  onChange={(e) => {
                    const num = parseInt(e.target.value) || 1;
                    setNumAgents(Math.max(1, Math.min(5, num)));
                  }}
                />
                <p className="input-hint">You can configure 1-5 specialized agents</p>
              </div>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => {
                if (enableMultiAgent) {
                  // Initialize agent configs
                  const configs = Array.from({ length: numAgents }, (_, i) => ({
                    id: `agent-${i + 1}`,
                    name: `Agent ${i + 1}`,
                    model: model,
                    fallbackModels: [],
                    skills: [...selectedSkills],
                    vibe: agentVibe,
                    identityMd: "",
                    userMd: "",
                    soulMd: ""
                  }));
                  setAgentConfigs(configs);
                  setCurrentAgentConfigIdx(0);
                  setStep(15.5);
                } else {
                  setStep(16);
                }
              }}>Continue</button>
              <button className="secondary" onClick={() => setStep(14)}>Back</button>
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
        return (
          <div className="step-view">
            <h2>Configure Agent {currentAgentConfigIdx + 1} of {agentConfigs.length}</h2>
            <p className="step-description">Set up the model, skills, and personality for this agent.</p>

            <div className="form-group">
              <label>Agent Name</label>
              <input
                value={currentAgent.name}
                onChange={(e) => {
                  const updated = [...agentConfigs];
                  updated[currentAgentConfigIdx].name = e.target.value;
                  setAgentConfigs(updated);
                }}
                placeholder="e.g., CodeBot"
              />
            </div>

            <div className="form-group">
              <label>Primary Model</label>
              <select
                value={currentAgent.model}
                onChange={(e) => {
                  const updated = [...agentConfigs];
                  updated[currentAgentConfigIdx].model = e.target.value;
                  setAgentConfigs(updated);
                }}
              >
                <optgroup label="Anthropic">
                  <option value="anthropic/claude-opus-4-6">Claude Opus 4.6</option>
                  <option value="anthropic/claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
                  <option value="anthropic/claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                </optgroup>
                <optgroup label="OpenAI">
                  <option value="openai/gpt-4o">GPT-4o</option>
                  <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                </optgroup>
                <optgroup label="Google">
                  <option value="google/gemini-2.0-flash-exp">Gemini 2.0 Flash</option>
                  <option value="google/gemini-1.5-pro-latest">Gemini 1.5 Pro</option>
                </optgroup>
              </select>
            </div>

            <div className="form-group">
              <label>Agent Vibe</label>
              <select
                value={currentAgent.vibe}
                onChange={(e) => {
                  const updated = [...agentConfigs];
                  updated[currentAgentConfigIdx].vibe = e.target.value;
                  setAgentConfigs(updated);
                }}
              >
                <option>Professional</option>
                <option>Friendly</option>
                <option>Chaos</option>
                <option>Helpful Assistant</option>
              </select>
            </div>

            <div className="form-group">
              <label>Skills</label>
              <div className="skills-grid" style={{marginTop: "0.5rem"}}>
                {availableSkills.slice(0, 6).map(skill => (
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
                    <div className="skill-name" style={{fontSize: "0.85rem"}}>{skill.name}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="button-group">
              <button className="primary" onClick={() => {
                if (currentAgentConfigIdx < agentConfigs.length - 1) {
                  setCurrentAgentConfigIdx(currentAgentConfigIdx + 1);
                } else {
                  setCurrentAgentConfigIdx(0);
                  setStep(15.6);
                }
              }}>
                {currentAgentConfigIdx < agentConfigs.length - 1 ? "Next Agent" : "Configure Workspaces"}
              </button>
              <button className="secondary" onClick={() => {
                if (currentAgentConfigIdx > 0) {
                  setCurrentAgentConfigIdx(currentAgentConfigIdx - 1);
                } else {
                  setStep(15);
                }
              }}>Back</button>
            </div>
          </div>
        );
      case 15.6:
        // Per-Agent Workspace Loop
        if (!enableMultiAgent || currentAgentConfigIdx >= agentConfigs.length) {
          setStep(17);
          return null;
        }
        const workspaceAgent = agentConfigs[currentAgentConfigIdx];
        return (
          <div className="step-view">
            <h2>Workspace: {workspaceAgent.name}</h2>
            <p className="step-description">Customize workspace files for {workspaceAgent.name} (Agent {currentAgentConfigIdx + 1}/{agentConfigs.length})</p>

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
                  rows={10}
                  value={workspaceAgent.identityMd}
                  onChange={e => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].identityMd = e.target.value;
                    setAgentConfigs(updated);
                  }}
                  placeholder={`# IDENTITY.md - Who Am I?\n- **Name:** ${workspaceAgent.name}\n- **Vibe:** ${workspaceAgent.vibe}\n- **Emoji:** 🦞\n`}
                />
              )}
              {activeWorkspaceTab === "user" && (
                <textarea
                  className="markdown-editor"
                  rows={10}
                  value={workspaceAgent.userMd}
                  onChange={e => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].userMd = e.target.value;
                    setAgentConfigs(updated);
                  }}
                  placeholder={`# USER.md - About Your Human\n- **Name:** ${userName}\n`}
                />
              )}
              {activeWorkspaceTab === "soul" && (
                <textarea
                  className="markdown-editor"
                  rows={10}
                  value={workspaceAgent.soulMd}
                  onChange={e => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].soulMd = e.target.value;
                    setAgentConfigs(updated);
                  }}
                  placeholder={`# SOUL.md\n## Mission\nServe ${userName}.\n`}
                />
              )}
            </div>

            <div className="button-group" style={{marginTop: "1.5rem"}}>
              <button className="primary" onClick={() => {
                if (currentAgentConfigIdx < agentConfigs.length - 1) {
                  setCurrentAgentConfigIdx(currentAgentConfigIdx + 1);
                  setActiveWorkspaceTab("identity");
                } else {
                  handleInstall();
                }
              }}>
                {currentAgentConfigIdx < agentConfigs.length - 1 ? "Next Agent Workspace" : (loading ? "Installing..." : "Finish Installation")}
              </button>
              <button className="secondary" onClick={() => {
                if (currentAgentConfigIdx > 0) {
                  setCurrentAgentConfigIdx(currentAgentConfigIdx - 1);
                  setActiveWorkspaceTab("identity");
                } else {
                  setCurrentAgentConfigIdx(agentConfigs.length - 1);
                  setStep(15.5);
                }
              }} disabled={loading}>Back</button>
            </div>

            {(loading || error) && (
              <div className="progress-container" style={{marginTop: "2rem"}}>
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
          </div>
        );
      case 16:
        return (
          <div className="step-view">
            <h2>Customize Workspace</h2>
            <p className="step-description">Edit your agent's identity, personality, and mission.</p>

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
                  placeholder={`# IDENTITY.md - Who Am I?\n- **Name:** ${agentName}\n- **Vibe:** ${agentVibe}\n- **Emoji:** 🦞\n\nAdd more details about your agent's identity...`}
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
              <button className="primary" onClick={handleInstall} disabled={loading} style={{flex: 1}}>
                {loading ? "Installing..." : "Finish Installation"}
              </button>
              <button className="secondary" onClick={() => setStep(15)} disabled={loading} style={{flex: "0 0 auto"}}>Back</button>
            </div>

            {(loading || error) && (
              <div className="progress-container">
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

            {error && (
              <div style={{marginTop: "2rem"}}>
                <button className="primary" style={{backgroundColor: "var(--error)", width: "100%"}} onClick={() => invoke("close_app")}>Exit Installation</button>
              </div>
            )}
          </div>
        );
      case 17:
        return (
          <div className="step-view">
            <h2>Setup Complete! 🦞</h2>
            <p style={{fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem"}}>OpenClaw {openClawVersion}</p>
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
                {tunnelActive && (
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
                )}
              </div>
            )}

            <div className="pairing-result">
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
            </div>

            <div className="button-group" style={{flexDirection: "column", gap: "10px"}}>
              <button className="primary" style={{width: "100%"}} onClick={() => open(dashboardUrl)}>
                Open Web Dashboard {targetEnvironment === "cloud" && "(via Tunnel)"}
              </button>
              <button className="secondary" style={{width: "100%"}} onClick={() => invoke("close_app")}>Exit Setup</button>
            </div>
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
            .map((s, idx) => (
              <li key={s.id} className={`step-indicator ${getStepStatus(s.id)}`}>
                <span className="step-number">{idx + 1}</span>
                {s.name}
              </li>
            ))}
        </ul>
      </aside>

      <main className="main-content">
        <div className="content-wrapper">
          {renderStep()}
        </div>
      </main>
    </div>
  );
}

export default App;