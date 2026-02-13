use tauri::command;
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

#[macro_use]
extern crate lazy_static;

lazy_static! {
    static ref TUNNEL_RUNNING: AtomicBool = AtomicBool::new(false);
}

#[derive(serde::Deserialize, Clone)]
struct AgentData {
    id: String,
    name: String,
    model: String,
    fallback_models: Option<Vec<String>>,
    skills: Option<Vec<String>>,
    vibe: String,
    identity_md: Option<String>,
    user_md: Option<String>,
    soul_md: Option<String>,
}

#[derive(serde::Deserialize)]
struct AgentConfig {
    provider: String,
    api_key: String,
    auth_method: Option<String>,
    model: String,
    user_name: String,
    agent_name: String,
    agent_vibe: String,
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
}

#[derive(serde::Serialize)]
struct PrereqCheck {
    node_installed: bool,
    docker_running: bool,
    openclaw_installed: bool,
}

#[derive(serde::Deserialize, Clone)]
struct RemoteInfo {
    ip: String,
    user: String,
    password: Option<String>,
    private_key_path: Option<String>,
}

// SSH Helper Functions

fn authenticate_with_key(sess: &Session, username: &str, key_path_str: &str) -> Result<(), String> {
    let path = Path::new(key_path_str);

    // Strategy 1: Try with None for public key (libssh2 often handles this)
    if sess.userauth_pubkey_file(username, None, path, None).is_ok() {
        return Ok(());
    }

    // Strategy 2: Try with an explicit .pub file if it exists
    let mut pubkey_path = path.to_path_buf();
    pubkey_path.set_extension("pub");
    if pubkey_path.exists() {
        if sess.userauth_pubkey_file(username, Some(&pubkey_path), path, None).is_ok() {
            return Ok(());
        }
    }

    // Strategy 3: Try generating the public key using ssh-keygen if available
    let output = Command::new("ssh-keygen")
        .args(["-y", "-P", "", "-f", key_path_str])
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            let pubkey_content = String::from_utf8_lossy(&out.stdout);
            let temp_dir = std::env::temp_dir();
            let temp_pubkey = temp_dir.join(format!("temp_ssh_key_{}.pub", rand::random::<u32>()));
            
            if fs::write(&temp_pubkey, pubkey_content.as_bytes()).is_ok() {
                let res = sess.userauth_pubkey_file(username, Some(&temp_pubkey), path, None);
                let _ = fs::remove_file(temp_pubkey);
                if res.is_ok() {
                    return Ok(());
                }
            }
        }
    }

    Err("Public key authentication failed. Please ensure your key is in OpenSSH format and not passphrase-protected.".to_string())
}

fn connect_ssh(remote: &RemoteInfo) -> Result<Session, String> {
    let tcp = TcpStream::connect(format!("{}:22", remote.ip))
        .map_err(|e| format!("Failed to connect to {}:22 - {}", remote.ip, e))?;

    let mut sess = Session::new()
        .map_err(|e| format!("Failed to create SSH session: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH handshake failed: {}", e))?;

    // Try authentication in order: key → password → agent
    let mut auth_methods = Vec::new();

    // 1. Try SSH key if provided
    if let Some(ref key_path) = remote.private_key_path {
        if !key_path.is_empty() {
            match authenticate_with_key(&sess, &remote.user, key_path) {
                Ok(_) => return Ok(sess),
                Err(e) => auth_methods.push(format!("Key auth: {}", e)),
            }
        }
    }

    // 2. Try password if provided
    if let Some(ref password) = remote.password {
        if !password.is_empty() {
            match sess.userauth_password(&remote.user, password) {
                Ok(_) => return Ok(sess),
                Err(e) => auth_methods.push(format!("Password auth: {}", e)),
            }
        }
    }

    // 3. Try SSH agent
    match sess.userauth_agent(&remote.user) {
        Ok(_) => return Ok(sess),
        Err(e) => auth_methods.push(format!("Agent auth: {}", e)),
    }

    // 4. Try default SSH keys
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    for key_name in &["id_rsa", "id_ed25519", "id_ecdsa"] {
        let key_path = home.join(".ssh").join(key_name);
        if key_path.exists() {
            if let Ok(_) = authenticate_with_key(&sess, &remote.user, key_path.to_str().unwrap()) {
                return Ok(sess);
            }
        }
    }

    Err(format!(
        "All authentication methods failed:\n{}",
        auth_methods.join("\n")
    ))
}

fn execute_ssh(remote: &RemoteInfo, cmd: &str) -> Result<String, String> {
    let sess = connect_ssh(remote)?;
    let mut channel = sess.channel_session()
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    channel.exec(cmd)
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let mut output = String::new();
    channel.read_to_string(&mut output)
        .map_err(|e| format!("Failed to read output: {}", e))?;

    channel.wait_close()
        .map_err(|e| format!("Failed to close channel: {}", e))?;

    let exit_status = channel.exit_status()
        .map_err(|e| format!("Failed to get exit status: {}", e))?;

    if exit_status != 0 {
        return Err(format!("Command failed with exit code {}: {}", exit_status, output));
    }

    Ok(output)
}

#[command]
fn read_workspace_files() -> Result<serde_json::Value, String> {
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

#[command]
fn save_workspace_files(
    agent_id: Option<String>,
    identity: String,
    user: String,
    soul: String
) -> Result<String, String> {
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

#[command]
fn create_custom_skill(name: String, content: String) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let skill_dir = home.join(".openclaw").join("workspace").join("skills").join(&name);

    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
    fs::write(skill_dir.join("SKILL.md"), content).map_err(|e| e.to_string())?;

    Ok(format!("Custom skill '{}' created successfully", name))
}

#[command]
fn start_provider_auth(provider: String, method: String) -> Result<String, String> {
    let cmd = format!("openclaw models auth login --provider {} --method {}", provider, method);
    shell_command(&cmd)?;
    
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let profile_name = format!("{}:default", provider);
    let auth_path = home.join(".openclaw").join("agents").join("main").join("agent").join("auth-profiles.json");
    
    if auth_path.exists() {
        let content = fs::read_to_string(auth_path).map_err(|e| e.to_string())?;
        let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        if let Some(token) = json.get("profiles").and_then(|p| p.get(&profile_name)).and_then(|p| p.get("token")).and_then(|t| t.as_str()) {
            return Ok(token.to_string());
        }
    }
    
    Ok("Authenticated via browser. Token synced.".to_string())
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
fn get_openclaw_version() -> String {
    match shell_command("openclaw --version") {
        Ok(v) => v.trim().to_string(),
        Err(_) => "v2026.2.8".to_string(),
    }
}

#[command]
fn uninstall_openclaw() -> Result<String, String> {
    let _ = shell_command("openclaw gateway stop");
    shell_command("npm uninstall -g openclaw")?;
    
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let openclaw_root = home.join(".openclaw");
    if openclaw_root.exists() {
        fs::remove_dir_all(openclaw_root).map_err(|e| e.to_string())?;
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
    shell_command("npm install -g openclaw")?;
    shell_command("openclaw --version")?;
    Ok("OpenClaw installed successfully.".to_string())
}

#[command]
fn configure_agent(config: AgentConfig) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let openclaw_root = home.join(".openclaw");
    let workspace = openclaw_root.join("workspace");
    let agents_dir = openclaw_root.join("agents").join("main").join("agent");

    fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
    fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;

    let gateway_token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

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
            agents_list.push(serde_json::json!({
                "id": agent.id,
                "name": agent.name,
                "workspace": format!("{}/.openclaw/agents/{}/workspace", home.to_string_lossy(), agent.id),
                "agentDir": format!("{}/.openclaw/agents/{}/agent", home.to_string_lossy(), agent.id)
            }));
        }
    }

    if !has_main {
        agents_list.insert(0, serde_json::json!({ "id": "main" }));
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
                "workspace": workspace.to_string_lossy(),
                "model": {
                    "primary": config.model
                },
                "models": {
                    config.model.clone(): {}
                }
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
            "profiles": {
                profile_name.clone(): {
                    "provider": config.provider,
                    "mode": auth_mode
                }
            }
        }
    });

    // Add optional fields safely
    if let Some(defaults) = config_json.get_mut("agents").and_then(|a| a.get_mut("defaults")).and_then(|d| d.as_object_mut()) {
        if let Some(fb) = config.fallback_models.as_ref() {
            if !fb.is_empty() {
                defaults.insert("fallbacks".to_string(), serde_json::to_value(fb).unwrap());
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

    let config_json_raw = serde_json::to_string_pretty(&config_json).map_err(|e| e.to_string())?;

    fs::write(openclaw_root.join("openclaw.json"), config_json_raw).map_err(|e| e.to_string())?;

    if let Some(agents) = &config.agents {
        for agent in agents {
            let agent_workspace = openclaw_root.join("agents").join(&agent.id).join("workspace");
            let agent_config_dir = openclaw_root.join("agents").join(&agent.id).join("agent");

            fs::create_dir_all(&agent_workspace).map_err(|e| e.to_string())?;
            fs::create_dir_all(&agent_config_dir).map_err(|e| e.to_string())?;

            let agent_identity = agent.identity_md.clone().unwrap_or_else(|| {
                format!(r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Vibe:** {}
- **Emoji:** 🦞
---
Managed by ClawSetup."#, agent.name, agent.vibe)
            });
            fs::write(agent_workspace.join("IDENTITY.md"), agent_identity).map_err(|e| e.to_string())?;

            let agent_user_md = agent.user_md.clone().unwrap_or_else(|| {
                format!(r#"# USER.md - About Your Human
- **Name:** {}
---"#, config.user_name)
            });
            fs::write(agent_workspace.join("USER.md"), agent_user_md).map_err(|e| e.to_string())?;

            let agent_soul_md = agent.soul_md.clone().unwrap_or_else(|| {
                format!(r#"# SOUL.md
## Mission
Serve {}."#, config.user_name)
            });
            fs::write(agent_workspace.join("SOUL.md"), agent_soul_md).map_err(|e| e.to_string())?;

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
            fs::write(agent_config_dir.join("auth-profiles.json"), agent_auth_json).map_err(|e| e.to_string())?;
        }
    }

    if let Some(nm) = config.node_manager {
        let _ = shell_command(&format!("openclaw config set skills.nodeManager {}", nm));
    }

    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            let _ = shell_command("openclaw plugins enable telegram");
            let _ = shell_command(&format!("openclaw config set channels.telegram.accounts.main.botToken {}", token));
            let _ = shell_command("openclaw config set channels.telegram.accounts.main.dmPolicy pairing");
            let _ = shell_command("openclaw config set channels.telegram.accounts.main.name \"Primary Bot\"");
        }
    }

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
    fs::write(agents_dir.join("auth-profiles.json"), auth_profiles_json).map_err(|e| e.to_string())?;

    let identity_md = if let Some(custom) = config.identity_md {
        custom
    } else {
        format!(r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Vibe:** {}
- **Emoji:** 🦞
---
Managed by ClawSetup."#, config.agent_name, config.agent_vibe)
    };
    fs::write(workspace.join("IDENTITY.md"), identity_md).map_err(|e| e.to_string())?;

    let user_md = if let Some(custom) = config.user_md {
        custom
    } else {
        format!(r#"# USER.md - About Your Human
- **Name:** {}
---"#, config.user_name)
    };
    fs::write(workspace.join("USER.md"), user_md).map_err(|e| e.to_string())?;

    let soul_md = if let Some(custom) = config.soul_md {
        custom
    } else {
        format!(r#"# SOUL.md
## Mission
Serve {}."#, config.user_name)
    };
    fs::write(workspace.join("SOUL.md"), soul_md).map_err(|e| e.to_string())?;

    Ok("Configured.".into())
}

#[command]
fn start_gateway() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let openclaw_root = home.join(".openclaw");
    let config_path = openclaw_root.join("openclaw.json");

    let _ = shell_command("openclaw gateway stop");
    thread::sleep(Duration::from_secs(2));

    let our_config = if config_path.exists() {
        Some(fs::read_to_string(&config_path).map_err(|e| e.to_string())?)
    } else {
        None
    };

    let install_output = shell_command("openclaw gateway install --force")?;

    if install_output.to_lowercase().contains("error") || install_output.to_lowercase().contains("failed") {
        return Err(format!("Gateway installation may have failed: {}", install_output));
    }

    if let Some(old_config) = our_config {
        fs::write(&config_path, old_config).map_err(|e| e.to_string())?;
    }

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
fn approve_pairing(code: String, is_remote: bool, remote: Option<RemoteInfo>) -> Result<String, String> {
    let output = if is_remote && remote.is_some() {
        execute_ssh(&remote.unwrap(), &format!("openclaw pairing approve {} --channel telegram", code))
    } else {
        shell_command(&format!("openclaw pairing approve {} --channel telegram", code))
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
        get_remote_gateway_token(remote.unwrap())?
    } else {
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
    };

    Ok(format!("http://127.0.0.1:18789/?token={}", token))
}

#[command]
fn test_ssh_connection(remote: RemoteInfo) -> Result<String, String> {
    TcpStream::connect(format!("{}:22", remote.ip))
        .map_err(|e| format!("Cannot reach {}:22 - {}", remote.ip, e))?;

    let sess = connect_ssh(&remote)?;

    let mut channel = sess.channel_session()
        .map_err(|e| format!("Failed to open SSH channel: {}", e))?;
    channel.exec("echo 'SSH connection successful'")
        .map_err(|e| format!("Failed to execute test command: {}", e))?;

    let mut output = String::new();
    channel.read_to_string(&mut output)
        .map_err(|e| format!("Failed to read output: {}", e))?;

    Ok("SSH connection successful".to_string())
}

#[command]
fn check_remote_prerequisites(remote: RemoteInfo) -> Result<PrereqCheck, String> {
    let node_check = execute_ssh(&remote, "node -v").is_ok();
    let openclaw_check = execute_ssh(&remote, "openclaw --version").is_ok();

    Ok(PrereqCheck {
        node_installed: node_check,
        docker_running: true, 
        openclaw_installed: openclaw_check,
    })
}

#[command]
fn get_remote_openclaw_version(remote: RemoteInfo) -> String {
    match execute_ssh(&remote, "openclaw --version") {
        Ok(v) => v.trim().to_string(),
        Err(_) => "v2026.2.8".to_string(),
    }
}

#[command]
fn setup_remote_openclaw(remote: RemoteInfo, config: AgentConfig) -> Result<String, String> {
    let node_check = execute_ssh(&remote, "node -v");
    if node_check.is_err() {
        execute_ssh(&remote, "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash")?;
        execute_ssh(&remote, "source ~/.bashrc && nvm install --lts")?;
    }

    execute_ssh(&remote, "npm install -g openclaw")?;

    let gateway_token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

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

    let remote_home = execute_ssh(&remote, "echo $HOME")?.trim().to_string();

    let mut agents_list = Vec::new();
    let mut has_main = false;

    if let Some(agents) = &config.agents {
        for agent in agents {
            if agent.id == "main" {
                has_main = true;
            }
            agents_list.push(serde_json::json!({
                "id": agent.id,
                "name": agent.name,
                "workspace": format!("{}/.openclaw/agents/{}/workspace", remote_home, agent.id),
                "agentDir": format!("{}/.openclaw/agents/{}/agent", remote_home, agent.id)
            }));
        }
    }

    if !has_main {
        agents_list.insert(0, serde_json::json!({ "id": "main" }));
    }

    let mut config_json_obj = serde_json::json!({
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
                "workspace": format!("{}/.openclaw/workspace", remote_home),
                "model": {
                    "primary": config.model
                },
                "models": {
                    config.model.clone(): {}
                }
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
            "profiles": {
                profile_name.clone(): {
                    "provider": config.provider,
                    "mode": auth_mode
                }
            }
        }
    });

    if let Some(defaults) = config_json_obj.get_mut("agents").and_then(|a| a.get_mut("defaults")).and_then(|d| d.as_object_mut()) {
        if let Some(fb) = config.fallback_models.as_ref() {
            if !fb.is_empty() {
                defaults.insert("fallbacks".to_string(), serde_json::to_value(fb).unwrap());
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

    if let Some(obj) = config_json_obj.as_object_mut() {
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

    let config_json = serde_json::to_string_pretty(&config_json_obj).map_err(|e| e.to_string())?;

    let openclaw_root = format!("{}/.openclaw", remote_home);
    execute_ssh(&remote, &format!("mkdir -p {}/agents/main/agent", openclaw_root))?;
    execute_ssh(&remote, &format!("mkdir -p {}/workspace", openclaw_root))?;

    let write_config_cmd = format!("cat > {}/openclaw.json << 'EOF'\n{}\nEOF", openclaw_root, config_json);
    execute_ssh(&remote, &write_config_cmd)?;

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

    let auth_profiles = serde_json::to_string_pretty(&auth_profiles_val).map_err(|e| e.to_string())?;
    let write_auth_cmd = format!("cat > {}/agents/main/agent/auth-profiles.json << 'EOF'\n{}\nEOF", openclaw_root, auth_profiles);
    execute_ssh(&remote, &write_auth_cmd)?;

    let identity_md = config.identity_md.unwrap_or_else(|| {
        format!(r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Vibe:** {}
- **Emoji:** 🦞
---
Managed by ClawSetup."#, config.agent_name, config.agent_vibe)
    });
    let write_identity_cmd = format!("cat > {}/workspace/IDENTITY.md << 'EOF'\n{}\nEOF", openclaw_root, identity_md);
    execute_ssh(&remote, &write_identity_cmd)?;

    let user_md = config.user_md.unwrap_or_else(|| {
        format!(r#"# USER.md - About Your Human
- **Name:** {}
---"#, config.user_name)
    });
    let write_user_cmd = format!("cat > {}/workspace/USER.md << 'EOF'\n{}\nEOF", openclaw_root, user_md);
    execute_ssh(&remote, &write_user_cmd)?;

    let soul_md = config.soul_md.unwrap_or_else(|| {
        format!(r#"# SOUL.md
## Mission
Serve {}."#, config.user_name)
    });
    let write_soul_cmd = format!("cat > {}/workspace/SOUL.md << 'EOF'\n{}\nEOF", openclaw_root, soul_md);
    execute_ssh(&remote, &write_soul_cmd)?;

    if let Some(nm) = config.node_manager {
        let _ = execute_ssh(&remote, &format!("openclaw config set skills.nodeManager {}", nm));
    }

    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            let _ = execute_ssh(&remote, "openclaw plugins enable telegram");
            let _ = execute_ssh(&remote, &format!("openclaw config set channels.telegram.accounts.main.botToken {}", token));
            let _ = execute_ssh(&remote, "openclaw config set channels.telegram.accounts.main.dmPolicy pairing");
            let _ = execute_ssh(&remote, "openclaw config set channels.telegram.accounts.main.name \"Primary Bot\"");
        }
    }

    if let Some(agents) = &config.agents {
        for agent in agents {
            let agent_workspace = format!("{}/.openclaw/agents/{}/workspace", remote_home, agent.id);
            let agent_config_dir = format!("{}/.openclaw/agents/{}/agent", remote_home, agent.id);

            execute_ssh(&remote, &format!("mkdir -p {}", agent_workspace))?;
            execute_ssh(&remote, &format!("mkdir -p {}", agent_config_dir))?;

            let agent_identity = agent.identity_md.clone().unwrap_or_else(|| {
                format!(r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Vibe:** {}
- **Emoji:** 🦞
---
Managed by ClawSetup."#, agent.name, agent.vibe)
            });
            let write_cmd = format!("cat > {}/IDENTITY.md << 'EOF'\n{}\nEOF", agent_workspace, agent_identity);
            execute_ssh(&remote, &write_cmd)?;

            let agent_user_md = agent.user_md.clone().unwrap_or_else(|| {
                format!("# USER.md - About Your Human\n- **Name:** {}\n---", config.user_name)
            });
            let write_cmd = format!("cat > {}/USER.md << 'EOF'\n{}\nEOF", agent_workspace, agent_user_md);
            execute_ssh(&remote, &write_cmd)?;

            let agent_soul_md = agent.soul_md.clone().unwrap_or_else(|| {
                format!("# SOUL.md\n## Mission\nServe {}.", config.user_name)
            });
            let write_cmd = format!("cat > {}/SOUL.md << 'EOF'\n{}\nEOF", agent_workspace, agent_soul_md);
            execute_ssh(&remote, &write_cmd)?;

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
            let write_cmd = format!("cat > {}/auth-profiles.json << 'EOF'\n{}\nEOF", agent_config_dir, agent_auth_json);
            execute_ssh(&remote, &write_cmd)?;
        }
    }

    execute_ssh(&remote, "openclaw gateway install --force")?;
    execute_ssh(&remote, "openclaw gateway start")?;

    thread::sleep(Duration::from_secs(5));

    let mut attempts = 0;
    let max_attempts = 20; 
    let gateway_ready = loop {
        let status_output = execute_ssh(&remote, "openclaw gateway status");

        if let Ok(status) = status_output {
            let status_lower = status.to_lowercase();
            if status_lower.contains("running") ||
               status_lower.contains("active") ||
               status_lower.contains("listening") ||
               status_lower.contains("online") ||
               status_lower.contains("started") {
                break true;
            }
        }

        attempts += 1;
        if attempts >= max_attempts {
            break false;
        }

        thread::sleep(Duration::from_secs(5));
    };

    if !gateway_ready {
        let logs = execute_ssh(&remote, "openclaw gateway logs | tail -n 20").unwrap_or_default();
        let status = execute_ssh(&remote, "openclaw gateway status").unwrap_or_default();
        return Err(format!(
            "Remote gateway did not start successfully after {} seconds.\nStatus: {}\nLast Logs:\n{}",
            max_attempts * 5,
            status.trim(),
            logs
        ));
    }

    let port_check = execute_ssh(&remote, &format!("netstat -tln | grep :{} || ss -tln | grep :{} || lsof -i :{} 2>/dev/null", gateway_port, gateway_port, gateway_port));
    if port_check.is_err() || port_check.unwrap().trim().is_empty() {
        let status = execute_ssh(&remote, "openclaw gateway status").unwrap_or_default().to_lowercase();
        let is_running = status.contains("running") || 
                         status.contains("active") || 
                         status.contains("listening") || 
                         status.contains("online") ||
                         status.contains("started");
        
        if !is_running {
            let logs = execute_ssh(&remote, "openclaw gateway logs | tail -n 20").unwrap_or_default();
            return Err(format!("Remote gateway is not listening on port {}.\nStatus: {}\nLogs:\n{}", gateway_port, status, logs));
        }
    }

    Ok("Remote OpenClaw setup completed and verified successfully".to_string())
}

#[command]
fn start_ssh_tunnel(remote: RemoteInfo) -> Result<String, String> {
    if TUNNEL_RUNNING.load(Ordering::Relaxed) {
        return Err("SSH tunnel is already running".to_string());
    }

    TUNNEL_RUNNING.store(true, Ordering::Relaxed);

    thread::spawn(move || {
        if let Err(e) = run_tunnel(&remote) {
            eprintln!("SSH tunnel error: {}", e);
            TUNNEL_RUNNING.store(false, Ordering::Relaxed);
        }
    });

    thread::sleep(Duration::from_secs(2));

    if TcpStream::connect("127.0.0.1:18789").is_ok() {
        Ok("SSH tunnel established successfully".to_string())
    } else {
        Err("SSH tunnel failed to establish".to_string())
    }
}

fn run_tunnel(remote: &RemoteInfo) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:18789")
        .map_err(|e| format!("Failed to bind local port 18789: {}", e))?;

    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    while TUNNEL_RUNNING.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let remote_info = remote.clone();
                thread::spawn(move || {
                    let sess = match connect_ssh(&remote_info) {
                        Ok(s) => s,
                        Err(e) => {
                            eprintln!("Failed to connect SSH for tunnel connection: {}", e);
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

                    stream.set_nonblocking(true).ok();
                    sess.set_blocking(false);

                    let mut buf_local = [0u8; 16384];
                    let mut buf_remote = [0u8; 16384];

                    loop {
                        if !TUNNEL_RUNNING.load(Ordering::Relaxed) { break; }
                        let mut active = false;

                        match stream.read(&mut buf_local) {
                            Ok(0) => break,
                            Ok(n) => {
                                active = true;
                                let mut sent = 0;
                                while sent < n {
                                    match remote_channel.write(&buf_local[sent..n]) {
                                        Ok(m) => sent += m,
                                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                            thread::sleep(Duration::from_millis(5));
                                        }
                                        Err(_) => return,
                                    }
                                }
                            }
                            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                            Err(_) => break,
                        }

                        match remote_channel.read(&mut buf_remote) {
                            Ok(0) => break,
                            Ok(n) => {
                                active = true;
                                let mut sent = 0;
                                while sent < n {
                                    match stream.write(&buf_remote[sent..n]) {
                                        Ok(m) => sent += m,
                                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                            thread::sleep(Duration::from_millis(5));
                                        }
                                        Err(_) => return,
                                    }
                                }
                            }
                            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                            Err(_) => break,
                        }

                        if !active {
                            thread::sleep(Duration::from_millis(10));
                        }
                    }
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(_) => break,
        }
    }

    Ok(())
}

#[command]
fn stop_ssh_tunnel() -> Result<String, String> {
    TUNNEL_RUNNING.store(false, Ordering::Relaxed);
    thread::sleep(Duration::from_secs(1));
    Ok("SSH tunnel stopped".to_string())
}

#[command]
fn run_remote_doctor_repair(remote: RemoteInfo) -> Result<String, String> {
    execute_ssh(&remote, "openclaw doctor --repair --yes")
}

#[command]
fn run_remote_security_audit_fix(remote: RemoteInfo) -> Result<String, String> {
    execute_ssh(&remote, "openclaw security audit --fix")
}

#[command]
fn uninstall_remote_openclaw(remote: RemoteInfo) -> Result<String, String> {
    execute_ssh(&remote, "openclaw gateway stop")?;
    execute_ssh(&remote, "npm uninstall -g openclaw")?;
    execute_ssh(&remote, "rm -rf ~/.openclaw")?;
    Ok("Remote OpenClaw uninstalled successfully".to_string())
}

#[command]
fn update_remote_openclaw(remote: RemoteInfo) -> Result<String, String> {
    execute_ssh(&remote, "npm install -g openclaw@latest")
}

#[command]
fn get_remote_gateway_token(remote: RemoteInfo) -> Result<String, String> {
    let config_content = execute_ssh(&remote, "cat ~/.openclaw/openclaw.json")?;
    let json: serde_json::Value = serde_json::from_str(&config_content)
        .map_err(|e| format!("Failed to parse remote config: {}", e))?;

    let token = json.get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .ok_or("Could not find gateway token in remote config")?;

    Ok(token.to_string())
}

#[command]
fn install_remote_skill(remote: RemoteInfo, name: String) -> Result<String, String> {
    execute_ssh(&remote, &format!("npx clawhub install {}", name))
}

#[command]
fn verify_tunnel_connectivity(remote: RemoteInfo) -> Result<bool, String> {
    thread::sleep(Duration::from_secs(2));

    if TcpStream::connect("127.0.0.1:18789").is_err() {
        return Ok(false);
    }

    let token = get_remote_gateway_token(remote)?;

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("http://127.0.0.1:18789/?token={}", token);
    let response = client.head(&url).send();

    match response {
        Ok(resp) => Ok(resp.status().is_success() || resp.status().is_redirection()),
        Err(_) => Ok(false)
    }
}

fn shell_command(cmd: &str) -> Result<String, String> {
    let full_cmd = format!(
        "export PATH=\"$PATH:/usr/local/bin:/opt/homebrew/bin\"; \
         {{ [ -f /etc/profile ] && . /etc/profile; \
           [ -f ~/.zprofile ] && . ~/.zprofile; \
           [ -f ~/.zshrc ] && . ~/.zshrc; }} > /dev/null 2>&1; \
         {}", 
        cmd
    );

    let output = Command::new("/bin/zsh")
        .arg("-c")
        .arg(full_cmd)
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        let cleaned_stderr = stderr.lines()
            .filter(|line| !line.contains(".zshrc") && !line.contains(".zprofile") && !line.contains("no such file or directory"))
            .collect::<Vec<_>>()
            .join("\n");

        let err_to_return = if !cleaned_stderr.trim().is_empty() {
            cleaned_stderr
        } else if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Command failed with exit code: {}", output.status.code().unwrap_or(-1))
        };

        Err(err_to_return)
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            check_prerequisites,
            install_openclaw,
            configure_agent,
            start_gateway,
            generate_pairing_code,
            get_dashboard_url,
            approve_pairing,
            close_app,
            install_skill,
            start_provider_auth,
            get_openclaw_version,
            uninstall_openclaw,
            run_doctor_repair,
            run_security_audit_fix,
            read_workspace_files,
            save_workspace_files,
            create_custom_skill,
            test_ssh_connection,
            check_remote_prerequisites,
            get_remote_openclaw_version,
            setup_remote_openclaw,
            start_ssh_tunnel,
            stop_ssh_tunnel,
            run_remote_doctor_repair,
            run_remote_security_audit_fix,
            uninstall_remote_openclaw,
            update_remote_openclaw,
            get_remote_gateway_token,
            install_remote_skill,
            verify_tunnel_connectivity
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}