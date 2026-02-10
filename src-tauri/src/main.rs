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

fn authenticate_with_key(sess: &Session, username: &str, key_path: &str) -> Result<(), String> {
    let path = Path::new(key_path);

    // Try public key authentication
    sess.userauth_pubkey_file(username, None, path, None)
        .map_err(|e| format!("Public key auth failed: {}", e))?;

    Ok(())
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
    // Run openclaw models auth login --provider <provider> --method <method>
    // Note: For OAuth flows, this usually opens a browser.
    // We might not get the token back directly in stdout if it's purely interactive,
    // but we can try to read it from auth-profiles.json after.
    
    let cmd = format!("openclaw models auth login --provider {} --method {}", provider, method);
    shell_command(&cmd)?;
    
    // Try to extract the token from auth-profiles.json
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
    // Use npx clawhub install as recommended by openclaw help
    shell_command(&format!("npx clawhub install {}", name))
}

#[command]
fn get_openclaw_version() -> String {
    match shell_command("openclaw --version") {
        Ok(v) => v.trim().to_string(),
        Err(_) => "v2026.2.8".to_string(), // Fallback to last known if not installed yet
    }
}

#[command]
fn uninstall_openclaw() -> Result<String, String> {
    // 1. Stop gateway first
    let _ = shell_command("openclaw gateway stop");
    
    // 2. Uninstall package
    shell_command("npm uninstall -g openclaw")?;
    
    // 3. Remove data directory
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
    // Use shell_command to properly source user's PATH
    let node = shell_command("node -v").is_ok();
    // Docker not needed on macOS - OpenClaw runs natively
    let openclaw = shell_command("openclaw --version").is_ok();

    PrereqCheck {
        node_installed: node,
        docker_running: true, // Always true on macOS (not needed)
        openclaw_installed: openclaw,
    }
}

#[command]
fn install_openclaw() -> Result<String, String> {
    // Install via npm using shell_command for proper PATH
    shell_command("npm install -g openclaw")?;

    // Verify installation
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

    // Generate a random gateway token
    let gateway_token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    // Build profile name (e.g., "anthropic:default")
    let profile_name = format!("{}:default", config.provider);
    let mut auth_mode = config.auth_method.unwrap_or_else(|| "token".to_string());

    // Map specialized auth flows to standard OpenClaw modes for the config files
    if auth_mode == "setup-token" {
        auth_mode = "token".to_string();
    } else if auth_mode == "antigravity" || auth_mode == "gemini_cli" || auth_mode == "codex" {
        auth_mode = "oauth".to_string();
    }

    // NEW: Build heartbeat config section for agents.defaults
    let heartbeat_section = match config.heartbeat_mode.as_deref() {
        Some("never") => r#","heartbeat": { "enabled": false }"#.to_string(),
        Some("idle") => format!(r#","heartbeat": {{ "mode": "idle", "timeout": {} }}"#, config.idle_timeout_ms.unwrap_or(3600000)),
        Some(interval) => format!(r#","heartbeat": {{ "every": "{}" }}"#, interval),
        None => r#","heartbeat": { "every": "1h" }"#.to_string()
    };

    // NEW: Build fallback models section
    let fallbacks_section = if let Some(fb) = config.fallback_models.as_ref() {
        if !fb.is_empty() {
            format!(r#","fallbacks": {}"#, serde_json::to_string(fb).unwrap())
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // NEW: Build sandbox section
    let sandbox_section = if let Some(mode) = config.sandbox_mode.as_ref() {
        format!(r#",
  "sandbox": {{ "mode": "{}" }}"#, mode)
    } else {
        String::new()
    };

    // NEW: Build tools section
    let tools_section = if let Some(mode) = config.tools_mode.as_ref() {
        match mode.as_str() {
            "allowlist" => {
                if let Some(tools) = config.allowed_tools.as_ref() {
                    format!(r#",
  "tools": {{ "mode": "allowlist", "allow": {} }}"#, serde_json::to_string(tools).unwrap())
                } else {
                    String::new()
                }
            },
            "denylist" => {
                if let Some(tools) = config.denied_tools.as_ref() {
                    format!(r#",
  "tools": {{ "mode": "denylist", "deny": {} }}"#, serde_json::to_string(tools).unwrap())
                } else {
                    String::new()
                }
            },
            "all" => r#",
  "tools": { "mode": "all" }"#.to_string(),
            _ => String::new()
        }
    } else {
        String::new()
    };

    // Handle Telegram config section
    let telegram_section = if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            format!(r#",
  "plugins": {{
    "entries": {{
      "telegram": {{
        "enabled": true
      }}
    }}
  }},
  "channels": {{
    "telegram": {{
      "accounts": {{
        "main": {{
          "botToken": "{}",
          "name": "Primary Bot",
          "dmPolicy": "pairing"
        }}
      }}
    }}
  }}"#, token)
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // Write openclaw.json (NOT config.json!)
    let gateway_port = config.gateway_port.unwrap_or(18789);
    let gateway_bind = config.gateway_bind.unwrap_or_else(|| "loopback".to_string());
    let gateway_auth_mode = config.gateway_auth_mode.unwrap_or_else(|| "token".to_string());
    let tailscale_mode = config.tailscale_mode.unwrap_or_else(|| "off".to_string());

    let config_json_raw = format!(r#"{{
  "messages": {{
    "ackReactionScope": "group-mentions"
  }},
  "agents": {{
    "defaults": {{
      "maxConcurrent": 4,
      "subagents": {{
        "maxConcurrent": 8
      }},
      "compaction": {{
        "mode": "safeguard"
      }},
      "workspace": "{workspace}",
      "model": {{
        "primary": "{model}"{fallbacks}
      }},
      "models": {{
        "{model}": {{}}
      }}{heartbeat}
    }}
  }},
  "gateway": {{
    "mode": "local",
    "port": {port},
    "bind": "{bind}",
    "auth": {{
      "mode": "{auth_mode}",
      "token": "{token}"
    }},
    "tailscale": {{
      "mode": "{tailscale}",
      "resetOnExit": false
    }}
  }},
  "auth": {{
    "profiles": {{
      "{profile}": {{
        "provider": "{provider}",
        "mode": "{mode}"
      }}
    }}
  }}{telegram}{sandbox}{tools}
}}"#,
        workspace = workspace.to_string_lossy(),
        model = config.model,
        fallbacks = fallbacks_section,
        heartbeat = heartbeat_section,
        port = gateway_port,
        bind = gateway_bind,
        auth_mode = gateway_auth_mode,
        token = gateway_token,
        tailscale = tailscale_mode,
        profile = profile_name,
        provider = config.provider,
        mode = auth_mode,
        telegram = telegram_section,
        sandbox = sandbox_section,
        tools = tools_section
    );

    fs::write(openclaw_root.join("openclaw.json"), config_json_raw).map_err(|e| e.to_string())?;

    // Set nodeManager via CLI to ensure it's valid and avoid "Unknown config keys" warnings
    if let Some(nm) = config.node_manager {
        let _ = shell_command(&format!("openclaw config set skills.nodeManager {}", nm));
    }

    // Enable telegram plugin if token is provided
    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            let _ = shell_command("openclaw plugins enable telegram");
        }
    }

    // Write auth-profiles.json
    let mut profiles_map = serde_json::Map::new();
    
    // Add primary AI profile
    let mut primary_p = serde_json::Map::new();
    primary_p.insert("type".to_string(), serde_json::Value::String(auth_mode.clone()));
    primary_p.insert("provider".to_string(), serde_json::Value::String(config.provider.clone()));
    primary_p.insert("token".to_string(), serde_json::Value::String(config.api_key.clone()));
    profiles_map.insert(profile_name.clone(), serde_json::Value::Object(primary_p));

    // Add Service Keys
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

    // Identity files (Identity, User, Soul)...
    // Use custom content if provided, otherwise generate defaults
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

    // Multi-Agent Configuration
    if let Some(agents) = &config.agents {
        for agent in agents {
            let agent_workspace = openclaw_root.join("agents").join(&agent.id).join("workspace");
            let agent_config_dir = openclaw_root.join("agents").join(&agent.id).join("agent");

            fs::create_dir_all(&agent_workspace).map_err(|e| e.to_string())?;
            fs::create_dir_all(&agent_config_dir).map_err(|e| e.to_string())?;

            // Write agent-specific workspace files
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

            // Create agent-specific auth-profiles.json
            let mut agent_profiles_map = serde_json::Map::new();
            let mut primary_p = serde_json::Map::new();
            primary_p.insert("type".to_string(), serde_json::Value::String(auth_mode.clone()));
            primary_p.insert("provider".to_string(), serde_json::Value::String(config.provider.clone()));
            primary_p.insert("token".to_string(), serde_json::Value::String(config.api_key.clone()));
            agent_profiles_map.insert(profile_name.clone(), serde_json::Value::Object(primary_p));

            // Add service keys to agent profile
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

            // Register agent with openclaw CLI
            let _ = shell_command(&format!("openclaw agents add --id {} --name {}", agent.id, agent.name));
        }

        // Update openclaw.json with agents.entries
        let config_path = openclaw_root.join("openclaw.json");
        let config_content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        let mut config_json: serde_json::Value = serde_json::from_str(&config_content)
            .map_err(|e| format!("Failed to parse config: {}", e))?;

        // Build agents.entries section
        let mut entries = serde_json::Map::new();
        for agent in agents {
            let agent_workspace_path = openclaw_root.join("agents").join(&agent.id).join("workspace");
            let mut agent_entry = serde_json::Map::new();
            agent_entry.insert("name".to_string(), serde_json::Value::String(agent.name.clone()));
            agent_entry.insert("workspace".to_string(), serde_json::Value::String(agent_workspace_path.to_string_lossy().to_string()));

            let mut model_obj = serde_json::Map::new();
            model_obj.insert("primary".to_string(), serde_json::Value::String(agent.model.clone()));
            if let Some(fallbacks) = &agent.fallback_models {
                if !fallbacks.is_empty() {
                    model_obj.insert("fallbacks".to_string(), serde_json::to_value(fallbacks).unwrap());
                }
            }
            agent_entry.insert("model".to_string(), serde_json::Value::Object(model_obj));

            if let Some(skills) = &agent.skills {
                agent_entry.insert("skills".to_string(), serde_json::to_value(skills).unwrap());
            }

            entries.insert(agent.id.clone(), serde_json::Value::Object(agent_entry));
        }

        if let Some(agents_section) = config_json.get_mut("agents") {
            if let Some(agents_obj) = agents_section.as_object_mut() {
                agents_obj.insert("entries".to_string(), serde_json::Value::Object(entries));
            }
        }

        let updated_config = serde_json::to_string_pretty(&config_json)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&config_path, updated_config).map_err(|e| e.to_string())?;
    }

    Ok("Configured.".into())
}

#[command]
fn start_gateway() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let openclaw_root = home.join(".openclaw");
    let config_path = openclaw_root.join("openclaw.json");

    // Stop any existing instance first
    let _ = shell_command("openclaw gateway stop");
    thread::sleep(Duration::from_secs(2));

    // Backup our config if it exists (we'll merge it back after gateway install)
    let our_config = if config_path.exists() {
        Some(fs::read_to_string(&config_path).map_err(|e| e.to_string())?)
    } else {
        None
    };

    // Install gateway service
    let install_output = shell_command("openclaw gateway install --force")?;

    // Check for any error messages in install output
    if install_output.to_lowercase().contains("error") || install_output.to_lowercase().contains("failed") {
        return Err(format!("Gateway installation may have failed: {}", install_output));
    }

    // If we had a config before, merge it back
    if let Some(old_config) = our_config {
        // Read the newly generated config with auth token
        let new_config = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;

        // Parse both configs
        let mut new_json: serde_json::Value = serde_json::from_str(&new_config)
            .map_err(|e| format!("Failed to parse new config: {}", e))?;
        let old_json: serde_json::Value = serde_json::from_str(&old_config)
            .map_err(|e| format!("Failed to parse old config: {}", e))?;

        // Merge key sections from old config (preserve gateway.auth from new config)
        if let Some(agents) = old_json.get("agents") {
            new_json["agents"] = agents.clone();
        }
        if let Some(auth) = old_json.get("auth") {
            new_json["auth"] = auth.clone();
        }
        if let Some(messages) = old_json.get("messages") {
            new_json["messages"] = messages.clone();
        }
        if let Some(plugins) = old_json.get("plugins") {
            new_json["plugins"] = plugins.clone();
        }
        if let Some(channels) = old_json.get("channels") {
            new_json["channels"] = channels.clone();
        }

        // Write merged config back
        let merged = serde_json::to_string_pretty(&new_json)
            .map_err(|e| format!("Failed to serialize merged config: {}", e))?;
        fs::write(&config_path, merged).map_err(|e| e.to_string())?;
    }

    // Start the gateway (runs natively on macOS, not via Docker)
    let start_output = shell_command("openclaw gateway start")?;

    // Check for errors in start output
    if start_output.to_lowercase().contains("error") || start_output.to_lowercase().contains("failed") {
        return Err(format!("Gateway start may have failed: {}", start_output));
    }

    // Give it time to initialize - native process startup
    thread::sleep(Duration::from_secs(5));

    // Try to verify it's actually accessible via network with multiple attempts
    let mut last_error = String::new();
    for attempt in 1..=8 {
        // Try to connect to the gateway port (18789)
        if TcpStream::connect("127.0.0.1:18789").is_ok() {
            // Port is open, gateway is listening!
            return Ok("Gateway started successfully and is accessible on port 18789.".to_string());
        }

        // Check status output for diagnostic info
        if let Ok(status) = shell_command("openclaw gateway status") {
            let status_lower = status.to_lowercase();
            last_error = format!("Status: {} | Port 18789: not accessible", status.trim());

            // If status indicates it's running but port isn't open yet, keep waiting
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

    // Get final status for error message
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
    // Give gateway a bit more time if needed
    thread::sleep(Duration::from_secs(2));

    // Try to verify gateway is accessible (but don't fail if we can't verify)
    let _ = shell_command("openclaw gateway status");

    // OpenClaw doesn't have a "pairing create" command.
    // The flow is: user sends a message to the bot, then checks pending requests.
    // Return instructions for the user.
    Ok("Ready! Send any message to your Telegram bot to start pairing. The bot will respond automatically with a code.".to_string())
}

#[command]
fn approve_pairing(code: String) -> Result<String, String> {
    // Run: openclaw pairing approve <code> --channel telegram
    let output = shell_command(&format!("openclaw pairing approve {} --channel telegram", code));
    
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
        // Use existing get_remote_gateway_token function
        get_remote_gateway_token(remote.unwrap())?
    } else {
        // Existing local read logic
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

// SSH Remote Commands

#[command]
fn test_ssh_connection(remote: RemoteInfo) -> Result<String, String> {
    // First test TCP connectivity
    TcpStream::connect(format!("{}:22", remote.ip))
        .map_err(|e| format!("Cannot reach {}:22 - {}", remote.ip, e))?;

    // Then test SSH handshake and authentication
    let sess = connect_ssh(&remote)?;

    // Execute a simple test command
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
        docker_running: true, // Not needed for remote
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
    // Install Node.js if needed
    let node_check = execute_ssh(&remote, "node -v");
    if node_check.is_err() {
        // Install Node.js via nvm
        execute_ssh(&remote, "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash")?;
        execute_ssh(&remote, "source ~/.bashrc && nvm install --lts")?;
    }

    // Install OpenClaw
    execute_ssh(&remote, "npm install -g openclaw")?;

    // Configure OpenClaw remotely (similar to local configure_agent)
    let gateway_token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let profile_name = format!("{}:default", config.provider);
    let mut auth_mode = config.auth_method.unwrap_or_else(|| "token".to_string());

    if auth_mode == "setup-token" {
        auth_mode = "token".to_string();
    } else if auth_mode == "antigravity" || auth_mode == "gemini_cli" || auth_mode == "codex" {
        auth_mode = "oauth".to_string();
    }

    // Build config JSON
    let config_json = format!(r#"{{
  "messages": {{
    "ackReactionScope": "group-mentions"
  }},
  "agents": {{
    "defaults": {{
      "maxConcurrent": 4,
      "subagents": {{
        "maxConcurrent": 8
      }},
      "compaction": {{
        "mode": "safeguard"
      }},
      "workspace": "$HOME/.openclaw/workspace",
      "model": {{
        "primary": "{model}"
      }},
      "models": {{
        "{model}": {{}}
      }},
      "heartbeat": {{ "every": "1h" }}
    }}
  }},
  "gateway": {{
    "mode": "local",
    "port": 18789,
    "bind": "loopback",
    "auth": {{
      "mode": "token",
      "token": "{token}"
    }},
    "tailscale": {{
      "mode": "off",
      "resetOnExit": false
    }}
  }},
  "auth": {{
    "profiles": {{
      "{profile}": {{
        "provider": "{provider}",
        "mode": "{mode}"
      }}
    }}
  }}
}}"#,
        model = config.model,
        token = gateway_token,
        profile = profile_name,
        provider = config.provider,
        mode = auth_mode
    );

    // Create directories and write config
    execute_ssh(&remote, "mkdir -p ~/.openclaw/agents/main/agent")?;
    execute_ssh(&remote, "mkdir -p ~/.openclaw/workspace")?;

    // Write config file
    let write_config_cmd = format!("cat > ~/.openclaw/openclaw.json << 'EOF'\n{}\nEOF", config_json);
    execute_ssh(&remote, &write_config_cmd)?;

    // Write auth-profiles.json
    let auth_profiles = format!(r#"{{
  "version": 1,
  "profiles": {{
    "{profile}": {{
      "type": "{mode}",
      "provider": "{provider}",
      "token": "{api_key}"
    }}
  }},
  "lastGood": {{
    "{provider}": "{profile}"
  }},
  "usageStats": {{}}
}}"#,
        profile = profile_name,
        mode = auth_mode,
        provider = config.provider,
        api_key = config.api_key
    );

    let write_auth_cmd = format!("cat > ~/.openclaw/agents/main/agent/auth-profiles.json << 'EOF'\n{}\nEOF", auth_profiles);
    execute_ssh(&remote, &write_auth_cmd)?;

    // Write workspace files
    let identity_md = config.identity_md.unwrap_or_else(|| {
        format!("# IDENTITY.md\n- **Name:** {}\n- **Vibe:** {}\n", config.agent_name, config.agent_vibe)
    });
    let write_identity_cmd = format!("cat > ~/.openclaw/workspace/IDENTITY.md << 'EOF'\n{}\nEOF", identity_md);
    execute_ssh(&remote, &write_identity_cmd)?;

    let user_md = config.user_md.unwrap_or_else(|| {
        format!("# USER.md\n- **Name:** {}\n", config.user_name)
    });
    let write_user_cmd = format!("cat > ~/.openclaw/workspace/USER.md << 'EOF'\n{}\nEOF", user_md);
    execute_ssh(&remote, &write_user_cmd)?;

    let soul_md = config.soul_md.unwrap_or_else(|| {
        format!("# SOUL.md\n## Mission\nServe {}.", config.user_name)
    });
    let write_soul_cmd = format!("cat > ~/.openclaw/workspace/SOUL.md << 'EOF'\n{}\nEOF", soul_md);
    execute_ssh(&remote, &write_soul_cmd)?;

    // Install and start gateway
    execute_ssh(&remote, "openclaw gateway install --force")?;
    execute_ssh(&remote, "openclaw gateway start")?;

    Ok("Remote OpenClaw setup completed successfully".to_string())
}

#[command]
fn start_ssh_tunnel(remote: RemoteInfo) -> Result<String, String> {
    // Check if tunnel is already running
    if TUNNEL_RUNNING.load(Ordering::Relaxed) {
        return Err("SSH tunnel is already running".to_string());
    }

    // Mark tunnel as running
    TUNNEL_RUNNING.store(true, Ordering::Relaxed);

    // Spawn background thread for tunnel
    thread::spawn(move || {
        if let Err(e) = run_tunnel(&remote) {
            eprintln!("SSH tunnel error: {}", e);
            TUNNEL_RUNNING.store(false, Ordering::Relaxed);
        }
    });

    // Give it a moment to establish
    thread::sleep(Duration::from_secs(2));

    // Verify local port is listening
    if TcpStream::connect("127.0.0.1:18789").is_ok() {
        Ok("SSH tunnel established successfully".to_string())
    } else {
        Err("SSH tunnel failed to establish".to_string())
    }
}

fn run_tunnel(remote: &RemoteInfo) -> Result<(), String> {
    let sess = connect_ssh(remote)?;

    // Create local listener on port 18789
    let listener = TcpListener::bind("127.0.0.1:18789")
        .map_err(|e| format!("Failed to bind local port 18789: {}", e))?;

    for stream in listener.incoming() {
        if !TUNNEL_RUNNING.load(Ordering::Relaxed) {
            break;
        }

        let mut stream = match stream {
            Ok(s) => s,
            Err(_) => continue,
        };

        // Forward to remote port 18789
        let mut channel = match sess.channel_direct_tcpip("127.0.0.1", 18789, None) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Bidirectional copy
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                let n = match stream.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(_) => break,
                };

                if channel.write_all(&buf[..n]).is_err() {
                    break;
                }
            }
        });
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

// Helper to run shell commands with proper PATH (fixes macOS Tauri PATH issue)
fn shell_command(cmd: &str) -> Result<String, String> {
    // On macOS, GUI apps don't inherit the shell's PATH.
    // We source common profile files and manually add common paths.
    // We redirect ALL preamble output to /dev/null.
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
        // Strip common shell preamble errors from stderr if they somehow leaked
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
            // SSH Remote Commands
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
            get_remote_gateway_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}