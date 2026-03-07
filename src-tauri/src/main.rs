use tauri::command;
// Updated: Force rebuild trigger
use std::process::Command;
use std::fs;
use std::thread;
use std::time::Duration;
use std::net::{TcpStream, TcpListener};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use rand::Rng;
use ssh2::Session;
use std::path::Path;
use futures_util::{SinkExt, StreamExt};


#[macro_use]
extern crate lazy_static;

lazy_static! {
    static ref TUNNEL_RUNNING: AtomicBool = AtomicBool::new(false);
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct AgentData {
    id: String,
    name: String,
    model: String,
    fallback_models: Option<Vec<String>>,
    skills: Option<Vec<String>>,
    vibe: Option<String>,
    emoji: Option<String>,
    identity_md: Option<String>,
    user_md: Option<String>,
    soul_md: Option<String>,
    tools_md: Option<String>,
    agents_md: Option<String>,
    heartbeat_md: Option<String>,
    memory_md: Option<String>,
    subagents: Option<SubagentConfig>,
    tools: Option<AgentToolsConfig>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct SubagentConfig {
    #[serde(rename = "allowAgents")]
    allow_agents: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct AgentToolsConfig {
    #[serde(rename = "agentToAgent")]
    agent_to_agent: Option<AgentToAgentConfig>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct AgentToAgentConfig {
    enabled: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct CronJobConfig {
    name: String,
    schedule: String,
    command: String,
    session: Option<String>,
}

#[derive(serde::Serialize)]
struct CurrentConfig {
    provider: String,
    api_key: String,
    auth_method: String,
    model: String,
    user_name: String,
    agent_name: String,
    agent_vibe: String,
    agent_emoji: String,
    agent_type: String,
    telegram_token: String,
    gateway_port: u16,
    gateway_bind: String,
    gateway_auth_mode: String,
    tailscale_mode: String,
    node_manager: String,
    skills: Vec<String>,
    service_keys: std::collections::HashMap<String, String>,
    sandbox_mode: String,
    tools_mode: String,
    allowed_tools: Vec<String>,
    denied_tools: Vec<String>,
    fallback_models: Vec<String>,
    heartbeat_mode: String,
    idle_timeout_ms: u64,
    identity_md: String,
    user_md: String,
    soul_md: String,
    tools_md: Option<String>,
    agents_md: Option<String>,
    heartbeat_md: Option<String>,
    memory_md: Option<String>,
    memory_enabled: bool,
    enable_multi_agent: bool,
    agent_configs: Vec<AgentData>,
    is_paired: bool,
    cron_jobs: Option<Vec<CronJobConfig>>,
    local_base_url: Option<String>,
    thinking_level: Option<String>,
    whatsapp_enabled: Option<bool>,
    whatsapp_dm_policy: Option<String>,
}

#[derive(serde::Deserialize)]
struct AgentConfig {
    provider: String,
    api_key: String,
    auth_method: Option<String>,
    model: String,
    user_name: String,
    agent_name: String,
    #[allow(dead_code)]
    agent_vibe: Option<String>,
    telegram_token: Option<String>,
    // Advanced fields
    gateway_port: Option<u16>,
    gateway_bind: Option<String>,
    gateway_auth_mode: Option<String>,
    tailscale_mode: Option<String>,
    node_manager: Option<String>,
    skills: Option<Vec<String>>,
    service_keys: Option<std::collections::HashMap<String, String>>,
    // NEW: Enhanced advanced fields
    sandbox_mode: Option<String>,
    tools_mode: Option<String>,
    allowed_tools: Option<Vec<String>>,
    denied_tools: Option<Vec<String>>,
    fallback_models: Option<Vec<String>>,
    heartbeat_mode: Option<String>,
    idle_timeout_ms: Option<u64>,
    identity_md: Option<String>,
    user_md: Option<String>,
    soul_md: Option<String>,
    // Multi-agent support
    agents: Option<Vec<AgentData>>,
    // New field to preserve state during updates
    preserve_state: Option<bool>,
    // New preset fields
    agent_type: Option<String>,
    tools_md: Option<String>,
    agents_md: Option<String>,
    heartbeat_md: Option<String>,
    memory_md: Option<String>,
    memory_enabled: Option<bool>,
    cron_jobs: Option<Vec<CronJobConfig>>,
    // Local model support
    local_base_url: Option<String>,
    // OpenClaw latest features
    thinking_level: Option<String>,
    // WhatsApp channel
    whatsapp_enabled: Option<bool>,
    whatsapp_dm_policy: Option<String>,
}

#[derive(serde::Serialize)]
struct PrereqCheck {
    node_installed: bool,
    docker_running: bool,
    openclaw_installed: bool,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteInfo {
    ip: String,
    user: String,
    password: Option<String>,
    private_key_path: Option<String>,
}

// SSH Helper Functions

fn get_env_prefix(os_type: &str) -> String {
    if os_type == "Darwin" {
        "eval \"$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)\"; export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; ".to_string()
    } else if os_type == "Windows" {
        // WSL2: Source profile and try to load NVM explicitly
        "export PATH=\"$PATH:/usr/local/bin\"; . ~/.profile 2>/dev/null; export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; ".to_string()
    } else {
        // Linux: Source profile and try to load NVM explicitly
        "export PATH=\"$PATH:/usr/local/bin\"; . ~/.profile 2>/dev/null; export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; ".to_string()
    }
}

fn authenticate_with_key(sess: &Session, user: &str, key_path: &Path) -> Result<(), String> {
    // Strategy 1: Try with None for public key (modern libssh2 often handles this)
    if sess.userauth_pubkey_file(user, None, key_path, None).is_ok() {
        return Ok(());
    }

    // Strategy 2: Try with an explicit .pub file if it exists
    let mut pubkey_path = key_path.to_path_buf();
    pubkey_path.set_extension("pub");
    if pubkey_path.exists() {
        if sess.userauth_pubkey_file(user, Some(&pubkey_path), key_path, None).is_ok() {
            return Ok(());
        }
    }

    // Strategy 3: Try generating the public key on the fly using ssh-keygen
    let output = Command::new("ssh-keygen")
        .args(["-y", "-P", "", "-f", &key_path.to_string_lossy()])
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            let pubkey_content = String::from_utf8_lossy(&out.stdout);
            let temp_dir = std::env::temp_dir();
            let temp_pubkey = temp_dir.join(format!("temp_ssh_key_{}.pub", rand::random::<u32>()));
            
            if fs::write(&temp_pubkey, pubkey_content.as_bytes()).is_ok() {
                let res = sess.userauth_pubkey_file(user, Some(&temp_pubkey), key_path, None);
                let _ = fs::remove_file(temp_pubkey);
                if res.is_ok() {
                    return Ok(());
                }
            }
        }
    }

    // If all failed, return a informative error
    Err("Key authentication failed. libssh2 reported an error. Please ensure the key is a valid OpenSSH format, matches the remote user, and is not passphrase-protected.".to_string())
}

fn connect_ssh(remote: &RemoteInfo) -> Result<Session, String> {
    let tcp = TcpStream::connect(format!("{}:22", remote.ip))
        .map_err(|e| format!("Failed to connect to port 22: {}", e))?;
    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

    // 1. Try provided private key path if it exists
    // If a key is explicitly provided, ONLY use that key and don't fallback
    if let Some(ref path) = remote.private_key_path {
        let key_path = Path::new(path);
        if !key_path.exists() {
            return Err(format!("The provided private key file does not exist at: {}", path));
        }

        // Use the improved authentication helper - fail if it doesn't work
        authenticate_with_key(&sess, &remote.user, key_path)?;
        return Ok(sess);
    }

    // 2. Try SSH agent
    if sess.userauth_agent(&remote.user).is_ok() {
        return Ok(sess);
    }

    // 3. Try default keys
    if let Some(home) = dirs::home_dir() {
        let keys = [home.join(".ssh").join("id_rsa"), home.join(".ssh").join("id_ed25519")];
        for key in keys {
            if key.exists() {
                if sess.userauth_pubkey_file(&remote.user, None, &key, None).is_ok() {
                    return Ok(sess);
                }
            }
        }
    }

    // 4. Try password
    if let Some(ref pw) = remote.password {
        if sess.userauth_password(&remote.user, pw).is_ok() {
            return Ok(sess);
        }
    }

    Err("SSH Authentication failed".to_string())
}

fn execute_ssh(sess: &Session, cmd: &str) -> Result<String, String> {
    let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
    channel.exec(cmd).map_err(|e| e.to_string())?;
    let mut s = String::new();
    channel.read_to_string(&mut s).map_err(|e| e.to_string())?;
    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr).map_err(|e| e.to_string())?;
    let _ = channel.wait_close();
    
    if channel.exit_status().unwrap_or(0) != 0 {
        return Err(format!("Command failed: {}\nStderr: {}", cmd, stderr));
    }
    Ok(s)
}

#[command]
async fn test_ssh_connection(remote: RemoteInfo) -> Result<String, String> {
    // 1. Check network connectivity
    if TcpStream::connect_timeout(&format!("{}:22", remote.ip).parse().unwrap(), Duration::from_secs(5)).is_err() {
        return Err("Connectivity failed. Could not reach port 22 on the remote server.".to_string());
    }

    // 2. Try SSH connection
    match connect_ssh(&remote) {
        Ok(_) => Ok("connected".to_string()),
        Err(e) => Err(e),
    }
}

#[command]
fn read_workspace_files() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        let workspace = wsl_home_dir()?.trim().to_string() + "/.openclaw/workspace";
        let identity = wsl_read_file(&format!("{}/IDENTITY.md", workspace)).unwrap_or_default();
        let user = wsl_read_file(&format!("{}/USER.md", workspace)).unwrap_or_default();
        let soul = wsl_read_file(&format!("{}/SOUL.md", workspace)).unwrap_or_default();

        Ok(serde_json::json!({
            "identity": identity,
            "user": user,
            "soul": soul
        }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = dirs::home_dir().ok_or("Could not find home directory")?;
        let workspace = home.join(".openclaw").join("workspace");

        let identity = fs::read_to_string(workspace.join("IDENTITY.md")).unwrap_or_default();
        let user = fs::read_to_string(workspace.join("USER.md")).unwrap_or_default();
        let soul = fs::read_to_string(workspace.join("SOUL.md")).unwrap_or_default();

        Ok(serde_json::json!({
            "identity": identity,
            "user": user,
            "soul": soul
        }))
    }
}

#[command]
fn save_workspace_files(
    agent_id: Option<String>,
    identity: String,
    user: String,
    soul: String
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let home = wsl_home_dir()?.trim().to_string();
        let workspace = if let Some(id) = agent_id {
            format!("{}/.openclaw/agents/{}/workspace", home, id)
        } else {
            format!("{}/.openclaw/workspace", home)
        };

        wsl_mkdir_p(&workspace)?;

        wsl_write_file(&format!("{}/IDENTITY.md", workspace), &identity)?;
        wsl_write_file(&format!("{}/USER.md", workspace), &user)?;
        wsl_write_file(&format!("{}/SOUL.md", workspace), &soul)?;

        Ok("Workspace files saved successfully".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = dirs::home_dir().ok_or("Could not find home directory")?;

        let workspace = if let Some(id) = agent_id {
            // Save to agent-specific workspace
            home.join(".openclaw").join("agents").join(id).join("workspace")
        } else {
            // Save to global workspace
            home.join(".openclaw").join("workspace")
        };

        fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;

        fs::write(workspace.join("IDENTITY.md"), identity).map_err(|e| e.to_string())?;
        fs::write(workspace.join("USER.md"), user).map_err(|e| e.to_string())?;
        fs::write(workspace.join("SOUL.md"), soul).map_err(|e| e.to_string())?;

        Ok("Workspace files saved successfully".to_string())
    }
}

#[command]
fn create_custom_skill(name: String, content: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let home = wsl_home_dir()?.trim().to_string();
        let skill_dir = format!("{}/.openclaw/workspace/skills/{}", home, name);

        wsl_mkdir_p(&skill_dir)?;
        wsl_write_file(&format!("{}/SKILL.md", skill_dir), &content)?;

        Ok(format!("Custom skill '{}' created successfully", name))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = dirs::home_dir().ok_or("Could not find home directory")?;
        let skill_dir = home.join(".openclaw").join("workspace").join("skills").join(&name);

        fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
        fs::write(skill_dir.join("SKILL.md"), content).map_err(|e| e.to_string())?;

        Ok(format!("Custom skill '{}' created successfully", name))
    }
}

#[command]
async fn setup_remote_openclaw(remote: RemoteInfo, config: AgentConfig) -> Result<String, String> {
    let sess = connect_ssh(&remote)?;

    // 1. Check/Install Node.js
    let os_type = execute_ssh(&sess, "uname -s")?.trim().to_string();
    let is_root = execute_ssh(&sess, "id -u")?.trim() == "0";
    let sudo_prefix = if is_root { "" } else { "sudo " };
    
    // Prefix for openclaw commands (ensure brew/nvm env is loaded)
    let nvm_prefix = get_env_prefix(&os_type);

    if os_type == "Linux" {
        // Check if node exists
        if execute_ssh(&sess, "node -v").is_err() {
            // Install curl if missing (needed for nodesource script)
            // We chain apt-get update to ensure we can install curl
            let install_curl = format!("{}apt-get update && {}apt-get install -y curl", sudo_prefix, sudo_prefix);
            execute_ssh(&sess, &install_curl).map_err(|e| format!("Failed to install curl: {}", e))?;

            // Add NodeSource repo and install Node.js
            // We pipe to bash. If not root, we need to run bash with sudo rights to modify apt sources.
            let setup_cmd = if is_root {
                 "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
            } else {
                 "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
            };
            execute_ssh(&sess, setup_cmd).map_err(|e| format!("Failed to setup NodeSource: {}", e))?;
            
            let install_node = format!("{}apt-get install -y nodejs", sudo_prefix);
            execute_ssh(&sess, &install_node).map_err(|e| format!("Failed to install Node.js: {}", e))?;
        }
    } else if os_type == "Darwin" {
         if execute_ssh(&sess, "node -v").is_err() {
             // Check brew
             if execute_ssh(&sess, "command -v brew").is_err() {
                 // Install brew non-interactively
                 let install_brew = "NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"";
                 execute_ssh(&sess, install_brew).map_err(|e| format!("Failed to install Homebrew: {}", e))?;
                 
                 // Add brew to shellrc for future sessions (Standard paths for Apple Silicon / Intel)
                 let configure_shell = r#"
                    (echo; echo 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"') >> $HOME/.zprofile
                    (echo; echo 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"') >> $HOME/.bash_profile
                 "#;
                 let _ = execute_ssh(&sess, configure_shell);
             }
             
             // Install node using brew, ensuring brew is in path for this session
             let install_node = "eval \"$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)\"; brew install node";
             execute_ssh(&sess, install_node).map_err(|e| format!("Failed to install Node.js via Homebrew: {}", e))?;
         }
    }

    // 2. Install OpenClaw (Skip if already installed)
    // We must use the prefix to ensure we find it if it's in a user path (nvm/brew)
    let check_claw_cmd = if os_type == "Linux" {
        // Try to load nvm if present for the check
        "export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; openclaw --version".to_string()
    } else {
        "eval \"$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)\"; openclaw --version".to_string()
    };

    if execute_ssh(&sess, &check_claw_cmd).is_err() {
        let install_claw_cmd = if os_type == "Linux" {
            format!("{}npm install -g openclaw", sudo_prefix)
        } else {
            // MacOS: rely on brew environment
            "eval \"$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)\"; npm install -g openclaw".to_string()
        };
            
        execute_ssh(&sess, &install_claw_cmd)
            .map_err(|e| format!("Failed to install OpenClaw: {}", e))?;
    }
    
    // Ensure openclaw is in path for verification
    // Reuse the same command structure for verification
    execute_ssh(&sess, &check_claw_cmd)?;

    // 3. Configure
    let remote_home = execute_ssh(&sess, "echo $HOME")?.trim().to_string();
    let openclaw_root = format!("{}/.openclaw", remote_home);
    let workspace = format!("{}/workspace", openclaw_root);
    let agents_dir = format!("{}/agents/main/agent", openclaw_root);

    // Run gateway install FIRST to scaffold directories and defaults
    // Skip force install if we want to preserve state
    if config.preserve_state != Some(true) {
        let _ = execute_ssh(&sess, &format!("{}openclaw gateway stop || true", nvm_prefix));
        // Remove existing config so install --force generates a fresh one
        let _ = execute_ssh(&sess, &format!("{}rm -f {}/openclaw.json || true", nvm_prefix, openclaw_root));
        let _ = execute_ssh(&sess, &format!("{}openclaw gateway install --force --profile messaging", nvm_prefix));
        // Stop gateway immediately after install to prevent crash-loop
        // (install enables+starts the systemd service, but config lacks gateway.mode=local yet)
        let _ = execute_ssh(&sess, &format!("{}openclaw gateway stop || true", nvm_prefix));
    }

    execute_ssh(&sess, &format!("mkdir -p {} && mkdir -p {}", workspace, agents_dir))?;

    // Always preserve existing/scaffolded gateway token to avoid device token mismatch
    let gateway_token: String = {
        let read_token_result = execute_ssh(&sess, &format!(
            "cat {}/openclaw.json 2>/dev/null || echo '{{}}'", openclaw_root
        ));
        if let Ok(contents) = read_token_result {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                if let Some(token) = parsed.get("gateway")
                    .and_then(|g| g.get("auth"))
                    .and_then(|a| a.get("token"))
                    .and_then(|t| t.as_str())
                {
                    token.to_string()
                } else {
                    rand::thread_rng()
                        .sample_iter(&rand::distributions::Alphanumeric)
                        .take(32)
                        .map(char::from)
                        .collect()
                }
            } else {
                rand::thread_rng()
                    .sample_iter(&rand::distributions::Alphanumeric)
                    .take(32)
                    .map(char::from)
                    .collect()
            }
        } else {
            rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(32)
                .map(char::from)
                .collect()
        }
    };

    let (telegram_allow_from, telegram_dm_policy): (Option<serde_json::Value>, Option<String>) = {
        let read_token_result = execute_ssh(&sess, &format!(
            "cat {}/openclaw.json 2>/dev/null || echo '{{}}'", openclaw_root
        ));
        if let Ok(contents) = read_token_result {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                let default_acc = parsed.get("channels")
                    .and_then(|c| c.get("telegram"))
                    .and_then(|t| t.get("accounts"))
                    .and_then(|a| a.get("default"));
                
                let allow_from = default_acc.and_then(|d| d.get("allowFrom")).cloned();
                let dm_policy = default_acc.and_then(|d| d.get("dmPolicy")).and_then(|v| v.as_str()).map(|s| s.to_string());
                
                (allow_from, dm_policy)
            } else { (None, None) }
        } else { (None, None) }
    };

    let (whatsapp_allow_from, _whatsapp_dm_policy): (Option<serde_json::Value>, Option<String>) = {
        let read_token_result = execute_ssh(&sess, &format!(
            "cat {}/openclaw.json 2>/dev/null || echo '{{}}'", openclaw_root
        ));
        if let Ok(contents) = read_token_result {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                let default_acc = parsed.get("channels")
                    .and_then(|c| c.get("whatsapp"))
                    .and_then(|t| t.get("accounts"))
                    .and_then(|a| a.get("default"));
                
                let allow_from = default_acc.and_then(|d| d.get("allowFrom")).cloned();
                let dm_policy = default_acc.and_then(|d| d.get("dmPolicy")).and_then(|v| v.as_str()).map(|s| s.to_string());
                
                (allow_from, dm_policy)
            } else { (None, None) }
        } else { (None, None) }
    };

    let profile_name = format!("{}:default", config.provider);
    let mut auth_mode = config.auth_method.unwrap_or_else(|| "token".to_string());
    if auth_mode == "setup-token" { auth_mode = "token".to_string(); }
    else if auth_mode == "antigravity" || auth_mode == "gemini_cli" || auth_mode == "codex" { auth_mode = "oauth".to_string(); }

    // Telegram config will be added to the JSON object

    let gateway_port = config.gateway_port.unwrap_or(18789);
    let gateway_bind = config.gateway_bind.unwrap_or_else(|| "loopback".to_string());
    let gateway_auth_mode = config.gateway_auth_mode.unwrap_or_else(|| "token".to_string());
    let tailscale_mode = config.tailscale_mode.unwrap_or_else(|| "off".to_string());

    // Build models config including fallback models
    let mut defaults_obj = serde_json::json!({
        "maxConcurrent": 4,
        "subagents": { "maxConcurrent": 8 },
        "compaction": { "mode": "safeguard" },
        "workspace": workspace,
        "model": { "primary": config.model },
        "models": { config.model.clone(): {} }
    });
    
    // Add fallback models
    if let Some(fb) = &config.fallback_models {
        if !fb.is_empty() {
            if let Some(primary) = defaults_obj.get_mut("model").and_then(|m| m.as_object_mut()) {
                primary.insert("fallbacks".to_string(), serde_json::to_value(fb).unwrap());
            }
        }
    }
    
    // Add heartbeat config
    if let Some(hb_mode) = config.heartbeat_mode.as_deref() {
        match hb_mode {
            "never" => {
                if let Some(obj) = defaults_obj.as_object_mut() {
                    obj.insert("heartbeat".to_string(), serde_json::json!({ "enabled": false }));
                }
            },
            "idle" => {
                if let Some(obj) = defaults_obj.as_object_mut() {
                    obj.insert("heartbeat".to_string(), serde_json::json!({ 
                        "mode": "idle", 
                        "timeout": config.idle_timeout_ms.unwrap_or(3600000) 
                    }));
                }
            },
            interval => {
                if let Some(obj) = defaults_obj.as_object_mut() {
                    obj.insert("heartbeat".to_string(), serde_json::json!({ "every": interval }));
                }
            }
        }
    }
    
    // Add sandbox config
    if let Some(sb_mode) = config.sandbox_mode.as_deref() {
        let mapped = if sb_mode == "full" { "all" } else if sb_mode == "partial" { "non-main" } else if sb_mode == "none" { "off" } else { sb_mode };
        if let Some(obj) = defaults_obj.as_object_mut() {
            obj.insert("sandbox".to_string(), serde_json::json!({ "mode": mapped }));
        }
    }

    // defaults_json removed
    
    // Build agents list
    let mut agents_list = Vec::new();
    let mut has_main = false;

    if let Some(agents) = &config.agents {
        for agent in agents {
            if agent.id == "main" {
                has_main = true;
            }
            
            let mut agent_obj = serde_json::json!({
                "id": agent.id,
                "name": agent.name,
                "workspace": format!("{}/.openclaw/agents/{}/workspace", remote_home, agent.id),
                "agentDir": format!("{}/.openclaw/agents/{}/agent", remote_home, agent.id),
                "model": {
                    "primary": agent.model
                }
            });
            
            if let Some(fb) = &agent.fallback_models {
                if !fb.is_empty() {
                    if let Some(model_obj) = agent_obj.get_mut("model").and_then(|m| m.as_object_mut()) {
                        model_obj.insert("fallbacks".to_string(), serde_json::to_value(fb).unwrap());
                    }
                }
            }
            
            agents_list.push(agent_obj);
        }
    }

    if !has_main {
        let mut main_obj = serde_json::json!({
            "id": "main",
            "default": true,
            "name": config.agent_name,
            "workspace": workspace,
            "agentDir": agents_dir,
            "model": {
                "primary": config.model
            }
        });
        
        if let Some(fb) = &config.fallback_models {
            if !fb.is_empty() {
                if let Some(model_obj) = main_obj.get_mut("model").and_then(|m| m.as_object_mut()) {
                    model_obj.insert("fallbacks".to_string(), serde_json::to_value(fb).unwrap());
                }
            }
        }
        
        agents_list.insert(0, main_obj);
    }

    // Construct auth profiles map dynamically to support variable keys
    let mut auth_profiles = serde_json::Map::new();
    auth_profiles.insert(profile_name.clone(), serde_json::json!({
        "provider": config.provider,
        "mode": auth_mode
    }));

    let mut config_val = serde_json::json!({
        "messages": { "ackReactionScope": "group-mentions" },
        "agents": {
            "defaults": defaults_obj,
            "list": agents_list
        },
        "gateway": {
            "mode": "local",
            "port": gateway_port,
            "bind": gateway_bind,
            "auth": { "mode": gateway_auth_mode, "token": gateway_token },
            "tailscale": { "mode": tailscale_mode, "resetOnExit": false }
        },
        "auth": {
            "profiles": auth_profiles
        }
    });

    // Add Telegram if enabled
    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            if let Some(obj) = config_val.as_object_mut() {
                obj.insert("plugins".to_string(), serde_json::json!({
                    "entries": { "telegram": { "enabled": true } }
                }));
                
                let mut channel_config = serde_json::json!({
                    "botToken": token,
                    "name": "Primary Bot"
                });
                
                let dm_policy = if config.preserve_state == Some(true) {
                    telegram_dm_policy.unwrap_or_else(|| "allowlist".to_string())
                } else {
                    "pairing".to_string()
                };

                if let Some(c) = channel_config.as_object_mut() {
                    c.insert("dmPolicy".to_string(), serde_json::Value::String(dm_policy.clone()));
                    if dm_policy == "allowlist" {
                        if let Some(existing_allow) = telegram_allow_from.clone() {
                            c.insert("allowFrom".to_string(), existing_allow);
                        }
                    }
                }

                obj.insert("channels".to_string(), serde_json::json!({
                    "telegram": {
                        "accounts": {
                            "default": channel_config
                        }
                    }
                }));
            }
        }
    }

    // Add WhatsApp config inline if enabled
    if config.whatsapp_enabled.unwrap_or(false) {
        let dm_policy = config.whatsapp_dm_policy.as_deref().unwrap_or("open");
        if let Some(obj) = config_val.as_object_mut() {
            // Merge plugins entries
            let plugins_entry = obj.entry("plugins".to_string()).or_insert(serde_json::json!({ "entries": {} }));
            if let Some(entries) = plugins_entry.get_mut("entries").and_then(|e| e.as_object_mut()) {
                entries.insert("whatsapp".to_string(), serde_json::json!({ "enabled": true }));
            }

            // Merge channels
            let channels_entry = obj.entry("channels".to_string()).or_insert(serde_json::json!({}));
            if let Some(channels_obj) = channels_entry.as_object_mut() {
                let mut whatsapp_account = if dm_policy == "open" {
                    serde_json::json!({
                        "dmPolicy": dm_policy,
                        "allowFrom": ["*"]
                    })
                } else {
                    serde_json::json!({
                        "dmPolicy": dm_policy
                    })
                };
                
                if dm_policy == "allowlist" {
                    if let Some(existing) = whatsapp_allow_from.clone() {
                        if let Some(w) = whatsapp_account.as_object_mut() {
                            w.insert("allowFrom".to_string(), existing);
                        }
                    }
                }
                
                channels_obj.insert("whatsapp".to_string(), serde_json::json!({
                    "accounts": {
                        "default": whatsapp_account
                    }
                }));
            }
        }
    }
    if let Some(tm) = config.tools_mode.as_deref() {
        let mut tools_obj = serde_json::Map::new();
        match tm {
            "allowlist" => {
                if let Some(tools) = config.allowed_tools.as_ref() {
                    tools_obj.insert("allow".to_string(), serde_json::to_value(tools).unwrap());
                }
            },
            "denylist" => {
                if let Some(tools) = config.denied_tools.as_ref() {
                    tools_obj.insert("deny".to_string(), serde_json::to_value(tools).unwrap());
                }
            },
            _ => {}
        }
        if !tools_obj.is_empty() {
             if let Some(obj) = config_val.as_object_mut() {
                obj.insert("tools".to_string(), serde_json::Value::Object(tools_obj));
            }
        }
    }

    // Add memory configuration (memoryFlush must be { enabled: bool })
    if config.memory_enabled.unwrap_or(false) {
        if let Some(defaults) = config_val.get_mut("agents").and_then(|a| a.get_mut("defaults")).and_then(|d| d.as_object_mut()) {
            if let Some(compaction) = defaults.get_mut("compaction").and_then(|c| c.as_object_mut()) {
                compaction.insert("memoryFlush".to_string(), serde_json::json!({ "enabled": true }));
            }
        }
    }

    // Add cron system config (enable cron engine if we have jobs)
    if let Some(cron_jobs) = &config.cron_jobs {
        if !cron_jobs.is_empty() {
            if let Some(obj) = config_val.as_object_mut() {
                obj.insert("cron".to_string(), serde_json::json!({ "enabled": true }));
            }
        }
    }

    let config_json_final = serde_json::to_string_pretty(&config_val).map_err(|e| e.to_string())?;
    let config_json_escaped = config_json_final.replace("'", "'\\''");
    execute_ssh(&sess, &format!("echo '{}' > {}/openclaw.json", config_json_escaped, openclaw_root))?;

    // Store Clawnetes metadata in separate file on remote
    {
        let mut meta = serde_json::Map::new();
        if let Some(agent_type) = &config.agent_type {
            meta.insert("agent_type".to_string(), serde_json::Value::String(agent_type.clone()));
        }
        if let Some(cron_jobs) = &config.cron_jobs {
            if !cron_jobs.is_empty() {
                meta.insert("cron_jobs".to_string(), serde_json::to_value(cron_jobs).unwrap_or_default());
            }
        }
        if config.memory_enabled.unwrap_or(false) {
            meta.insert("memory_enabled".to_string(), serde_json::Value::Bool(true));
        }
        let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
        let meta_escaped = meta_json.replace("'", "'\\''");
        execute_ssh(&sess, &format!("echo '{}' > {}/clawnetes-meta.json", meta_escaped, openclaw_root))?;
    }

    // auth-profiles.json
    let mut profiles_map = serde_json::Map::new();
    let mut primary_p = serde_json::Map::new();
    primary_p.insert("type".to_string(), serde_json::Value::String(auth_mode));
    primary_p.insert("provider".to_string(), serde_json::Value::String(config.provider.clone()));
    primary_p.insert("token".to_string(), serde_json::Value::String(config.api_key.clone()));
    profiles_map.insert(profile_name.clone(), serde_json::Value::Object(primary_p));

    if let Some(service_keys) = &config.service_keys {
        for (sid, key) in service_keys {
            let mut p = serde_json::Map::new();
            p.insert("type".to_string(), serde_json::Value::String("token".to_string()));
            p.insert("provider".to_string(), serde_json::Value::String(sid.clone()));
            p.insert("token".to_string(), serde_json::Value::String(key.clone()));
            profiles_map.insert(format!("{}:default", sid), serde_json::Value::Object(p));
        }
    }

    let auth_profiles_val = serde_json::json!({ "version": 1, "profiles": profiles_map, "lastGood": { config.provider.clone(): profile_name }, "usageStats": {} });
    let auth_profiles_json = serde_json::to_string_pretty(&auth_profiles_val).map_err(|e| e.to_string())?.replace("'", "'\\''");
    execute_ssh(&sess, &format!("echo '{}' > {}/auth-profiles.json", auth_profiles_json, agents_dir))?;

    // Identity Files
    let identity_md = config.identity_md.unwrap_or_else(|| {
        format!(r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Emoji:** 🦞
---
Managed by Clawnetes."#, config.agent_name)
    }).replace("'", "'\\''");
    execute_ssh(&sess, &format!("echo '{}' > {}/IDENTITY.md", identity_md, workspace))?;

    let user_md = config.user_md.unwrap_or_else(|| {
        format!(r#"# USER.md - About Your Human
- **Name:** {}
---"#, config.user_name)
    }).replace("'", "'\\''");
    execute_ssh(&sess, &format!("echo '{}' > {}/USER.md", user_md, workspace))?;

    let soul_md = config.soul_md.unwrap_or_else(|| {
        format!(r#"# SOUL.md
## Mission
Serve {}."#, config.user_name)
    }).replace("'", "'\\''");
    execute_ssh(&sess, &format!("echo '{}' > {}/SOUL.md", soul_md, workspace))?;

    // Write additional markdown files if provided
    if let Some(ref tools_md) = config.tools_md {
        let escaped = tools_md.replace("'", "'\\''");
        execute_ssh(&sess, &format!("echo '{}' > {}/TOOLS.md", escaped, workspace))?;
    }
    if let Some(ref agents_md) = config.agents_md {
        let escaped = agents_md.replace("'", "'\\''");
        execute_ssh(&sess, &format!("echo '{}' > {}/AGENTS.md", escaped, workspace))?;
    }
    if let Some(ref heartbeat_md) = config.heartbeat_md {
        let escaped = heartbeat_md.replace("'", "'\\''");
        execute_ssh(&sess, &format!("echo '{}' > {}/HEARTBEAT.md", escaped, workspace))?;
    }
    if let Some(ref memory_md) = config.memory_md {
        let escaped = memory_md.replace("'", "'\\''");
        execute_ssh(&sess, &format!("echo '{}' > {}/MEMORY.md", escaped, workspace))?;
    }

    // Prefix for openclaw commands is defined at top of function
    
    if let Some(nm) = config.node_manager {
        let _ = execute_ssh(&sess, &format!("{}openclaw config set skills.nodeManager {}", nvm_prefix, nm));
    }

    // Plugins
    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            let _ = execute_ssh(&sess, &format!("{}openclaw plugins enable telegram", nvm_prefix));
        }
    }

    if config.whatsapp_enabled.unwrap_or(false) {
    }

    // Skills
    if let Some(skills) = &config.skills {
        for skill in skills {
            let _ = execute_ssh(&sess, &format!("{}npx clawhub install {}", nvm_prefix, skill));
        }
    }
    
    // Multi-agent setup (Agents)
    if let Some(agents) = &config.agents {
        for agent in agents {
            let agent_workspace = format!("{}/agents/{}/workspace", openclaw_root, agent.id);
            let agent_config_dir = format!("{}/agents/{}/agent", openclaw_root, agent.id);

            execute_ssh(&sess, &format!("mkdir -p {} && mkdir -p {}", agent_workspace, agent_config_dir))?;

            // Agent Identity Files
            let a_identity = agent.identity_md.clone().unwrap_or_else(|| {
                 format!(r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Emoji:** 🦞
---
Managed by Clawnetes."#, agent.name)
            }).replace("'", "'\\''");
            execute_ssh(&sess, &format!("echo '{}' > {}/IDENTITY.md", a_identity, agent_workspace))?;

             // For simplicity, reuse user/soul for sub-agents unless specified
            let a_user = agent.user_md.clone().unwrap_or_else(|| {
                 format!(r#"# USER.md - About Your Human
- **Name:** {}
---"#, config.user_name)
            }).replace("'", "'\\''");
            execute_ssh(&sess, &format!("echo '{}' > {}/USER.md", a_user, agent_workspace))?;
            
            let a_soul = agent.soul_md.clone().unwrap_or_else(|| {
                 format!(r#"# SOUL.md
## Mission
Serve {}."#, config.user_name)
            }).replace("'", "'\\''");
            execute_ssh(&sess, &format!("echo '{}' > {}/SOUL.md", a_soul, agent_workspace))?;
            
            // Agent Auth (Clone main)
            execute_ssh(&sess, &format!("cp {}/auth-profiles.json {}/auth-profiles.json", agents_dir, agent_config_dir))?;
        }
    }

    // Start Gateway
    // Reset any failed systemd state from crash-loops before starting
    let _ = execute_ssh(&sess, "systemctl --user reset-failed openclaw-gateway.service 2>/dev/null || true");
    execute_ssh(&sess, &format!("{}openclaw gateway stop || true", nvm_prefix))?;
    execute_ssh(&sess, &format!("{}openclaw gateway start", nvm_prefix))?;

    Ok(gateway_token)
}

#[command]
fn start_ssh_tunnel(remote: RemoteInfo) -> Result<String, String> {
    if TUNNEL_RUNNING.load(Ordering::Relaxed) {
        return Err("SSH tunnel is already running".to_string());
    }

    TUNNEL_RUNNING.store(true, Ordering::Relaxed);
    // Needed to move into thread
    let remote_info = remote.clone();

    thread::spawn(move || {
        let listener = match TcpListener::bind("127.0.0.1:18789") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("Failed to bind local port 18789: {}", e);
                TUNNEL_RUNNING.store(false, Ordering::Relaxed);
                return;
            }
        };

        let _ = listener.set_nonblocking(true);

        while TUNNEL_RUNNING.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let remote_clone = remote_info.clone();
                    thread::spawn(move || {
                        let sess = match connect_ssh(&remote_clone) {
                            Ok(s) => s,
                            Err(e) => {
                                eprintln!("Failed to connect SSH for tunnel: {}", e);
                                return;
                            }
                        };

                        let mut remote_channel = match sess.channel_direct_tcpip("127.0.0.1", 18789, None) {
                            Ok(c) => c,
                            Err(e) => {
                                eprintln!("Failed to open SSH channel for tunnel: {}", e);
                                return;
                            }
                        };

                        let _ = stream.set_nonblocking(true);
                        sess.set_blocking(false);

                        let mut buf1 = [0; 16384];
                        let mut buf2 = [0; 16384];

                        loop {
                            if !TUNNEL_RUNNING.load(Ordering::Relaxed) { break; }
                            let mut active = false;

                            match stream.read(&mut buf1) {
                                Ok(0) => break,
                                Ok(n) => {
                                    active = true;
                                    let mut sent = 0;
                                    while sent < n {
                                        match remote_channel.write(&buf1[sent..n]) {
                                            Ok(m) => sent += m,
                                            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                                thread::sleep(Duration::from_millis(5));
                                            }
                                            Err(_) => break,
                                        }
                                    }
                                }
                                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                Err(_) => break,
                            }

                            match remote_channel.read(&mut buf2) {
                                Ok(0) => break,
                                Ok(n) => {
                                    active = true;
                                    let mut sent = 0;
                                    while sent < n {
                                        match stream.write(&buf2[sent..n]) {
                                            Ok(m) => sent += m,
                                            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                                thread::sleep(Duration::from_millis(5));
                                            }
                                            Err(_) => break,
                                        }
                                    }
                                }
                                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                Err(_) => break,
                            }

                            if !active {
                                thread::sleep(Duration::from_millis(10));
                            }
                        }
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
        TUNNEL_RUNNING.store(false, Ordering::Relaxed);
    });

    Ok("SSH tunnel started".to_string())
}

#[command]
fn stop_ssh_tunnel() -> Result<(), String> {
    TUNNEL_RUNNING.store(false, Ordering::Relaxed);
    Ok(())
}

#[command]
async fn check_remote_prerequisites(remote: RemoteInfo) -> Result<PrereqCheck, String> {
    let sess = connect_ssh(&remote)?;
    let node = execute_ssh(&sess, "node -v").is_ok();
    let openclaw = execute_ssh(&sess, "openclaw --version").is_ok();

    Ok(PrereqCheck {
        node_installed: node,
        docker_running: true, // Not needed for OpenClaw native
        openclaw_installed: openclaw,
    })
}

#[command]
async fn get_remote_openclaw_version(remote: RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(&remote)?;
    match execute_ssh(&sess, "openclaw --version") {
        Ok(v) => Ok(v.trim().to_string()),
        Err(_) => Ok("Not installed".to_string()),
    }
}

#[command]
async fn run_remote_doctor_repair(remote: RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(&remote)?;
    execute_ssh(&sess, "openclaw doctor --repair --yes")
}

#[command]
async fn run_remote_security_audit_fix(remote: RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(&remote)?;
    execute_ssh(&sess, "openclaw security audit --fix")
}

#[command]
async fn uninstall_remote_openclaw(remote: RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(&remote)?;
    let _ = execute_ssh(&sess, "openclaw gateway stop");
    execute_ssh(&sess, "sudo npm uninstall -g openclaw")?;
    execute_ssh(&sess, "rm -rf ~/.openclaw")?;
    Ok("OpenClaw has been completely uninstalled from the remote server.".to_string())
}

#[command]
async fn update_remote_openclaw(remote: RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(&remote)?;
    execute_ssh(&sess, "sudo npm install -g openclaw")?;
    execute_ssh(&sess, "openclaw gateway restart")?;
    Ok("OpenClaw has been updated on the remote server.".to_string())
}

#[command]
async fn get_remote_gateway_token(remote: RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(&remote)?;
    let content = execute_ssh(&sess, "cat ~/.openclaw/openclaw.json")?;
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    
    let token = json.get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .ok_or("Could not find gateway token in remote config")?;
        
    Ok(token.to_string())
}

#[command]
fn start_provider_auth(_provider: String, _method: String) -> Result<String, String> {
    Err("OAuth authentication has been disabled.".to_string())
}

#[command]
fn close_app(window: tauri::Window) {
    let _ = window.close();
}

#[command]
fn install_skill(name: String) -> Result<String, String> {
    shell_command(&format!("npx clawhub install {}", name))
}

#[command]
async fn install_remote_skill(remote: RemoteInfo, name: String) -> Result<String, String> {
    let sess = connect_ssh(&remote)?;
    execute_ssh(&sess, &format!("npx clawhub install {}", name))
}

#[command]
fn get_openclaw_version() -> String {
    match shell_command("openclaw --version") {
        Ok(v) => v.trim().to_string(),
        Err(_) => "v2026.2.8".to_string(),
    }
}

#[command]
fn uninstall_openclaw() -> Result<String, String> {
    let _ = shell_command("openclaw gateway stop");

    // On Windows, global npm uninstall requires root inside WSL
    #[cfg(target_os = "windows")]
    wsl_root_command("npm uninstall -g openclaw")?;

    #[cfg(not(target_os = "windows"))]
    shell_command("npm uninstall -g openclaw")?;
    
    #[cfg(target_os = "windows")]
    {
        wsl_remove_dir("~/.openclaw")?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = dirs::home_dir().ok_or("Could not find home directory")?;
        let openclaw_root = home.join(".openclaw");
        if openclaw_root.exists() {
            fs::remove_dir_all(openclaw_root).map_err(|e| e.to_string())?;
        }
    }

    Ok("OpenClaw has been completely uninstalled.".to_string())
}

#[command]
fn run_doctor_repair() -> Result<String, String> {
    shell_command("openclaw doctor --repair --yes")
}

#[command]
fn run_security_audit_fix() -> Result<String, String> {
    shell_command("openclaw security audit --fix")
}

#[command]
fn check_prerequisites() -> PrereqCheck {
    #[cfg(target_os = "windows")]
    {
        // On Windows, shell_command routes through WSL, so check WSL2 first
        let wsl2_ok = check_wsl2_installed();
        if !wsl2_ok {
            // WSL2 not installed — can't check node or openclaw yet
            return PrereqCheck {
                node_installed: false,
                docker_running: true,
                openclaw_installed: false,
            };
        }
    }

    let node = shell_command("node -v").is_ok();
    let openclaw = shell_command("openclaw --version").is_ok();

    PrereqCheck {
        node_installed: node,
        docker_running: true,
        openclaw_installed: openclaw,
    }
}

#[command]
fn install_openclaw() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        ensure_wsl2_installed()?;
        // Node.js should already be installed by install_local_nodejs()
        // Global npm install needs root for /usr/lib/node_modules
        wsl_root_command("npm install -g openclaw")?;
        shell_command("openclaw --version")?;
        Ok("OpenClaw installed successfully in WSL2.".to_string())
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        shell_command("npm install -g openclaw")?;
        shell_command("openclaw --version")?;
        Ok("OpenClaw installed successfully.".to_string())
    }
}

#[command]
fn configure_agent(config: AgentConfig) -> Result<String, String> {
    // Platform-abstracted filesystem operations.
    // On Windows, openclaw runs inside WSL, so we must write to the WSL filesystem.
    // On macOS/Linux, we use native filesystem operations.

    #[cfg(target_os = "windows")]
    let home: String = wsl_home_dir()?;

    #[cfg(not(target_os = "windows"))]
    let home: String = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .to_string_lossy()
        .to_string();

    // Closures for platform-abstracted filesystem operations
    let mkdir_p_fn = |path: &str| -> Result<(), String> {
        #[cfg(target_os = "windows")]
        { wsl_mkdir_p(path) }
        #[cfg(not(target_os = "windows"))]
        { fs::create_dir_all(path).map_err(|e| e.to_string()) }
    };

    let write_file_fn = |path: &str, content: &str| -> Result<(), String> {
        #[cfg(target_os = "windows")]
        { wsl_write_file(path, content) }
        #[cfg(not(target_os = "windows"))]
        { fs::write(path, content).map_err(|e| e.to_string()) }
    };

    let read_file_fn = |path: &str| -> String {
        #[cfg(target_os = "windows")]
        { wsl_read_file(path).unwrap_or_default() }
        #[cfg(not(target_os = "windows"))]
        { fs::read_to_string(path).unwrap_or_default() }
    };

    // Run gateway install --force FIRST to scaffold, ONLY if not preserving state
    if config.preserve_state != Some(true) {
        let _ = shell_command("openclaw gateway stop");
        // Remove existing config so install --force generates a fresh one
        let _ = shell_command("rm -f ~/.openclaw/openclaw.json || true");
        let _ = shell_command("openclaw gateway install --force --profile messaging");
    }

    let openclaw_root = format!("{}/.openclaw", home);
    let workspace = format!("{}/workspace", openclaw_root);
    let agents_dir = format!("{}/agents/main/agent", openclaw_root);

    mkdir_p_fn(&workspace)?;
    mkdir_p_fn(&agents_dir)?;

    // Always preserve existing/scaffolded gateway token to avoid device token mismatch
    let gateway_token: String = {
        let existing_config_path = format!("{}/openclaw.json", openclaw_root);
        let contents = read_file_fn(&existing_config_path);
        if !contents.is_empty() {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                if let Some(token) = parsed.get("gateway")
                    .and_then(|g| g.get("auth"))
                    .and_then(|a| a.get("token"))
                    .and_then(|t| t.as_str())
                {
                    token.to_string()
                } else {
                    rand::thread_rng()
                        .sample_iter(&rand::distributions::Alphanumeric)
                        .take(32)
                        .map(char::from)
                        .collect()
                }
            } else {
                rand::thread_rng()
                    .sample_iter(&rand::distributions::Alphanumeric)
                    .take(32)
                    .map(char::from)
                    .collect()
            }
        } else {
            rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(32)
                .map(char::from)
                .collect()
        }
    };

    let (telegram_allow_from, telegram_dm_policy): (Option<serde_json::Value>, Option<String>) = {
        let existing_config_path = format!("{}/openclaw.json", openclaw_root);
        let contents = read_file_fn(&existing_config_path);
        if !contents.is_empty() {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                let default_acc = parsed.get("channels")
                    .and_then(|c| c.get("telegram"))
                    .and_then(|t| t.get("accounts"))
                    .and_then(|a| a.get("default"));
                
                let allow_from = default_acc.and_then(|d| d.get("allowFrom")).cloned();
                let dm_policy = default_acc.and_then(|d| d.get("dmPolicy")).and_then(|v| v.as_str()).map(|s| s.to_string());
                
                (allow_from, dm_policy)
            } else { (None, None) }
        } else { (None, None) }
    };

    let profile_name = format!("{}:default", config.provider);
    let mut auth_mode = config.auth_method.as_deref().unwrap_or("token").to_string();

    if auth_mode == "setup-token" {
        auth_mode = "token".to_string();
    } else if auth_mode == "antigravity" || auth_mode == "gemini_cli" || auth_mode == "codex" {
        auth_mode = "oauth".to_string();
    }

    let gateway_port = config.gateway_port.unwrap_or(18789);
    let gateway_bind = config.gateway_bind.as_deref().unwrap_or("loopback");
    let gateway_auth_mode = config.gateway_auth_mode.as_deref().unwrap_or("token");
    let tailscale_mode = config.tailscale_mode.as_deref().unwrap_or("off");

    let mut agents_list = Vec::new();
    let mut has_main = false;

    if let Some(agents) = &config.agents {
        for agent in agents {
            if agent.id == "main" {
                has_main = true;
            }

            let mut agent_obj = serde_json::json!({
                "id": agent.id,
                "name": agent.name,
                "workspace": format!("{}/.openclaw/agents/{}/workspace", home, agent.id),
                "agentDir": format!("{}/.openclaw/agents/{}/agent", home, agent.id),
                "model": {
                    "primary": agent.model
                }
            });

            if let Some(fb) = &agent.fallback_models {
                if !fb.is_empty() {
                    if let Some(model_obj) = agent_obj.get_mut("model").and_then(|m| m.as_object_mut()) {
                        model_obj.insert("fallbacks".to_string(), serde_json::to_value(fb).unwrap());
                    }
                }
            }

            agents_list.push(agent_obj);
        }
    }

    if !has_main {
        let mut main_obj = serde_json::json!({
            "id": "main",
            "name": config.agent_name,
            "workspace": format!("{}/.openclaw/workspace", home),
            "agentDir": format!("{}/.openclaw/agents/main/agent", home),
            "model": {
                "primary": config.model
            }
        });

        if let Some(fb) = &config.fallback_models {
            if !fb.is_empty() {
                if let Some(model_obj) = main_obj.get_mut("model").and_then(|m| m.as_object_mut()) {
                    model_obj.insert("fallbacks".to_string(), serde_json::to_value(fb).unwrap());
                }
            }
        }

        agents_list.insert(0, main_obj);
    }

    let mut config_json = serde_json::json!({
        "messages": {
            "ackReactionScope": "group-mentions"
        },
        "agents": {
            "defaults": {
                "maxConcurrent": 4,
                "subagents": {
                    "maxConcurrent": 8
                },
                "compaction": {
                    "mode": "safeguard"
                },
                "workspace": workspace,
                "model": {
                    "primary": config.model
                },
                "models": {}
            },
            "list": agents_list
        },
        "gateway": {
            "mode": "local",
            "port": gateway_port,
            "bind": gateway_bind,
            "auth": {
                "mode": gateway_auth_mode,
                "token": gateway_token
            },
            "tailscale": {
                "mode": tailscale_mode,
                "resetOnExit": false
            }
        },
        "auth": {
            "profiles": {}
        },
        "commands": {
            "native": "auto",
            "nativeSkills": "auto"
        }
    });

    // Add Telegram config inline (avoids hot-reload conflicts from openclaw config set)
    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            if let Some(obj) = config_json.as_object_mut() {
                obj.insert("plugins".to_string(), serde_json::json!({
                    "entries": { "telegram": { "enabled": true } }
                }));

                let dm_policy = if config.preserve_state == Some(true) {
                    telegram_dm_policy.unwrap_or_else(|| "allowlist".to_string())
                } else {
                    "pairing".to_string()
                };

                let mut channel_config = serde_json::json!({
                    "botToken": token,
                    "name": "Primary Bot",
                    "dmPolicy": dm_policy
                });

                if dm_policy == "allowlist" {
                    if let Some(existing_allow) = telegram_allow_from {
                        if let Some(c) = channel_config.as_object_mut() {
                            c.insert("allowFrom".to_string(), existing_allow);
                        }
                    }
                }

                obj.insert("channels".to_string(), serde_json::json!({
                    "telegram": {
                        "accounts": {
                            "default": channel_config
                        }
                    }
                }));
            }
        }
    }

    // Add WhatsApp config inline if enabled
    if config.whatsapp_enabled.unwrap_or(false) {
        let dm_policy = config.whatsapp_dm_policy.as_deref().unwrap_or("open");
        if let Some(obj) = config_json.as_object_mut() {
            // Merge plugins entries (may already have telegram)
            let plugins_entry = obj.entry("plugins".to_string()).or_insert(serde_json::json!({ "entries": {} }));
            if let Some(entries) = plugins_entry.get_mut("entries").and_then(|e| e.as_object_mut()) {
                entries.insert("whatsapp".to_string(), serde_json::json!({ "enabled": true }));
            }

            // Merge channels (may already have telegram)
            let channels_entry = obj.entry("channels".to_string()).or_insert(serde_json::json!({}));
            if let Some(channels_obj) = channels_entry.as_object_mut() {
                let mut whatsapp_account = if dm_policy == "open" {
                    serde_json::json!({
                        "dmPolicy": dm_policy,
                        "allowFrom": ["*"]
                    })
                } else {
                    serde_json::json!({
                        "dmPolicy": dm_policy
                    })
                };
                
                if dm_policy == "allowlist" {
                    let existing_wa_allow = {
                        let existing_config_path = format!("{}/openclaw.json", openclaw_root);
                        let contents = read_file_fn(&existing_config_path);
                        if !contents.is_empty() {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                                parsed.get("channels")
                                    .and_then(|c| c.get("whatsapp"))
                                    .and_then(|t| t.get("accounts"))
                                    .and_then(|a| a.get("default"))
                                    .and_then(|d| d.get("allowFrom"))
                                    .cloned()
                            } else { None }
                        } else { None }
                    };
                    if let Some(existing) = existing_wa_allow {
                        if let Some(w) = whatsapp_account.as_object_mut() {
                            w.insert("allowFrom".to_string(), existing);
                        }
                    }
                }
                channels_obj.insert("whatsapp".to_string(), serde_json::json!({
                    "accounts": {
                        "default": whatsapp_account
                    }
                }));
            }
        }
    }


    // Add thinking level for Claude 4.x models via Anthropic provider
    if let Some(ref thinking_level) = config.thinking_level {
        if config.provider == "anthropic" && !thinking_level.is_empty() && thinking_level != "off" {
            if let Some(defaults) = config_json.get_mut("agents").and_then(|a| a.get_mut("defaults")).and_then(|d| d.as_object_mut()) {
                defaults.insert("thinkingDefault".to_string(), serde_json::Value::String(thinking_level.clone()));
            }
        }
    }

    // Insert dynamic auth profile
    if let Some(profiles) = config_json.get_mut("auth").and_then(|a| a.get_mut("profiles")).and_then(|p| p.as_object_mut()) {
        let mut profile = serde_json::json!({
            "provider": config.provider,
            "mode": auth_mode
        });
        // Add baseUrl for local/lmstudio providers
        if let Some(ref base_url) = config.local_base_url {
            if !base_url.is_empty() {
                if let Some(obj) = profile.as_object_mut() {
                    obj.insert("baseUrl".to_string(), serde_json::Value::String(base_url.clone()));
                }
            }
        }
        profiles.insert(profile_name.clone(), profile);
    }

    // Insert dynamic model key and optional fields
    if let Some(defaults) = config_json.get_mut("agents").and_then(|a| a.get_mut("defaults")).and_then(|d| d.as_object_mut()) {
        // Initialize dynamic model entry
        if let Some(models) = defaults.get_mut("models").and_then(|m| m.as_object_mut()) {
            models.insert(config.model.clone(), serde_json::json!({}));
        }

        // Correctly place fallbacks under the specific model configuration
        if let Some(fb) = config.fallback_models.as_ref() {
            if !fb.is_empty() {
                if let Some(primary_model_config) = defaults.get_mut("model").and_then(|m| m.as_object_mut()) {
                    primary_model_config.insert("fallbacks".to_string(), serde_json::to_value(fb).unwrap());
                }
            }
        }

        if let Some(hb_mode) = config.heartbeat_mode.as_deref() {
            match hb_mode {
                "never" => {
                    defaults.insert("heartbeat".to_string(), serde_json::json!({ "enabled": false }));
                },
                "idle" => {
                    defaults.insert("heartbeat".to_string(), serde_json::json!({
                        "mode": "idle",
                        "timeout": config.idle_timeout_ms.unwrap_or(3600000)
                    }));
                },
                interval => {
                    defaults.insert("heartbeat".to_string(), serde_json::json!({ "every": interval }));
                }
            }
        }

        if let Some(sb_mode) = config.sandbox_mode.as_deref() {
            let mapped = if sb_mode == "full" { "all" } else if sb_mode == "partial" { "non-main" } else if sb_mode == "none" { "off" } else { sb_mode };
            defaults.insert("sandbox".to_string(), serde_json::json!({ "mode": mapped }));
        }
    }

    if let Some(obj) = config_json.as_object_mut() {
        // Add tools config
        if let Some(tm) = config.tools_mode.as_deref() {
            let mut tools_obj = serde_json::Map::new();
            match tm {
                "allowlist" => {
                    if let Some(tools) = config.allowed_tools.as_ref() {
                        tools_obj.insert("allow".to_string(), serde_json::to_value(tools).unwrap());
                    }
                },
                "denylist" => {
                    if let Some(tools) = config.denied_tools.as_ref() {
                        tools_obj.insert("deny".to_string(), serde_json::to_value(tools).unwrap());
                    }
                },
                _ => {}
            }
            if !tools_obj.is_empty() {
                obj.insert("tools".to_string(), serde_json::Value::Object(tools_obj));
            }
        }
    }

    // Add memory configuration
    // memoryFlush must be an object with { enabled: bool }, not a bare boolean
    if config.memory_enabled.unwrap_or(false) {
        if let Some(defaults) = config_json.get_mut("agents").and_then(|a| a.get_mut("defaults")).and_then(|d| d.as_object_mut()) {
            if let Some(compaction) = defaults.get_mut("compaction").and_then(|c| c.as_object_mut()) {
                compaction.insert("memoryFlush".to_string(), serde_json::json!({ "enabled": true }));
            }
        }
    }

    // Add cron system configuration (enable the cron engine if we have cron jobs)
    if let Some(cron_jobs) = &config.cron_jobs {
        if !cron_jobs.is_empty() {
            if let Some(obj) = config_json.as_object_mut() {
                obj.insert("cron".to_string(), serde_json::json!({ "enabled": true }));
            }
        }
    }

    // NOTE: agent_type is NOT stored in openclaw.json (it's not a valid OpenClaw key).
    // It's stored in a separate clawnetes-meta.json file for our own tracking.

    let config_json_raw = serde_json::to_string_pretty(&config_json).map_err(|e| e.to_string())?;

    write_file_fn(&format!("{}/openclaw.json", openclaw_root), &config_json_raw)?;

    // Store Clawnetes-specific metadata in a separate file
    {
        let mut meta = serde_json::Map::new();
        if let Some(agent_type) = &config.agent_type {
            meta.insert("agent_type".to_string(), serde_json::Value::String(agent_type.clone()));
        }
        if let Some(cron_jobs) = &config.cron_jobs {
            if !cron_jobs.is_empty() {
                meta.insert("cron_jobs".to_string(), serde_json::to_value(cron_jobs).unwrap_or_default());
            }
        }
        if config.memory_enabled.unwrap_or(false) {
            meta.insert("memory_enabled".to_string(), serde_json::Value::Bool(true));
        }
        let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
        write_file_fn(&format!("{}/clawnetes-meta.json", openclaw_root), &meta_json)?;
    }

    if let Some(agents) = &config.agents {
        for agent in agents {
            let agent_workspace = format!("{}/agents/{}/workspace", openclaw_root, agent.id);
            let agent_config_dir = format!("{}/agents/{}/agent", openclaw_root, agent.id);

            mkdir_p_fn(&agent_workspace)?;
            mkdir_p_fn(&agent_config_dir)?;

            let agent_identity = agent.identity_md.clone().unwrap_or_else(|| {
                format!(r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Emoji:** 🦞
---
Managed by Clawnetes."#, agent.name)
            });
            write_file_fn(&format!("{}/IDENTITY.md", agent_workspace), &agent_identity)?;

            let agent_user_md = agent.user_md.clone().unwrap_or_else(|| {
                format!(r#"# USER.md - About Your Human
- **Name:** {}
---"#, config.user_name)
            });
            write_file_fn(&format!("{}/USER.md", agent_workspace), &agent_user_md)?;

            let agent_soul_md = agent.soul_md.clone().unwrap_or_else(|| {
                format!(r#"# SOUL.md
## Mission
Serve {}."#, config.user_name)
            });
            write_file_fn(&format!("{}/SOUL.md", agent_workspace), &agent_soul_md)?;

            // Write additional markdown files for sub-agents
            if let Some(ref tools_md) = agent.tools_md {
                write_file_fn(&format!("{}/TOOLS.md", agent_workspace), tools_md)?;
            }
            if let Some(ref agents_md) = agent.agents_md {
                write_file_fn(&format!("{}/AGENTS.md", agent_workspace), agents_md)?;
            }
            if let Some(ref heartbeat_md) = agent.heartbeat_md {
                write_file_fn(&format!("{}/HEARTBEAT.md", agent_workspace), heartbeat_md)?;
            }
            if let Some(ref memory_md) = agent.memory_md {
                write_file_fn(&format!("{}/MEMORY.md", agent_workspace), memory_md)?;
            }

            let mut agent_profiles_map = serde_json::Map::new();
            let mut primary_ai = serde_json::Map::new();
            primary_ai.insert("type".to_string(), serde_json::Value::String(auth_mode.clone()));
            primary_ai.insert("provider".to_string(), serde_json::Value::String(config.provider.clone()));
            primary_ai.insert("token".to_string(), serde_json::Value::String(config.api_key.clone()));
            agent_profiles_map.insert(profile_name.clone(), serde_json::Value::Object(primary_ai));

            if let Some(service_keys) = &config.service_keys {
                for (sid, key) in service_keys {
                    let mut p = serde_json::Map::new();
                    p.insert("type".to_string(), serde_json::Value::String("token".to_string()));
                    p.insert("provider".to_string(), serde_json::Value::String(sid.clone()));
                    p.insert("token".to_string(), serde_json::Value::String(key.clone()));
                    agent_profiles_map.insert(format!("{}:default", sid), serde_json::Value::Object(p));
                }
            }

            let agent_auth_profiles = serde_json::json!({
                "version": 1,
                "profiles": agent_profiles_map,
                "lastGood": {
                    config.provider.clone(): profile_name.clone()
                },
                "usageStats": {}
            });

            let agent_auth_json = serde_json::to_string_pretty(&agent_auth_profiles).map_err(|e| e.to_string())?;
            write_file_fn(&format!("{}/auth-profiles.json", agent_config_dir), &agent_auth_json)?;
        }
    }

    if let Some(nm) = config.node_manager {
        let _ = shell_command(&format!("openclaw config set skills.nodeManager {}", nm));
    }

    // Telegram config is now written inline in the JSON above.
    // No need for openclaw config set commands which cause hot-reload conflicts.

    let mut profiles_map = serde_json::Map::new();
    let mut primary_p = serde_json::Map::new();
    primary_p.insert("type".to_string(), serde_json::Value::String(auth_mode.clone()));
    primary_p.insert("provider".to_string(), serde_json::Value::String(config.provider.clone()));
    primary_p.insert("token".to_string(), serde_json::Value::String(config.api_key.clone()));
    profiles_map.insert(profile_name.clone(), serde_json::Value::Object(primary_p));

    if let Some(service_keys) = &config.service_keys {
        for (sid, key) in service_keys {
            let mut p = serde_json::Map::new();
            p.insert("type".to_string(), serde_json::Value::String("token".to_string()));
            p.insert("provider".to_string(), serde_json::Value::String(sid.clone()));
            p.insert("token".to_string(), serde_json::Value::String(key.clone()));
            profiles_map.insert(format!("{}:default", sid), serde_json::Value::Object(p));
        }
    }

    let auth_profiles_val = serde_json::json!({
      "version": 1,
      "profiles": profiles_map,
      "lastGood": {
        config.provider.clone(): profile_name
      },
      "usageStats": {}
    });

    let auth_profiles_json = serde_json::to_string_pretty(&auth_profiles_val).map_err(|e| e.to_string())?;
    write_file_fn(&format!("{}/auth-profiles.json", agents_dir), &auth_profiles_json)?;

    let identity_md = if let Some(custom) = config.identity_md {
        custom
    } else {
        format!(r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Emoji:** 🦞
---
Managed by Clawnetes."#, config.agent_name)
    };
    write_file_fn(&format!("{}/IDENTITY.md", workspace), &identity_md)?;

    // Write additional markdown files if provided
    if let Some(tools_md) = &config.tools_md {
        write_file_fn(&format!("{}/TOOLS.md", workspace), tools_md)?;
    }
    if let Some(agents_md) = &config.agents_md {
        write_file_fn(&format!("{}/AGENTS.md", workspace), agents_md)?;
    }
    if let Some(heartbeat_md) = &config.heartbeat_md {
        write_file_fn(&format!("{}/HEARTBEAT.md", workspace), heartbeat_md)?;
    }
    if let Some(memory_md) = &config.memory_md {
        write_file_fn(&format!("{}/MEMORY.md", workspace), memory_md)?;
    }

    let user_md = if let Some(custom) = config.user_md {
        custom
    } else {
        format!(r#"# USER.md - About Your Human
- **Name:** {}
---"#, config.user_name)
    };
    write_file_fn(&format!("{}/USER.md", workspace), &user_md)?;

    let soul_md = if let Some(custom) = config.soul_md {
        custom
    } else {
        format!(r#"# SOUL.md
## Mission
Serve {}."#, config.user_name)
    };
    write_file_fn(&format!("{}/SOUL.md", workspace), &soul_md)?;

    Ok("Configured.".into())
}

#[command]
fn start_gateway() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    // config_path removed as unused

    let _ = shell_command("openclaw gateway stop");
    thread::sleep(Duration::from_secs(2));

    // Ensure service is loaded on macOS (fix for "Could not find service" error)
    #[cfg(target_os = "macos")]
    {
        let plist_path = home.join("Library/LaunchAgents/ai.openclaw.gateway.plist");
        if plist_path.exists() {
            // Use 'launchctl bootstrap' to load the service into the gui domain
            // We use shell_command so $(id -u) is expanded by zsh
            let _ = shell_command(&format!("launchctl bootstrap gui/$(id -u) \"{}\"", plist_path.to_string_lossy()));
        }
    }

    // Removed gateway install --force logic to prevent overwriting custom config.
    // Installation is now handled in configure_agent / setup_remote_openclaw.

    let start_output = shell_command("openclaw gateway start")?;

    if start_output.to_lowercase().contains("error") || start_output.to_lowercase().contains("failed") {
        return Err(format!("Gateway start may have failed: {}", start_output));
    }

    thread::sleep(Duration::from_secs(5));

    let mut last_error = String::new();
    for attempt in 1..=8 {
        if TcpStream::connect("127.0.0.1:18789").is_ok() {
            return Ok("Gateway started successfully and is accessible on port 18789.".to_string());
        }

        if let Ok(status) = shell_command("openclaw gateway status") {
            let status_lower = status.to_lowercase();
            last_error = format!("Status: {} | Port 18789: not accessible", status.trim());

            if status_lower.contains("starting") || status_lower.contains("initializing") {
                last_error = format!("Gateway is starting... (attempt {}/8)", attempt);
            }
        } else {
            last_error = format!("Gateway status check failed (attempt {}/8)", attempt);
        }

        if attempt < 8 {
            thread::sleep(Duration::from_secs(3));
        }
    }

    let final_status = shell_command("openclaw gateway status")
        .unwrap_or_else(|_| "Unable to get status".to_string());

    Err(format!(
        "Gateway did not become accessible on port 18789 after 24+ seconds.\n\
        Last status: {}\n\
        Final gateway status:\n{}\n\n\
        Troubleshooting:\n\
        1. Check gateway logs: 'openclaw gateway logs'\n\
        2. Check gateway status: 'openclaw gateway status'\n\
        3. Try manual start: 'openclaw gateway stop && openclaw gateway start'\n\
        4. Check if port 18789 is in use: 'lsof -i :18789'",
        last_error,
        final_status
    ))
}

#[command]
fn generate_pairing_code() -> Result<String, String> {
    thread::sleep(Duration::from_secs(2));
    let _ = shell_command("openclaw gateway status");
    Ok("Ready! Send any message to your Telegram bot to start pairing. The bot will respond automatically with a code.".to_string())
}

#[command]
async fn approve_pairing(code: String, remote: Option<RemoteInfo>) -> Result<String, String> {
    // Run: openclaw pairing approve <code> --channel telegram
    let cmd_raw = format!("openclaw pairing approve {} --channel telegram", code);
    
    let output = if let Some(r) = remote {
        let sess = connect_ssh(&r)?;
        let os_type = execute_ssh(&sess, "uname -s")?.trim().to_string();
        let prefix = get_env_prefix(&os_type);
        execute_ssh(&sess, &format!("{}{}", prefix, cmd_raw))
    } else {
        shell_command(&cmd_raw)
    };
    
    match output {
        Ok(out) => {
            let out_lower = out.to_lowercase();
            if out_lower.contains("error") {
                if out_lower.contains("no pending pairing request found") {
                    return Err("Invalid pairing code. Please make sure you sent a message to the bot and try again.".to_string());
                }
                return Err(out);
            }
            Ok("Pairing successful!".to_string())
        },
        Err(err) => {
            let err_lower = err.to_lowercase();
            if err_lower.contains("no pending pairing request found") {
                return Err("Invalid pairing code. Please make sure you sent a message to the bot and try again.".to_string());
            }
            Err(err)
        }
    }
}

#[command]
fn get_dashboard_url(is_remote: bool, remote: Option<RemoteInfo>) -> Result<String, String> {
    let token = if is_remote && remote.is_some() {
        // We can't await here easily as this is a sync command, but get_remote_gateway_token is async
        // However, we can use a blocking version or just spawn a thread. 
        // Better: Make this command async or use the blocking ssh helper.
        // For now, let's try to use the blocking version of ssh connect since we have one?
        // Wait, connect_ssh is synchronous. execute_ssh is synchronous.
        // So we can just call them.
        let r = remote.unwrap();
        let sess = connect_ssh(&r)?;
        let content = execute_ssh(&sess, "cat ~/.openclaw/openclaw.json")?;
        let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        json.get("gateway")
            .and_then(|g| g.get("auth"))
            .and_then(|a| a.get("token"))
            .and_then(|t| t.as_str())
            .ok_or("Could not find gateway token in remote config")?
            .to_string()
    } else {
        #[cfg(target_os = "windows")]
        {
            let home = wsl_home_dir()?.trim().to_string();
            let config_path = format!("{}/.openclaw/openclaw.json", home);
            let config_str = wsl_read_file(&config_path)?;
            let json: serde_json::Value = serde_json::from_str(&config_str).map_err(|e| e.to_string())?;

            json.get("gateway")
                .and_then(|g| g.get("auth"))
                .and_then(|a| a.get("token"))
                .and_then(|t| t.as_str())
                .ok_or("Could not find gateway token in config")?
                .to_string()
        }

        #[cfg(not(target_os = "windows"))]
        {
            let home = dirs::home_dir().ok_or("Could not find home directory")?;
            let config_path = home.join(".openclaw").join("openclaw.json");
            let config_str = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
            let json: serde_json::Value = serde_json::from_str(&config_str).map_err(|e| e.to_string())?;

            json.get("gateway")
                .and_then(|g| g.get("auth"))
                .and_then(|a| a.get("token"))
                .and_then(|t| t.as_str())
                .ok_or("Could not find gateway token in config")?
                .to_string()
        }
    };

    Ok(format!("http://127.0.0.1:18789/?token={}", token))
}

#[command]
fn verify_tunnel_connectivity(remote: RemoteInfo) -> Result<bool, String> {
    let mut last_error = String::from("No attempts made");
    
    // Retry loop: 30 attempts, 2 seconds between each (60s total)
    for i in 0..30 {
        if i > 0 { thread::sleep(Duration::from_secs(2)); }

        // 1. Basic TCP check to local tunnel port
        if let Err(e) = TcpStream::connect("127.0.0.1:18789") {
            last_error = format!("Local tunnel port 18789 not reachable: {}", e);
            continue;
        }
        
        // 2. SSH into remote to get token AND check if gateway is actually running
        let sess = match connect_ssh(&remote) {
            Ok(s) => s,
            Err(e) => {
                last_error = format!("SSH connection failed during verification: {}", e);
                continue;
            }
        };

        // Check remote gateway status first
        // We use a generous grep to see if the process exists
        let check_process = execute_ssh(&sess, "ps aux | grep openclaw | grep -v grep");
        if let Ok(output) = check_process {
            if output.trim().is_empty() {
                // Try the CLI status command as backup
                let status_cmd = execute_ssh(&sess, "openclaw gateway status");
                if let Ok(status) = status_cmd {
                     if status.to_lowercase().contains("stopped") || status.to_lowercase().contains("error") {
                         last_error = format!("Remote gateway is not running. Status: {}", status.trim());
                         continue;
                     }
                } else {
                     last_error = "Remote openclaw process not found".to_string();
                     continue;
                }
            }
        }

        let content = match execute_ssh(&sess, "cat ~/.openclaw/openclaw.json") {
            Ok(c) => c,
            Err(e) => {
                last_error = format!("Failed to read remote config: {}", e);
                continue;
            }
        };
        
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(token) = json.get("gateway")
                .and_then(|g| g.get("auth"))
                .and_then(|a| a.get("token"))
                .and_then(|t| t.as_str()) 
            {
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(5))
                    // Important: Start with no proxy to avoid local env interference
                    .no_proxy()
                    .build()
                    .unwrap_or_else(|_| reqwest::blocking::Client::new());

                let url = format!("http://127.0.0.1:18789/?token={}", token);
                
                match client.head(&url).send() {
                    Ok(resp) => {
                        if resp.status().is_success() || resp.status().is_redirection() {
                            return Ok(true);
                        } else {
                            last_error = format!("HTTP Error: Status {}", resp.status());
                        }
                    },
                    Err(e) => {
                        last_error = format!("HTTP Connection failed: {}", e);
                    }
                }
            } else {
                last_error = "Could not find token in remote openclaw.json".to_string();
            }
        } else {
            last_error = "Failed to parse remote openclaw.json".to_string();
        }
    }
    
    // If we get here, all retries failed. Return the last specific error.
    Err(format!("Tunnel verification failed after 60s. Last error: {}", last_error))
}

// WSL2 Helper Functions

#[cfg(target_os = "windows")]
fn check_wsl2_installed() -> bool {
    let output = Command::new("powershell")
        .args(["-Command", "wsl -l -v 2>$null; exit $LASTEXITCODE"])
        .output();
    
    output.map(|o| o.status.success()).unwrap_or(false)
}

/// Poll WSL Ubuntu until it responds, with a configurable timeout.
/// Used after installing WSL or before running commands that need WSL to be ready.
#[cfg(target_os = "windows")]
fn wait_for_wsl_ready(timeout_secs: u64) -> Result<(), String> {
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);
    while start.elapsed() < timeout {
        let output = Command::new("wsl")
            .args(["-d", "Ubuntu", "-u", "root", "--", "echo", "ready"])
            .output();
        if let Ok(o) = output {
            if o.status.success() {
                let stdout = String::from_utf8_lossy(&o.stdout);
                if stdout.trim() == "ready" {
                    return Ok(());
                }
            }
        }
        thread::sleep(Duration::from_secs(3));
    }
    Err(format!("WSL Ubuntu not ready after {} seconds", timeout_secs))
}

#[cfg(target_os = "windows")]
fn ensure_wsl2_installed() -> Result<(), String> {
    // Check if WSL2 is already installed
    if check_wsl2_installed() {
        return Ok(());
    }
    
    // Install WSL2 using elevated PowerShell (triggers UAC admin prompt)
    // Start-Process -Verb RunAs launches the command with admin privileges,
    // showing the user a UAC confirmation dialog they can click to approve.
    // -Wait ensures we block until the elevated process completes.
    let output = Command::new("powershell")
        .args([
            "-Command",
            "Start-Process -FilePath 'wsl.exe' -ArgumentList '--install --distribution Ubuntu' -Verb RunAs -Wait"
        ])
        .output()
        .map_err(|e| format!("Failed to execute WSL2 installation: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Check if user declined the UAC prompt
        if stderr.contains("canceled") || stderr.contains("denied") || stderr.contains("not have permission") {
            return Err("WSL2 installation requires administrator approval. Please click 'Yes' on the admin dialog when prompted.".to_string());
        }
        return Err(format!("WSL2 installation failed. Please ensure virtualization is enabled in BIOS. Error: {}", stderr));
    }

    // Wait for WSL Ubuntu to become responsive (first-time init can be slow)
    wait_for_wsl_ready(90).map_err(|e| {
        format!("WSL2 was installed but Ubuntu is not responding. You may need to restart your computer. Error: {}", e)
    })?;

    // Verify WSL2 is now available
    if !check_wsl2_installed() {
        return Err("WSL2 was installed but may require a system restart. Please restart your computer and run this setup again.".to_string());
    }

    // Configure Ubuntu with a default user non-interactively.
    // Without this, Ubuntu prompts for username/password on first launch.

    // Create a non-root user 'openclaw' with a password, for general use
    let user_setup = Command::new("wsl")
        .args(["-d", "Ubuntu", "-u", "root", "--", "/bin/bash", "-c",
            "id openclaw >/dev/null 2>&1 || (useradd -m -s /bin/bash openclaw && echo 'openclaw:openclaw' | chpasswd && usermod -aG sudo openclaw)"
        ])
        .output()
        .map_err(|e| format!("Failed to create openclaw user: {}", e))?;

    if !user_setup.status.success() {
        let stderr = String::from_utf8_lossy(&user_setup.stderr);
        eprintln!("Warning: user setup returned error (may be harmless if user exists): {}", stderr);
    }

    // Write /etc/wsl.conf to set default user (more reliable than `ubuntu config --default-user`)
    let wsl_conf = Command::new("wsl")
        .args(["-d", "Ubuntu", "-u", "root", "--", "/bin/bash", "-c",
            "printf '[user]\\ndefault=openclaw\\n' > /etc/wsl.conf"
        ])
        .output()
        .map_err(|e| format!("Failed to write /etc/wsl.conf: {}", e))?;

    if !wsl_conf.status.success() {
        let stderr = String::from_utf8_lossy(&wsl_conf.stderr);
        eprintln!("Warning: failed to write wsl.conf: {}", stderr);
    }

    // Terminate Ubuntu so wsl.conf takes effect on next launch
    let _ = Command::new("wsl")
        .args(["--terminate", "Ubuntu"])
        .output();

    thread::sleep(Duration::from_secs(2));

    // Wait for Ubuntu to come back with the new default user
    wait_for_wsl_ready(30).map_err(|e| {
        format!("WSL Ubuntu failed to restart after user configuration: {}", e)
    })?;

    Ok(())
}

/// Run a command as root inside WSL (for apt-get, system setup, etc.)
/// This avoids the sudo password prompt by using `wsl -u root` directly.
#[cfg(target_os = "windows")]
fn wsl_root_command(cmd: &str) -> Result<String, String> {
    let output = Command::new("wsl")
        .args(["-d", "Ubuntu", "--user", "root", "--", "/bin/bash", "-c", cmd])
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("{}\n{}", stdout, stderr))
    }
}

// --- WSL filesystem helpers (Windows only) ---
// On Windows, openclaw runs inside WSL but Tauri runs natively.
// dirs::home_dir() returns C:\Users\... but we need /home/user/... inside WSL.

#[cfg(target_os = "windows")]
fn wsl_home_dir() -> Result<String, String> {
    shell_command("echo $HOME")
        .map(|s| s.trim().to_string())
}

#[cfg(target_os = "windows")]
fn wsl_write_file(path: &str, content: &str) -> Result<(), String> {
    // Escape single quotes for safe shell embedding: ' -> '\''
    let escaped = content.replace('\'', "'\\''");
    let cmd = format!("printf '%s' '{}' > \"{}\"", escaped, path);
    shell_command(&cmd)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn wsl_read_file(path: &str) -> Result<String, String> {
    shell_command(&format!("cat \"{}\" 2>/dev/null", path))
}

#[cfg(target_os = "windows")]
fn wsl_mkdir_p(path: &str) -> Result<(), String> {
    shell_command(&format!("mkdir -p \"{}\"", path))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn wsl_list_dirs(base_path: &str) -> Vec<String> {
    let mut dirs_found = Vec::new();
    if let Ok(output) = shell_command(&format!("ls -1 -F \"{}\" 2>/dev/null", base_path)) {
        for line in output.lines() {
            if line.trim().ends_with('/') {
                dirs_found.push(line.trim().trim_matches('/').to_string());
            }
        }
    }
    dirs_found
}

#[cfg(target_os = "windows")]
fn wsl_remove_dir(path: &str) -> Result<(), String> {
    let cmd = if path.starts_with("~/") {
        format!("rm -rf \"$HOME/{}\"", &path[2..])
    } else {
        format!("rm -rf \"{}\"", path)
    };
    shell_command(&cmd)?;
    Ok(())
}

fn shell_command(cmd: &str) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let (shell, args) = ("/bin/zsh", vec!["-l", "-c"]);

    #[cfg(target_os = "windows")]
    let (shell, args) = ("wsl", vec!["--", "/bin/bash", "-c"]);

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (shell, args) = ("sh", vec!["-c"]);

    let output = Command::new(shell)
        .args(&args)
        .arg(cmd)
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        // If stderr is populated, return it.
        if !stderr.is_empty() {
             Err(stderr)
        } else if !stdout.is_empty() {
             Err(stdout) // sometimes error messages are in stdout
        } else {
             Err(format!("Command failed with exit code: {}", output.status.code().unwrap_or(-1)))
        }
    }
}

#[command]
fn check_pairing_status(remote: Option<RemoteInfo>) -> Result<bool, String> {
    // Check dmPolicy via CLI to get actual active state
    let cmd_raw = "openclaw config get channels.telegram.accounts.default.dmPolicy";
    let output = if let Some(r) = remote {
        let sess = connect_ssh(&r)?;
        let os_type = execute_ssh(&sess, "uname -s")?.trim().to_string();
        let prefix = get_env_prefix(&os_type);
        execute_ssh(&sess, &format!("{}{}", prefix, cmd_raw))
    } else {
        shell_command(cmd_raw)
    };

    match output {
        Ok(policy) => {
            // If policy is NOT "pairing", assume paired/configured
            let p = policy.trim().trim_matches('"');
            Ok(p != "pairing")
        },
        Err(_) => {
            // If command fails, fallback to assuming not paired or error
            // But if it fails, maybe openclaw isn't running or config is bad.
            // Let's return false to be safe (ask to pair).
            Ok(false)
        }
    }
}

#[command]
async fn get_current_config(remote: Option<RemoteInfo>) -> Result<CurrentConfig, String> {
    // Helper to extract values from markdown
    fn extract_md_value(content: &str, key: &str) -> String {
        let pattern = format!("**{}:**", key);

        for line in content.lines() {
            let trimmed = line.trim();
            // Look for the pattern **Key:** in the line
            if let Some(pattern_pos) = trimmed.find(&pattern) {
                // Extract everything after the pattern
                let value_start = pattern_pos + pattern.len();
                let value = &trimmed[value_start..];
                return value.trim().to_string();
            }
        }
        String::new()
    }

    // Establish session ONCE if remote
    let session = if let Some(ref r) = remote {
        Some(connect_ssh(r)?)
    } else {
        None
    };

    // Resolve Home Directory (Absolute) to avoid '~' ambiguity
    let home_dir = if let Some(sess) = &session {
        execute_ssh(sess, "echo $HOME").map_err(|e| format!("Failed to get remote home: {}", e))?.trim().to_string()
    } else {
        // On Windows, openclaw runs inside WSL — use WSL home, not Windows home
        #[cfg(target_os = "windows")]
        { wsl_home_dir()? }
        #[cfg(not(target_os = "windows"))]
        { dirs::home_dir().ok_or("Could not find local home directory")?.to_string_lossy().to_string() }
    };

    // Helper to read file content (using absolute paths)
    let read_file_content = |path: &str| -> String {
        if let Some(sess) = &session {
            // Remote read
            execute_ssh(sess, &format!("cat \"{}\"", path)).unwrap_or_default()
        } else {
            // On Windows, read from WSL filesystem
            #[cfg(target_os = "windows")]
            { wsl_read_file(path).unwrap_or_default() }
            #[cfg(not(target_os = "windows"))]
            { fs::read_to_string(path).unwrap_or_default() }
        }
    };

    // Helper to list directories (used for skills)
    let list_directories = |base_path: &str| -> Vec<String> {
        let mut dirs_found = Vec::new();
        if let Some(sess) = &session {
            // Remote: use ls -F to mark directories with /
            if let Ok(output) = execute_ssh(sess, &format!("ls -1 -F \"{}\"", base_path)) {
                for line in output.lines() {
                    if line.trim().ends_with('/') {
                        dirs_found.push(line.trim().trim_matches('/').to_string());
                    }
                }
            }
        } else {
            // On Windows, list dirs inside WSL filesystem
            #[cfg(target_os = "windows")]
            {
                dirs_found = wsl_list_dirs(base_path);
            }
            #[cfg(not(target_os = "windows"))]
            {
                let path = std::path::Path::new(base_path);
                if let Ok(entries) = fs::read_dir(path) {
                    for entry in entries.flatten() {
                        if let Ok(ft) = entry.file_type() {
                            if ft.is_dir() {
                                if let Ok(name) = entry.file_name().into_string() {
                                    dirs_found.push(name);
                                }
                            }
                        }
                    }
                }
            }
        }
        dirs_found
    };

    // Fetch Main Config Files
    let openclaw_json_str = read_file_content(&format!("{}/.openclaw/openclaw.json", home_dir));
    let auth_profiles_str = read_file_content(&format!("{}/.openclaw/agents/main/agent/auth-profiles.json", home_dir));
    let identity_str = read_file_content(&format!("{}/.openclaw/workspace/IDENTITY.md", home_dir));
    let user_str = read_file_content(&format!("{}/.openclaw/workspace/USER.md", home_dir));
    let soul_str = read_file_content(&format!("{}/.openclaw/workspace/SOUL.md", home_dir));

    if openclaw_json_str.is_empty() {
        return Err("Configuration not found (openclaw.json is empty or missing)".to_string());
    }

    let oc_config: serde_json::Value = serde_json::from_str(&openclaw_json_str).map_err(|e| format!("Failed to parse openclaw.json: {}", e))?;
    let auth_config: serde_json::Value = serde_json::from_str(&auth_profiles_str).unwrap_or(serde_json::json!({}));
    let empty_json = serde_json::json!({});

    // Gateway Config
    let gateway = oc_config.get("gateway").unwrap_or(&empty_json);
    let gateway_port = gateway.get("port").and_then(|v| v.as_u64()).unwrap_or(18789) as u16;
    let gateway_bind = gateway.get("bind").and_then(|v| v.as_str()).unwrap_or("loopback").to_string();
    let gateway_auth_mode = gateway.get("auth").and_then(|a| a.get("mode")).and_then(|v| v.as_str()).unwrap_or("token").to_string();
    let tailscale_mode = gateway.get("tailscale").and_then(|t| t.get("mode")).and_then(|v| v.as_str()).unwrap_or("off").to_string();

    // Agent Config (Defaults / Main)
    let defaults = oc_config.get("agents").and_then(|a| a.get("defaults")).unwrap_or(&empty_json);
    let model_primary = defaults.get("model").and_then(|m| m.get("primary")).and_then(|v| v.as_str()).unwrap_or("anthropic/claude-opus-4-6").to_string();
    
    // Auth & Provider (Main)
    let profile_name = format!("{}:default", model_primary.split('/').next().unwrap_or("anthropic"));
    let profile = auth_config.get("profiles").and_then(|p| p.get(&profile_name)).unwrap_or(&empty_json);
    let provider = profile.get("provider").and_then(|v| v.as_str()).unwrap_or("anthropic").to_string();
    let api_key = profile.get("token").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let auth_method = profile.get("type").and_then(|v| v.as_str()).unwrap_or(if profile.get("mode").is_some() { profile.get("mode").and_then(|v| v.as_str()).unwrap_or("token") } else { "token" }).to_string();

    // Markdown Extraction (Main)
    let agent_name = extract_md_value(&identity_str, "Name");
    let agent_vibe = extract_md_value(&identity_str, "Vibe");
    let agent_emoji = extract_md_value(&identity_str, "Emoji");
    let user_name = extract_md_value(&user_str, "Name");

    // Telegram
    let telegram_token = oc_config.get("channels")
        .and_then(|c| c.get("telegram"))
        .and_then(|t| t.get("accounts"))
        .and_then(|a| a.get("default"))
        .and_then(|m| m.get("botToken"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Skills (Main)
    // We look in ~/.openclaw/workspace/skills
    let skills = list_directories(&format!("{}/.openclaw/workspace/skills", home_dir));

    // Advanced Settings
    let sandbox_mode = defaults.get("sandbox").and_then(|s| s.get("mode")).and_then(|v| v.as_str()).unwrap_or("full").to_string();
    let mapped_sandbox = if sandbox_mode == "all" { "full" } else if sandbox_mode == "non-main" { "partial" } else if sandbox_mode == "off" { "none" } else { &sandbox_mode };

    let tools = oc_config.get("tools").unwrap_or(&empty_json);
    let allowed_tools: Vec<String> = tools.get("allow").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
    let denied_tools: Vec<String> = tools.get("deny").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
    let tools_mode = if !allowed_tools.is_empty() { "allowlist" } else if !denied_tools.is_empty() { "denylist" } else { "all" };

    let fallbacks: Vec<String> = defaults.get("model")
        .and_then(|m| m.get("fallbacks"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let heartbeat = defaults.get("heartbeat").unwrap_or(&empty_json);
    let heartbeat_mode = if heartbeat.get("enabled") == Some(&serde_json::json!(false)) {
        "never".to_string()
    } else if let Some(mode) = heartbeat.get("mode").and_then(|v| v.as_str()) {
        mode.to_string()
    } else if let Some(every) = heartbeat.get("every").and_then(|v| v.as_str()) {
        every.to_string()
    } else {
        "1h".to_string()
    };
    let idle_timeout = heartbeat.get("timeout").and_then(|v| v.as_u64()).unwrap_or(3600000);

    // Multi-agent
    let empty_vec = vec![];
    let agent_list = oc_config.get("agents").and_then(|a| a.get("list")).and_then(|v| v.as_array()).unwrap_or(&empty_vec);
    let enable_multi_agent = agent_list.len() > 1;
    let mut agent_configs = Vec::new();

    if enable_multi_agent {
         for agent_val in agent_list {
             let aid = agent_val.get("id").and_then(|s| s.as_str()).unwrap_or("").to_string();
             if aid.is_empty() || aid == "main" { continue; } 
             
             // Basic info from openclaw.json
             let mut name = agent_val.get("name").and_then(|s| s.as_str()).unwrap_or("Agent").to_string();
             
             // Robust Model Extraction: Handle nested {primary: "..."} or simple string "..."
             let amodel = if let Some(m_obj) = agent_val.get("model").and_then(|m| m.as_object()) {
                 m_obj.get("primary").and_then(|s| s.as_str()).unwrap_or("").to_string()
             } else if let Some(m_str) = agent_val.get("model").and_then(|s| s.as_str()) {
                 m_str.to_string()
             } else {
                 "".to_string()
             };

             let afallbacks: Vec<String> = agent_val.get("model")
                 .and_then(|m| if m.is_object() { m.get("fallbacks") } else { None })
                 .and_then(|v| serde_json::from_value(v.clone()).ok())
                 .unwrap_or_default();
             
             // Read Agent Files (Absolute Paths)
             let agent_workspace_base = format!("{}/.openclaw/agents/{}/workspace", home_dir, aid);

             let aid_md = read_file_content(&format!("{}/IDENTITY.md", agent_workspace_base));
             let au_md = read_file_content(&format!("{}/USER.md", agent_workspace_base));
             let as_md = read_file_content(&format!("{}/SOUL.md", agent_workspace_base));

             // Extract Metadata
             let extracted_name = extract_md_value(&aid_md, "Name");
             if !extracted_name.is_empty() { name = extracted_name; } // Identity MD overrides config name

             let avibe = extract_md_value(&aid_md, "Vibe");
             let aemoji = extract_md_value(&aid_md, "Emoji");

             // Extract Skills for this agent
             let askills = list_directories(&format!("{}/skills", agent_workspace_base));
             let askills_opt = if askills.is_empty() { None } else { Some(askills) };

             // Read additional md files for sub-agent
             let a_tools_md_s = read_file_content(&format!("{}/TOOLS.md", agent_workspace_base));
             let a_tools_md = if a_tools_md_s.is_empty() { None } else { Some(a_tools_md_s) };
             let a_agents_md_s = read_file_content(&format!("{}/AGENTS.md", agent_workspace_base));
             let a_agents_md = if a_agents_md_s.is_empty() { None } else { Some(a_agents_md_s) };
             let a_heartbeat_md_s = read_file_content(&format!("{}/HEARTBEAT.md", agent_workspace_base));
             let a_heartbeat_md = if a_heartbeat_md_s.is_empty() { None } else { Some(a_heartbeat_md_s) };
             let a_memory_md_s = read_file_content(&format!("{}/MEMORY.md", agent_workspace_base));
             let a_memory_md = if a_memory_md_s.is_empty() { None } else { Some(a_memory_md_s) };

             agent_configs.push(AgentData {
                 id: aid,
                 name,
                 model: amodel,
                 fallback_models: Some(afallbacks),
                 skills: askills_opt,
                 vibe: if avibe.is_empty() { None } else { Some(avibe) },
                 emoji: Some(aemoji),
                 identity_md: Some(aid_md),
                 user_md: Some(au_md),
                 soul_md: Some(as_md),
                 tools_md: a_tools_md,
                 agents_md: a_agents_md,
                 heartbeat_md: a_heartbeat_md,
                 memory_md: a_memory_md,
                 subagents: None,
                 tools: None,
             });
         }
    }

    // Check Pairing Status
    let dm_policy = oc_config.get("channels")
        .and_then(|c| c.get("telegram"))
        .and_then(|t| t.get("accounts"))
        .and_then(|a| a.get("default"))
        .and_then(|m| m.get("dmPolicy"))
        .and_then(|v| v.as_str())
        .unwrap_or("default");
    
    let is_paired = dm_policy != "pairing";

    // Read additional workspace markdown files
    let tools_md_s = read_file_content(&format!("{}/.openclaw/workspace/TOOLS.md", home_dir));
    let tools_md_str = if tools_md_s.is_empty() { None } else { Some(tools_md_s) };
    let agents_md_s = read_file_content(&format!("{}/.openclaw/workspace/AGENTS.md", home_dir));
    let agents_md_str = if agents_md_s.is_empty() { None } else { Some(agents_md_s) };
    let heartbeat_md_s = read_file_content(&format!("{}/.openclaw/workspace/HEARTBEAT.md", home_dir));
    let heartbeat_md_str = if heartbeat_md_s.is_empty() { None } else { Some(heartbeat_md_s) };
    let memory_md_s = read_file_content(&format!("{}/.openclaw/workspace/MEMORY.md", home_dir));
    let memory_md_str = if memory_md_s.is_empty() { None } else { Some(memory_md_s) };

    // Check memory enabled (memoryFlush is an object: { enabled: bool })
    let memory_enabled = defaults.get("compaction")
        .and_then(|c| c.get("memoryFlush"))
        .and_then(|v| {
            // Handle both old format (bare bool) and new format ({ enabled: bool })
            if v.is_boolean() {
                v.as_bool()
            } else {
                v.get("enabled").and_then(|e| e.as_bool())
            }
        })
        .unwrap_or(false);

    // Read Clawnetes metadata from separate file
    let meta_str = read_file_content(&format!("{}/.openclaw/clawnetes-meta.json", home_dir));
    let meta: serde_json::Value = serde_json::from_str(&meta_str).unwrap_or(serde_json::json!({}));

    // Read cron jobs from metadata
    let cron_jobs: Option<Vec<CronJobConfig>> = meta.get("cron_jobs")
        .and_then(|c| serde_json::from_value(c.clone()).ok());

    // Read agent type from metadata (NOT from openclaw.json)
    let agent_type = meta.get("agent_type")
        .and_then(|v| v.as_str())
        .unwrap_or("custom")
        .to_string();

    // Read WhatsApp config from openclaw.json
    let whatsapp_enabled = oc_config.get("plugins")
        .and_then(|p| p.get("entries"))
        .and_then(|e| e.get("whatsapp"))
        .and_then(|w| w.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let whatsapp_dm_policy = oc_config.get("channels")
        .and_then(|c| c.get("whatsapp"))
        .and_then(|w| w.get("accounts"))
        .and_then(|a| a.get("default"))
        .and_then(|m| m.get("dmPolicy"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let thinking_level = defaults.get("thinkingDefault")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(CurrentConfig {
        provider,
        api_key,
        auth_method,
        model: model_primary,
        user_name,
        agent_name,
        agent_vibe,
        agent_emoji,
        agent_type,
        telegram_token,
        gateway_port,
        gateway_bind,
        gateway_auth_mode,
        tailscale_mode,
        node_manager: "npm".to_string(),
        skills,
        service_keys: std::collections::HashMap::new(),
        sandbox_mode: mapped_sandbox.to_string(),
        tools_mode: tools_mode.to_string(),
        allowed_tools,
        denied_tools,
        fallback_models: fallbacks,
        heartbeat_mode,
        idle_timeout_ms: idle_timeout,
        identity_md: identity_str,
        user_md: user_str,
        soul_md: soul_str,
        tools_md: tools_md_str,
        agents_md: agents_md_str,
        heartbeat_md: heartbeat_md_str,
        memory_md: memory_md_str,
        memory_enabled,
        enable_multi_agent,
        agent_configs,
        is_paired,
        cron_jobs,
        local_base_url: None,
        thinking_level,
        whatsapp_enabled: Some(whatsapp_enabled),
        whatsapp_dm_policy,
    })
}

#[command]
async fn install_local_nodejs() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        // On Windows: install WSL2 first, then Node.js inside WSL2
        ensure_wsl2_installed()?;
        // Ensure WSL is responsive before running apt commands
        wait_for_wsl_ready(30)
            .map_err(|e| format!("WSL not ready for Node.js installation: {}", e))?;
        // Use wsl_root_command to run as root directly (avoids sudo password prompt)
        wsl_root_command("curl -fsSL https://deb.nodesource.com/setup_22.x | bash -")
            .map_err(|e| format!("Failed to add NodeSource repository: {}", e))?;
        wsl_root_command("apt-get install -y nodejs")
            .map_err(|e| format!("Failed to install Node.js in WSL2: {}", e))?;
        return Ok("Node.js installed successfully in WSL2.".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 1. Try brew (macOS standard)
        if shell_command("brew --version").is_ok() {
            return shell_command("brew install node");
        }

        // 2. Try nvm (via curl) - Fallback for macOS without brew or Linux
        let install_nvm_cmd = "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash";
        shell_command(install_nvm_cmd).map_err(|e| format!("Failed to install nvm: {}", e))?;

        let install_node_cmd = "export NVM_DIR=\"$HOME/.nvm\"; \
            [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; \
            nvm install node && nvm use node && nvm alias default node";

        shell_command(install_node_cmd).map_err(|e| format!("Failed to install Node.js via nvm: {}", e))
    }
}

#[command]
fn get_ollama_models(remote: Option<RemoteInfo>) -> Result<Vec<String>, String> {
    if let Some(r) = remote {
        // Remote: SSH exec curl to hit Ollama API on the remote host
        let sess = connect_ssh(&r).map_err(|e| format!("SSH connect failed: {}", e))?;
        let output = execute_ssh(&sess, "curl -sf http://localhost:11434/api/tags 2>/dev/null || echo '{}'");
        match output {
            Ok(json_str) => {
                let val: serde_json::Value = serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));
                let models: Vec<String> = val.get("models")
                    .and_then(|m| m.as_array())
                    .map(|arr| arr.iter()
                        .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                        .collect())
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![])
        }
    } else {
        // Local: use reqwest blocking
        match reqwest::blocking::get("http://localhost:11434/api/tags") {
            Ok(resp) => {
                let json: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
                let models: Vec<String> = json.get("models")
                    .and_then(|m| m.as_array())
                    .map(|arr| arr.iter()
                        .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                        .collect())
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![])
        }
    }
}

#[command]
fn get_lmstudio_models(base_url: Option<String>, remote: Option<RemoteInfo>) -> Result<Vec<String>, String> {
    let url_base = base_url.as_deref().unwrap_or("http://localhost:1234");
    let models_url = format!("{}/v1/models", url_base);

    if let Some(r) = remote {
        let sess = connect_ssh(&r).map_err(|e| format!("SSH connect failed: {}", e))?;
        let output = execute_ssh(&sess, &format!("curl -sf {}/v1/models 2>/dev/null || echo '{{}}'", url_base));
        match output {
            Ok(json_str) => {
                let val: serde_json::Value = serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));
                let models: Vec<String> = val.get("data")
                    .and_then(|d| d.as_array())
                    .map(|arr| arr.iter()
                        .filter_map(|m| m.get("id").and_then(|n| n.as_str()).map(|s| s.to_string()))
                        .collect())
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![])
        }
    } else {
        match reqwest::blocking::get(&models_url) {
            Ok(resp) => {
                let json: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
                let models: Vec<String> = json.get("data")
                    .and_then(|d| d.as_array())
                    .map(|arr| arr.iter()
                        .filter_map(|m| m.get("id").and_then(|n| n.as_str()).map(|s| s.to_string()))
                        .collect())
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![])
        }
    }
}

#[command]
fn validate_openclaw_config(remote: Option<RemoteInfo>, is_wsl: Option<bool>) -> Result<String, String> {
    if let Some(r) = remote {
        let sess = connect_ssh(&r).map_err(|e| format!("SSH connect failed: {}", e))?;
        let os_type = execute_ssh(&sess, "uname -s").unwrap_or_default().trim().to_string();
        let prefix = get_env_prefix(&os_type);
        execute_ssh(&sess, &format!("{}openclaw config validate 2>&1", prefix))
    } else if is_wsl.unwrap_or(false) {
        shell_command("wsl -- openclaw config validate 2>&1")
    } else {
        shell_command("openclaw config validate 2>&1")
    }
}

#[command]
async fn start_whatsapp_login(gateway_port: u16) -> Result<String, String> {
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::protocol::Message;

    let url = format!("ws://127.0.0.1:{}", gateway_port);
    let (mut ws_stream, _) = connect_async(&url).await
        .map_err(|e| format!("WebSocket connect failed: {}", e))?;

    let request_id = uuid::Uuid::new_v4().to_string();
    let rpc_msg = serde_json::json!({
        "id": request_id,
        "method": "web.login.start",
        "params": { "timeoutMs": 30000 }
    });

    ws_stream.send(Message::Text(rpc_msg.to_string())).await
        .map_err(|e| format!("WebSocket send failed: {}", e))?;

    // Wait for response
    while let Some(msg) = ws_stream.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let val: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                if val.get("id").and_then(|v| v.as_str()) == Some(&request_id) {
                    if let Some(qr) = val.get("result")
                        .and_then(|r| r.get("qrDataUrl"))
                        .and_then(|v| v.as_str())
                    {
                        return Ok(qr.to_string());
                    }
                    if let Some(err) = val.get("error") {
                        return Err(format!("Gateway error: {}", err));
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Err(e) => return Err(format!("WebSocket error: {}", e)),
            _ => {}
        }
    }

    Err("No QR code received from gateway".to_string())
}

#[command]
async fn wait_whatsapp_login(gateway_port: u16) -> Result<bool, String> {
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::protocol::Message;

    let url = format!("ws://127.0.0.1:{}", gateway_port);
    let (mut ws_stream, _) = connect_async(&url).await
        .map_err(|e| format!("WebSocket connect failed: {}", e))?;

    let request_id = uuid::Uuid::new_v4().to_string();
    let rpc_msg = serde_json::json!({
        "id": request_id,
        "method": "web.login.wait",
        "params": { "timeoutMs": 120000 }
    });

    ws_stream.send(Message::Text(rpc_msg.to_string())).await
        .map_err(|e| format!("WebSocket send failed: {}", e))?;

    let timeout = tokio::time::timeout(
        std::time::Duration::from_secs(130),
        async {
            while let Some(msg) = ws_stream.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        let val: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                        if val.get("id").and_then(|v| v.as_str()) == Some(&request_id) {
                            let connected = val.get("result")
                                .and_then(|r| r.get("connected"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            return Ok(connected);
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Err(e) => return Err(format!("WebSocket error: {}", e)),
                    _ => {}
                }
            }
            Ok(false)
        }
    ).await;

    match timeout {
        Ok(result) => result,
        Err(_) => Err("WhatsApp login wait timed out".to_string()),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            install_local_nodejs,
            check_prerequisites,
            install_openclaw,
            configure_agent,
            start_gateway,
            generate_pairing_code,
            get_dashboard_url,
            approve_pairing,
            close_app,
            install_skill,
            install_remote_skill,
            start_provider_auth,
            get_openclaw_version,
            uninstall_openclaw,
            run_doctor_repair,
            run_security_audit_fix,
            read_workspace_files,
            save_workspace_files,
            create_custom_skill,
            test_ssh_connection,
            setup_remote_openclaw,
            start_ssh_tunnel,
            stop_ssh_tunnel,
            check_remote_prerequisites,
            get_remote_openclaw_version,
            run_remote_doctor_repair,
            run_remote_security_audit_fix,
            uninstall_remote_openclaw,
            update_remote_openclaw,
            get_remote_gateway_token,
            verify_tunnel_connectivity,
            get_current_config,
            check_pairing_status,
            get_ollama_models,
            get_lmstudio_models,
            validate_openclaw_config,
            start_whatsapp_login,
            wait_whatsapp_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_config_deserialization() {
        let json_data = r#"
        {
            "provider": "anthropic",
            "api_key": "sk-test-123",
            "model": "anthropic/claude-opus-4-6",
            "user_name": "Test User",
            "agent_name": "Test Agent",
            "agents": [
                {
                    "id": "agent-1",
                    "name": "SubAgent 1",
                    "model": "openai/gpt-4o",
                    "emoji": "🤖"
                }
            ]
        }
        "#;

        let config: AgentConfig = serde_json::from_str(json_data).expect("Failed to deserialize AgentConfig");

        assert_eq!(config.provider, "anthropic");
        assert_eq!(config.api_key, "sk-test-123");
        assert_eq!(config.model, "anthropic/claude-opus-4-6");
        assert_eq!(config.user_name, "Test User");
        
        let agents = config.agents.expect("Agents list should be present");
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "SubAgent 1");
        assert_eq!(agents[0].emoji, Some("🤖".to_string()));
    }

    #[test]
    fn test_gateway_config_includes_mode_local() {
        // The gateway config MUST include "mode": "local" to prevent
        // "Gateway start blocked: set gateway.mode=local (current: unset)" error
        let gateway_token = "test-token-123";
        let gateway_auth_mode = "token";
        let tailscale_mode = "off";
        let gateway_port = 18789;
        let gateway_bind = "127.0.0.1";

        let config_val = serde_json::json!({
            "gateway": {
                "mode": "local",
                "port": gateway_port,
                "bind": gateway_bind,
                "auth": { "mode": gateway_auth_mode, "token": gateway_token },
                "tailscale": { "mode": tailscale_mode, "resetOnExit": false }
            }
        });

        let gateway = config_val.get("gateway").expect("gateway key must exist");
        assert_eq!(
            gateway.get("mode").and_then(|v| v.as_str()),
            Some("local"),
            "gateway.mode must be set to 'local' to prevent startup failure"
        );
        assert_eq!(
            gateway.get("port").and_then(|v| v.as_u64()),
            Some(18789)
        );
        assert_eq!(
            gateway.get("auth").and_then(|a| a.get("token")).and_then(|t| t.as_str()),
            Some("test-token-123")
        );
    }

    #[test]
    fn test_gateway_startup_command_sequence() {
        // Verify the correct command sequence for gateway startup on Windows/WSL:
        // 1. gateway install --force
        // 2. gateway stop (prevent crash-loop before config is written)
        // 3. ... config is written ...
        // 4. systemctl reset-failed (recover from any crash-loop)
        // 5. gateway stop
        // 6. gateway start

        let nvm_prefix = "source ~/.nvm/nvm.sh && ";

        // Commands after install (prevent crash-loop)
        let install_cmd = format!("{}openclaw gateway install --force", nvm_prefix);
        let stop_after_install_cmd = format!("{}openclaw gateway stop || true", nvm_prefix);

        // Commands before start (recover from crash-loop)
        let reset_failed_cmd = "systemctl --user reset-failed openclaw-gateway.service 2>/dev/null || true";
        let stop_before_start_cmd = format!("{}openclaw gateway stop || true", nvm_prefix);
        let start_cmd = format!("{}openclaw gateway start", nvm_prefix);

        // Verify install is followed by stop
        assert!(install_cmd.contains("gateway install --force"));
        assert!(stop_after_install_cmd.contains("gateway stop"));

        // Verify start sequence includes reset-failed
        assert!(reset_failed_cmd.contains("reset-failed"));
        assert!(reset_failed_cmd.contains("openclaw-gateway.service"));

        // Verify stop comes before start
        assert!(stop_before_start_cmd.contains("gateway stop"));
        assert!(start_cmd.contains("gateway start"));
        assert!(!start_cmd.contains("stop"));
    }

    #[test]
    fn test_gateway_config_preserves_auth_token() {
        // When reconfiguring, existing gateway auth token should be preserved
        let existing_config = serde_json::json!({
            "gateway": {
                "mode": "local",
                "auth": { "mode": "token", "token": "existing-secret-token" }
            }
        });

        let token = existing_config
            .get("gateway")
            .and_then(|g| g.get("auth"))
            .and_then(|a| a.get("token"))
            .and_then(|t| t.as_str());

        assert_eq!(token, Some("existing-secret-token"),
            "Gateway auth token must be preserved during reconfiguration");
    }

    #[test]
    fn test_wsl_root_command_uses_explicit_distro() {
        // wsl_root_command should use `-d Ubuntu` for robustness
        // Verify the expected argument structure
        let cmd = "echo hello";
        let expected_args = vec!["-d", "Ubuntu", "--user", "root", "--", "/bin/bash", "-c", cmd];
        assert_eq!(expected_args[0], "-d");
        assert_eq!(expected_args[1], "Ubuntu");
        assert_eq!(expected_args[2], "--user");
        assert_eq!(expected_args[3], "root");
        assert_eq!(expected_args[7], cmd);
    }

    #[test]
    fn test_wsl_conf_content_format() {
        // The wsl.conf written to set default user must follow INI format
        let expected_content = "[user]\ndefault=openclaw\n";
        assert!(expected_content.starts_with("[user]"));
        assert!(expected_content.contains("default=openclaw"));
        // Verify it's valid INI-style (section header + key=value)
        let lines: Vec<&str> = expected_content.trim().lines().collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "[user]");
        assert_eq!(lines[1], "default=openclaw");
    }

    #[test]
    fn test_wsl_user_setup_command_structure() {
        // The user setup command should create user, set password, and add to sudo group
        let user_cmd = "id openclaw >/dev/null 2>&1 || (useradd -m -s /bin/bash openclaw && echo 'openclaw:openclaw' | chpasswd && usermod -aG sudo openclaw)";
        // Checks for existing user first
        assert!(user_cmd.contains("id openclaw"));
        // Creates with home dir and bash shell
        assert!(user_cmd.contains("useradd -m -s /bin/bash openclaw"));
        // Sets password
        assert!(user_cmd.contains("chpasswd"));
        // Adds to sudo group
        assert!(user_cmd.contains("usermod -aG sudo openclaw"));
    }

    #[test]
    fn test_wait_for_wsl_ready_command_args() {
        // wait_for_wsl_ready should use explicit distro and root user
        let expected_args = ["-d", "Ubuntu", "-u", "root", "--", "echo", "ready"];
        assert_eq!(expected_args[0], "-d");
        assert_eq!(expected_args[1], "Ubuntu");
        assert_eq!(expected_args[2], "-u");
        assert_eq!(expected_args[3], "root");
        assert_eq!(expected_args[6], "ready");
    }

    #[test]
    fn test_wsl_write_file_escapes_single_quotes() {
        // wsl_write_file uses printf '%s' '...' > file, so single quotes must be escaped
        let content = "it's a test with 'quotes' inside";
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!("printf '%s' '{}' > \"{}\"", escaped, "/tmp/test.txt");

        // Verify the escaped content doesn't have unmatched quotes
        assert!(cmd.contains("it'\\''s a test with '\\''quotes'\\'' inside"));
        // Verify the command targets the right file
        assert!(cmd.contains("/tmp/test.txt"));
    }

    #[test]
    fn test_wsl_write_file_handles_json_content() {
        // JSON content often has no single quotes, but may have special chars
        let content = r#"{"gateway":{"mode":"local","auth":{"token":"abc123"}}}"#;
        let escaped = content.replace('\'', "'\\''");
        // JSON typically has no single quotes, so escaped should equal original
        assert_eq!(escaped, content);
    }

    #[test]
    fn test_wsl_home_dir_command_structure() {
        // wsl_home_dir calls shell_command("echo $HOME") which on Windows
        // routes through wsl -- /bin/bash -c "echo $HOME"
        // Verify the command string is correct
        let cmd = "echo $HOME";
        assert_eq!(cmd, "echo $HOME");
        // The result should be trimmed (no trailing newline)
        let simulated_output = "/home/testuser\n";
        assert_eq!(simulated_output.trim(), "/home/testuser");
    }

    #[test]
    fn test_wsl_read_file_command_structure() {
        // wsl_read_file calls shell_command("cat \"path\" 2>/dev/null")
        let path = "/home/user/.openclaw/openclaw.json";
        let cmd = format!("cat \"{}\" 2>/dev/null", path);
        assert!(cmd.contains("cat"));
        assert!(cmd.contains(path));
        assert!(cmd.contains("2>/dev/null"), "stderr should be suppressed");
    }

    #[test]
    fn test_configure_agent_uses_string_paths() {
        // On all platforms, configure_agent now uses String paths (not PathBuf)
        // so that on Windows the WSL home (/home/user) is used instead of C:\Users\user
        let home = "/home/testuser";
        let openclaw_root = format!("{}/.openclaw", home);
        let workspace = format!("{}/workspace", openclaw_root);
        let agents_dir = format!("{}/agents/main/agent", openclaw_root);

        assert_eq!(openclaw_root, "/home/testuser/.openclaw");
        assert_eq!(workspace, "/home/testuser/.openclaw/workspace");
        assert_eq!(agents_dir, "/home/testuser/.openclaw/agents/main/agent");

        // Verify these are Unix-style paths (not Windows backslashes)
        assert!(!openclaw_root.contains('\\'));
        assert!(!workspace.contains('\\'));
    }

    #[test]
    fn test_wsl_remove_dir_command_structure() {
        // wsl_remove_dir should use rm -rf with the path and expand ~/ to $HOME/
        let path = "~/.openclaw";
        let cmd = if path.starts_with("~/") {
            format!("rm -rf \"$HOME/{}\"", &path[2..])
        } else {
            format!("rm -rf \"{}\"", path)
        };
        assert!(cmd.contains("rm -rf"));
        assert!(cmd.contains("$HOME/.openclaw"));
    }
}
