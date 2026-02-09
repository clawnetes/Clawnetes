import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/shell";
import "./App.css";

function App() {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState("basic"); // "basic" or "advanced"
  const [setupLocation, setSetupLocation] = useState<"local" | "remote">("local");
  const [remoteIp, setRemoteIp] = useState("");
  const [remoteUser, setRemoteUser] = useState("");
  const [remotePassword, setRemotePassword] = useState("");
  const [sshStatus, setSshStatus] = useState<"idle" | "checking" | "requesting_password" | "success" | "error">("idle");
  const [sshError, setSshError] = useState("");

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
    { id: 12, name: "Pairing" }
  ];

  useEffect(() => { 
    // Initial check just to see if local is already installed
    // but we don't force step 0 yet
    invoke("check_prerequisites").then((res: any) => {
      setChecks({
        node: res.node_installed,
        docker: res.docker_running,
        openclaw: res.openclaw_installed
      });
    });
  }, []);

  // Update default auth method when provider changes
  useEffect(() => {
    if (provider === "anthropic") setAuthMethod("token");
    else if (provider === "google") setAuthMethod("token");
    else if (provider === "openai") setAuthMethod("token");
    else setAuthMethod("token");
  }, [provider]);

  async function checkSystem() {
    setLoading(true);
    try {
      if (setupLocation === "local") {
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
        } else {
          setStep(2);
        }
      } else {
        // Remote check
        const res: any = await invoke("check_remote_prerequisites", {
          remote: { ip: remoteIp, user: remoteUser, password: remotePassword || null }
        });
        setChecks({
          node: res.node_installed,
          docker: res.docker_running,
          openclaw: res.openclaw_installed
        });
        const version: string = await invoke("get_remote_openclaw_version", {
          remote: { ip: remoteIp, user: remoteUser, password: remotePassword || null }
        });
        setOpenClawVersion(version);

        if (res.openclaw_installed) {
          setStep(0);
        } else {
          setStep(2);
        }
      }
    } catch (e) {
      console.error("System check failed:", e);
    }
    setLoading(false);
  }

  async function handleSshCheck() {
    if (!remoteIp || !remoteUser) return;
    setSshStatus("checking");
    setSshError("");
    try {
      const res: string = await invoke("test_ssh_connection", { 
        ip: remoteIp, 
        user: remoteUser, 
        password: remotePassword || null 
      });
      
      if (res === "auth_required") {
        setSshStatus("requesting_password");
      } else {
        setSshStatus("success");
      }
    } catch (e: any) {
      setSshStatus("error");
      setSshError(e.toString());
    }
  }

  async function handleInstall() {
    setLoading(true);
    setError(false);
    setProgress("Starting setup...");
    try {
      if (setupLocation === "remote") {
        setProgress("Connecting and installing on remote server (this may take 2-3 minutes)...");
        setLogs("Starting remote setup...");
        const gatewayToken: string = await invoke("setup_remote_openclaw", {
          remote: { ip: remoteIp, user: remoteUser, password: remotePassword || null },
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
            service_keys: serviceKeys
          }
        });

        setProgress("Establishing SSH tunnel...");
        await invoke("start_ssh_tunnel", {
          remote: { ip: remoteIp, user: remoteUser, password: remotePassword || null },
          localPort: 18789,
          remotePort: gatewayPort
        });

        setDashboardUrl(`http://127.0.0.1:18789/?token=${gatewayToken}`);
        setProgress("Finalizing...");
        const instruction: string = await invoke("generate_pairing_code");
        setPairingCode(instruction);
        setStep(12);
      } else {
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
            service_keys: serviceKeys
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

        const url: string = await invoke("get_dashboard_url");
        setDashboardUrl(url);

        setProgress("");
        setStep(11);
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
      await invoke("approve_pairing", { 
        code: pairingInput,
        remote: setupLocation === "remote" ? { ip: remoteIp, user: remoteUser, password: remotePassword || null } : null
      });
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
      const remote = { ip: remoteIp, user: remoteUser, password: remotePassword || null };
      
      if (setupLocation === "remote") {
        if (action === "repair") {
          res = await invoke("run_remote_doctor_repair", { remote });
          setMaintenanceStatus(`✅ Repair completed successfully on ${remoteIp}.`);
        } else if (action === "audit") {
          res = await invoke("run_remote_security_audit_fix", { remote });
          setMaintenanceStatus(`✅ Security Audit completed successfully on ${remoteIp}.`);
        } else if (action === "update") {
          // Check version first
          const current: string = await invoke("get_remote_openclaw_version", { remote });
          setLogs(prev => prev + `Current version: ${current}\n`);
          // This is a simplified check - in reality we'd compare with latest from npm
          // For now we'll just inform and proceed with install
          res = await invoke("update_remote_openclaw", { remote });
          setMaintenanceStatus(`✅ OpenClaw updated to latest on ${remoteIp}.`);
        } else {
          res = await invoke("uninstall_remote_openclaw", { remote });
          setChecks(prev => ({ ...prev, openclaw: false }));
          setMaintenanceStatus(`✅ Uninstall completed successfully from ${remoteIp}.`);
        }
      } else {
        if (action === "repair") {
          res = await invoke("run_doctor_repair");
          setMaintenanceStatus(`✅ Repair completed successfully.`);
        } else if (action === "audit") {
          res = await invoke("run_security_audit_fix");
          setMaintenanceStatus(`✅ Security Audit completed successfully.`);
        } else if (action === "update") {
          const current: string = await invoke("get_openclaw_version");
          setLogs(prev => prev + `Current version: ${current}\n`);
          res = await invoke("install_openclaw"); 
          setMaintenanceStatus(`✅ OpenClaw updated to latest.`);
        } else {
          res = await invoke("uninstall_openclaw");
          setChecks(prev => ({ ...prev, openclaw: false }));
          setMaintenanceStatus(`✅ Uninstall completed successfully.`);
        }
      }
      setLogs(prev => prev + (res || ""));
      setMaintCompleted(true);
    } catch (e) {
      setLogs(prev => prev + `\nError: ${e}`);
      setMaintenanceStatus(`❌ ${action} failed.`);
    }
    setLoading(false);
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
        await invoke("start_ssh_tunnel", {
          remote: { ip: remoteIp, user: remoteUser, password: remotePassword || null },
          localPort: 18789,
          remotePort: gatewayPort
        });
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

  const isOAuthMethod = (method: string) => {
    return ["antigravity", "gemini_cli", "codex"].includes(method);
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="step-view">
            <h2>Welcome Back</h2>
            <p className="step-description">OpenClaw is already installed on {setupLocation === "local" ? "your system" : `remote server ${remoteIp}`}. What would you like to do?</p>
            
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
                <p>Upgrade to the latest version of OpenClaw {setupLocation === "remote" ? "on the server" : ""}.</p>
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
                <p>Remove the OpenClaw CLI and all {setupLocation === "local" ? "local" : "remote"} configuration/data files.</p>
              </div>
            </div>

            {!loading && (
              <div style={{marginTop: "2rem", display: "flex", flexDirection: "column", gap: "1rem"}}>
                <div className="button-group" style={{marginTop: 0, gap: "10px"}}>
                  <button className="primary" style={{flex: 1}} onClick={() => {
                    if (selectedMaint === "reconfigure") setStep(3); // Skip environment & check
                    else if (selectedMaint === "uninstall") {
                      if (confirm(`Are you absolutely sure you want to completely remove OpenClaw from ${setupLocation === "local" ? "this system" : remoteIp}?`)) {
                        handleMaintenanceAction("uninstall");
                      }
                    } else {
                      handleMaintenanceAction(selectedMaint);
                    }
                  }}>Confirm Action</button>
                  {maintCompleted && (
                    <button className="secondary" style={{flex: 1}} onClick={() => invoke("close_app")}>Exit Setup</button>
                  )}
                </div>

                {setupLocation === "remote" && (
                  <div className="button-group" style={{marginTop: 0, gap: "10px"}}>
                    <button className="secondary" style={{flex: 1}} onClick={handleToggleTunnel}>
                      {tunnelActive ? "🔓 Disconnect SSH Tunnel" : "🔗 Establish SSH Tunnel"}
                    </button>
                    <button className="primary" style={{flex: 1}} onClick={async () => {
                      if (setupLocation === "remote") {
                        try {
                          const token = await invoke("get_remote_gateway_token", {
                            remote: { ip: remoteIp, user: remoteUser, password: remotePassword || null }
                          });
                          open(`http://127.0.0.1:18789/?token=${token}`);
                        } catch (e) {
                          setMaintenanceStatus(`❌ Error fetching remote token: ${e}`);
                        }
                      } else {
                        const url = await invoke("get_dashboard_url");
                        open(url as string);
                      }
                    }} disabled={!tunnelActive && setupLocation === "remote"}>
                      🚀 Open Dashboard
                    </button>
                  </div>
                )}
              </div>
            )}

            {maintenanceStatus && (
              <div className="progress-container" style={{marginTop: "2rem"}}>
                <p style={{fontSize: "0.9rem", color: maintenanceStatus.includes("❌") ? "var(--error)" : "var(--primary)"}}>{maintenanceStatus}</p>
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
            <p className="step-description">Where would you like to install and run OpenClaw?</p>
            <div className="mode-card-container">
              <div className={`mode-card ${setupLocation === "local" ? "active" : ""}`} onClick={() => setSetupLocation("local")}>
                <h3>Local Machine</h3>
                <p>Install on this computer (macOS). Best for personal use.</p>
              </div>
              <div className={`mode-card ${setupLocation === "remote" ? "active" : ""}`} onClick={() => setSetupLocation("remote")}>
                <h3>Remote Server</h3>
                <p>Install on a Linux server via SSH. Best for 24/7 availability.</p>
              </div>
            </div>

            {setupLocation === "remote" && (
              <div className="remote-config animate-fadeIn" style={{marginTop: "2rem"}}>
                <div className="form-group">
                  <label>Server IP Address</label>
                  <input placeholder="e.g. 1.2.3.4" value={remoteIp} onChange={(e) => setRemoteIp(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>SSH Username</label>
                  <input 
                    autoCapitalize="none" 
                    autoCorrect="off" 
                    spellCheck="false" 
                    autoComplete="off" 
                    placeholder="e.g. root or ubuntu" 
                    value={remoteUser} 
                    onChange={(e) => setRemoteUser(e.target.value)} 
                  />
                </div>
                
                {sshStatus === "requesting_password" && (
                  <div className="form-group animate-fadeIn">
                    <label>SSH Password</label>
                    <input type="password" placeholder="Enter password" value={remotePassword} onChange={(e) => setRemotePassword(e.target.value)} />
                    <p className="input-hint">Using a password is less secure than SSH keys, but we support it for initial setup.</p>
                  </div>
                )}

                {sshStatus === "error" && (
                  <p className="error" style={{color: "var(--error)", fontSize: "0.9rem", marginTop: "1rem"}}>{sshError}</p>
                )}

                {sshStatus === "success" && (
                  <p className="success" style={{color: "var(--success)", fontSize: "0.9rem", marginTop: "1rem"}}>✅ Connected to remote server!</p>
                )}

                <button 
                  className="secondary" 
                  style={{width: "100%", marginTop: "1rem"}} 
                  onClick={handleSshCheck}
                  disabled={sshStatus === "checking" || !remoteIp || !remoteUser}
                >
                  {sshStatus === "checking" ? "Connecting..." : (sshStatus === "requesting_password" ? "Retry with Password" : "Test Connection")}
                </button>
              </div>
            )}

            <div className="button-group" style={{marginTop: "2rem"}}>
              <button 
                className="primary" 
                disabled={loading || (setupLocation === "remote" && sshStatus !== "success")} 
                onClick={checkSystem}
              >
                {loading ? "Checking..." : "Continue"}
              </button>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="step-view">
            <h2>System Check: {setupLocation === "local" ? "Local" : "Remote"}</h2>
            <p className="step-description">Verifying requirements on {setupLocation === "local" ? "your machine" : remoteIp}.</p>
            <div className="check-item">
              <span className="check-status">{checks.node ? "✅" : "❌"}</span>
              Node.js {checks.node ? "detected" : "not found"}
            </div>
            <div className="check-item">
              <span className="check-status">{checks.openclaw ? "✅" : "⏳"}</span>
              OpenClaw {checks.openclaw ? "Installed" : "Ready to install"}
            </div>
            {setupLocation === "local" && !checks.node && (
              <p className="error" style={{marginTop: "1rem", color: "var(--error)"}}>
                Please install Node.js (v18+) on your local machine to continue.
              </p>
            )}
            {setupLocation === "remote" && !checks.node && (
              <p className="input-hint" style={{marginTop: "1rem", color: "var(--primary)"}}>
                ℹ️ Node.js will be automatically installed on the remote server during setup.
              </p>
            )}
            <div className="button-group">
              <button className="primary" disabled={setupLocation === "local" && !checks.node} onClick={() => setStep(3)}>Continue</button>
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
              <input 
                autoFocus 
                autoCapitalize="none" 
                autoCorrect="off" 
                spellCheck="false" 
                autoComplete="off" 
                placeholder="e.g. David" 
                value={userName} 
                onChange={(e) => setUserName(e.target.value)} 
              />
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
                    handleInstall();
                  }
                }}
              >
                {currentServiceIdx < servicesToConfigure.length - 1 ? "Next Service" : (loading ? "Installing..." : "Finish Installation")}
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
            <h2>Setup Complete! 🦞</h2>
            <p style={{fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem"}}>OpenClaw {openClawVersion}</p>
            <p className="step-description">OpenClaw is running and ready for your commands.</p>

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
                     autoCapitalize="none"
                     autoCorrect="off"
                     spellCheck="false"
                     autoComplete="off"
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
              <button className="primary" style={{width: "100%"}} onClick={() => open(dashboardUrl)}>Open Web Dashboard</button>
              <button className="secondary" style={{width: "100%"}} onClick={() => invoke("close_app")}>Exit Setup</button>
            </div>
            <p style={{ marginTop: "2rem", fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "center" }}>
              Terminal access: <code>openclaw tui</code>
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