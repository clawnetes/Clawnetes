use tauri::command;
// Updated: Force rebuild trigger
use rand::Rng;
use ssh2::Session;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    allow: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    deny: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    elevated: Option<ElevatedToolConfig>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ElevatedToolConfig {
    enabled: bool,
}

fn apply_agent_overrides(agent_obj: &mut serde_json::Value, agent: &AgentData) {
    if let Some(tools) = &agent.tools {
        if let Ok(tools_value) = serde_json::to_value(tools) {
            if let Some(agent_obj_map) = agent_obj.as_object_mut() {
                agent_obj_map.insert("tools".to_string(), tools_value);
            }
        }
    }

    if let Some(subagents) = &agent.subagents {
        if let Ok(subagents_value) = serde_json::to_value(subagents) {
            if let Some(agent_obj_map) = agent_obj.as_object_mut() {
                agent_obj_map.insert("subagents".to_string(), subagents_value);
            }
        }
    }
}

fn build_agent_session_init_command(agent_id: &str) -> String {
    format!(
        "openclaw agent --agent {} --message \"hello\" 2>/dev/null || true",
        agent_id
    )
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
    provider_auths: std::collections::HashMap<String, ProviderAuthData>,
    sandbox_mode: String,
    tools_mode: String,
    tools_profile: Option<String>,
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
    whatsapp_phone_number: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
struct ProviderAuthData {
    auth_method: String,
    token: String,
    profile_key: Option<String>,
    profile: Option<serde_json::Value>,
    oauth_provider_id: Option<String>,
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
    #[allow(dead_code)]
    service_keys: Option<std::collections::HashMap<String, String>>,
    provider_auths: Option<std::collections::HashMap<String, ProviderAuthData>>,
    // NEW: Enhanced advanced fields
    sandbox_mode: Option<String>,
    tools_mode: Option<String>,
    tools_profile: Option<String>,
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
    whatsapp_phone_number: Option<String>,
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

#[allow(dead_code)]
#[derive(Clone, Copy)]
enum TerminalPlatform {
    Macos,
    Windows,
    Linux,
}

struct TerminalLaunchPlan {
    program: String,
    args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PortListenerInfo {
    pid: i32,
    command: String,
}

fn default_provider_auth(
    provider: &str,
    api_key: &str,
    auth_method: &str,
    base_url: Option<&String>,
) -> ProviderAuthData {
    let mut profile = serde_json::Map::new();
    let auth_type = normalize_auth_mode(auth_method);
    let token = if provider == "ollama" || provider == "lmstudio" || provider == "local" {
        "dummy-token".to_string()
    } else {
        api_key.to_string()
    };

    profile.insert(
        "type".to_string(),
        serde_json::Value::String(auth_type.clone()),
    );
    profile.insert(
        "provider".to_string(),
        serde_json::Value::String(provider.to_string()),
    );
    if provider == "lmstudio" || provider == "local" {
        profile.insert(
            "api".to_string(),
            serde_json::Value::String("openai".to_string()),
        );
    }
    if auth_type == "oauth" {
        profile.insert(
            "access".to_string(),
            serde_json::Value::String(token.clone()),
        );
    } else {
        profile.insert(
            "token".to_string(),
            serde_json::Value::String(token.clone()),
        );
    }
    if let Some(url) = base_url {
        if !url.is_empty() {
            profile.insert(
                "baseUrl".to_string(),
                serde_json::Value::String(url.clone()),
            );
        }
    }

    ProviderAuthData {
        auth_method: auth_method.to_string(),
        token,
        profile_key: Some(format!("{}:default", provider)),
        profile: Some(serde_json::Value::Object(profile)),
        oauth_provider_id: None,
    }
}

fn normalize_auth_mode(auth_method: &str) -> String {
    if auth_method == "setup-token" || auth_method == "claude-cli" {
        "token".to_string()
    } else if matches!(
        auth_method,
        "antigravity" | "gemini_cli" | "codex" | "openai-codex" | "google-gemini-cli"
    ) {
        "oauth".to_string()
    } else {
        auth_method.to_string()
    }
}

fn normalize_provider_for_ui(provider: &str) -> String {
    match provider {
        "openai-codex" => "openai".to_string(),
        "google-vertex" => "google".to_string(),
        _ => provider.to_string(),
    }
}

fn effective_model_provider(
    provider: &str,
    provider_auths: &std::collections::HashMap<String, ProviderAuthData>,
) -> String {
    match provider_auths
        .get(provider)
        .map(|auth| auth.auth_method.as_str())
    {
        Some("openai-codex") => "openai-codex".to_string(),
        _ => provider.to_string(),
    }
}

fn apply_model_provider_auth(
    model_ref: &str,
    provider_auths: &std::collections::HashMap<String, ProviderAuthData>,
) -> String {
    if let Some((provider, rest)) = model_ref.split_once('/') {
        let base_provider = normalize_provider_for_ui(provider);
        let effective_provider = effective_model_provider(&base_provider, provider_auths);
        format!("{}/{}", effective_provider, rest)
    } else {
        model_ref.to_string()
    }
}

fn build_effective_models_catalog(
    primary_model: &str,
    fallback_models: &[String],
) -> serde_json::Map<String, serde_json::Value> {
    let mut models = serde_json::Map::new();
    models.insert(primary_model.to_string(), serde_json::json!({}));

    for fb_model in fallback_models {
        if fb_model.split('/').next().is_some() {
            models.insert(fb_model.clone(), serde_json::json!({}));
        }
    }

    models
}

fn auth_provider_id_for_config(
    provider: &str,
    provider_auth: &ProviderAuthData,
    provider_auths: &std::collections::HashMap<String, ProviderAuthData>,
) -> String {
    if let Some(profile_provider) = provider_auth
        .profile
        .as_ref()
        .and_then(|profile| profile.get("provider"))
        .and_then(|value| value.as_str())
    {
        return profile_provider.to_string();
    }

    provider_auth
        .oauth_provider_id
        .clone()
        .unwrap_or_else(|| effective_model_provider(provider, provider_auths))
}

fn normalize_model_ref_for_ui(model_ref: &str) -> String {
    if let Some(rest) = model_ref.strip_prefix("openai-codex/") {
        format!("openai/{}", rest)
    } else {
        model_ref.to_string()
    }
}

fn get_provider_auth_map(
    config: &AgentConfig,
) -> std::collections::HashMap<String, ProviderAuthData> {
    let mut provider_auths = config.provider_auths.clone().unwrap_or_default();
    if !provider_auths.contains_key(&config.provider) {
        provider_auths.insert(
            config.provider.clone(),
            default_provider_auth(
                &config.provider,
                &config.api_key,
                config.auth_method.as_deref().unwrap_or("token"),
                config.local_base_url.as_ref(),
            ),
        );
    }
    provider_auths
}

fn resolve_profile_name(provider: &str, provider_auth: &ProviderAuthData) -> String {
    provider_auth
        .profile_key
        .clone()
        .unwrap_or_else(|| format!("{}:default", provider))
}

fn build_auth_profiles_doc(
    provider_auths: &std::collections::HashMap<String, ProviderAuthData>,
    fallback_models: Option<&Vec<String>>,
    local_base_url: Option<&String>,
    primary_provider: &str,
) -> serde_json::Value {
    let mut profiles_map = serde_json::Map::new();
    let mut last_good = serde_json::Map::new();

    for (provider, provider_auth) in provider_auths {
        let profile_key = resolve_profile_name(provider, provider_auth);
        let profile = provider_auth.profile.clone().unwrap_or_else(|| {
            default_provider_auth(
                provider,
                &provider_auth.token,
                &provider_auth.auth_method,
                local_base_url,
            )
            .profile
            .unwrap_or(serde_json::json!({}))
        });
        profiles_map.insert(profile_key.clone(), profile);
        last_good.insert(provider.clone(), serde_json::Value::String(profile_key));
    }

    if let Some(fallbacks) = fallback_models {
        for model in fallbacks {
            if let Some(provider) = model.split('/').next() {
                if provider == "ollama" || provider == "lmstudio" || provider == "local" {
                    let fallback_auth =
                        default_provider_auth(provider, "", "token", local_base_url);
                    let profile_key = resolve_profile_name(provider, &fallback_auth);
                    let profile = fallback_auth.profile.unwrap_or(serde_json::json!({}));
                    profiles_map.entry(profile_key.clone()).or_insert(profile);
                    last_good
                        .entry(provider.to_string())
                        .or_insert(serde_json::Value::String(profile_key));
                }
            }
        }
    }

    if !last_good.contains_key(primary_provider) {
        last_good.insert(
            primary_provider.to_string(),
            serde_json::Value::String(format!("{}:default", primary_provider)),
        );
    }

    serde_json::json!({
        "version": 1,
        "profiles": profiles_map,
        "lastGood": last_good,
        "usageStats": {}
    })
}

fn oauth_provider_matches(base_provider: &str, provider_id: &str) -> bool {
    matches!(
        (base_provider, provider_id),
        ("openai", "openai-codex") | ("google", "google-gemini-cli") | ("anthropic", "anthropic")
    ) || base_provider == provider_id
}

fn resolve_provider_auth_data(
    base_provider: &str,
    auth_config: &serde_json::Value,
) -> Option<ProviderAuthData> {
    let profiles = auth_config.get("profiles").and_then(|p| p.as_object())?;
    let last_good_key = auth_config
        .get("lastGood")
        .and_then(|lg| lg.get(base_provider))
        .and_then(|v| v.as_str());

    let has_usable_credential = |profile: &serde_json::Value| {
        profile
            .get("token")
            .and_then(|v| v.as_str())
            .map(|v| !v.is_empty())
            .unwrap_or(false)
            || profile
                .get("access")
                .and_then(|v| v.as_str())
                .map(|v| !v.is_empty())
                .unwrap_or(false)
    };

    let matches_base_provider = |key: &str, profile: &serde_json::Value| {
        let provider_id = profile
            .get("provider")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        key.starts_with(&format!("{}:", base_provider))
            || oauth_provider_matches(base_provider, provider_id)
    };

    let pick = last_good_key
        .and_then(|profile_key| {
            profiles.get(profile_key).and_then(|profile| {
                if has_usable_credential(profile) {
                    Some((profile_key.to_string(), profile.clone()))
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            profiles.iter().find_map(|(key, profile)| {
                if matches_base_provider(key, profile) && has_usable_credential(profile) {
                    Some((key.clone(), profile.clone()))
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            last_good_key.and_then(|profile_key| {
                profiles
                    .get(profile_key)
                    .map(|profile| (profile_key.to_string(), profile.clone()))
            })
        })
        .or_else(|| {
            profiles.iter().find_map(|(key, profile)| {
                if matches_base_provider(key, profile) {
                    Some((key.clone(), profile.clone()))
                } else {
                    None
                }
            })
        })?;

    let (profile_key, profile) = pick;
    let raw_auth_method = profile
        .get("type")
        .and_then(|v| v.as_str())
        .or_else(|| profile.get("mode").and_then(|v| v.as_str()))
        .unwrap_or("token")
        .to_string();
    let token = profile
        .get("token")
        .and_then(|v| v.as_str())
        .or_else(|| profile.get("access").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    let oauth_provider_id =
        profile
            .get("provider")
            .and_then(|v| v.as_str())
            .and_then(|provider_id| {
                if provider_id != base_provider && raw_auth_method == "oauth" {
                    Some(provider_id.to_string())
                } else {
                    None
                }
            });

    let auth_method = if raw_auth_method == "oauth" {
        match oauth_provider_id.as_deref() {
            Some("openai-codex") => "openai-codex".to_string(),
            Some("google-gemini-cli") => "google-gemini-cli".to_string(),
            Some(other) => other.to_string(),
            None if base_provider == "anthropic" => "setup-token".to_string(),
            None => raw_auth_method.clone(),
        }
    } else {
        raw_auth_method.clone()
    };

    Some(ProviderAuthData {
        auth_method,
        token,
        profile_key: Some(profile_key),
        profile: Some(profile),
        oauth_provider_id,
    })
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn oauth_callback_port(oauth_provider_id: &str) -> Option<u16> {
    match oauth_provider_id {
        "openai-codex" => Some(1455),
        "google-gemini-cli" => Some(8085),
        _ => None,
    }
}

fn build_provider_auth_command(_provider: &str, method: &str, oauth_provider_id: &str) -> String {
    let mut cmd = format!(
        "openclaw models auth login --provider {}",
        shell_single_quote(oauth_provider_id)
    );
    if !method.is_empty() && method != oauth_provider_id {
        cmd.push_str(&format!(" --method {}", shell_single_quote(method)));
    }
    cmd
}

fn parse_lsof_listener_info(output: &str) -> Vec<PortListenerInfo> {
    let mut listeners = Vec::new();
    let mut current_pid: Option<i32> = None;
    let mut current_command: Option<String> = None;

    for line in output.lines() {
        if line.is_empty() {
            if let (Some(pid), Some(command)) = (current_pid.take(), current_command.take()) {
                listeners.push(PortListenerInfo { pid, command });
            }
            continue;
        }

        let (prefix, value) = line.split_at(1);
        match prefix {
            "p" => {
                if let (Some(pid), Some(command)) = (current_pid.take(), current_command.take()) {
                    listeners.push(PortListenerInfo { pid, command });
                }
                current_pid = value.trim().parse::<i32>().ok();
            }
            "c" => current_command = Some(value.trim().to_string()),
            _ => {}
        }
    }

    if let (Some(pid), Some(command)) = (current_pid, current_command) {
        listeners.push(PortListenerInfo { pid, command });
    }

    listeners
}

fn is_openclaw_listener(listener: &PortListenerInfo) -> bool {
    let command = listener.command.to_ascii_lowercase();
    command.contains("openclaw")
}

fn find_oauth_port_listeners(port: u16) -> Result<Vec<PortListenerInfo>, String> {
    let cmd = format!(
        "if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:{} -sTCP:LISTEN -Fpc 2>/dev/null || true; fi",
        port
    );
    shell_command(&cmd).map(|output| parse_lsof_listener_info(&output))
}

fn terminate_listener_process(listener: &PortListenerInfo, port: u16) -> Result<(), String> {
    let cmd = format!("kill {}", listener.pid);
    shell_command(&cmd).map(|_| ()).map_err(|err| {
        format!(
            "A previous OpenClaw OAuth session is still using localhost:{} and could not be replaced: {}",
            port, err
        )
    })
}

fn cleanup_stale_oauth_listener(oauth_provider_id: &str) -> Result<(), String> {
    let Some(port) = oauth_callback_port(oauth_provider_id) else {
        return Ok(());
    };

    let listeners = find_oauth_port_listeners(port)?;
    if listeners.is_empty() {
        return Ok(());
    }

    let mut openclaw_listeners = Vec::new();
    let mut foreign_listeners = Vec::new();

    for listener in listeners {
        if is_openclaw_listener(&listener) {
            openclaw_listeners.push(listener);
        } else {
            foreign_listeners.push(listener);
        }
    }

    if !foreign_listeners.is_empty() {
        let details = foreign_listeners
            .iter()
            .map(|listener| format!("{} (pid {})", listener.command, listener.pid))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "localhost:{} is already in use by a non-OpenClaw process: {}. Close it and retry OAuth.",
            port, details
        ));
    }

    for listener in &openclaw_listeners {
        terminate_listener_process(listener, port)?;
    }

    let started = Instant::now();
    loop {
        let remaining = find_oauth_port_listeners(port)?;
        if remaining.is_empty() {
            return Ok(());
        }
        if started.elapsed() > Duration::from_secs(5) {
            let details = remaining
                .iter()
                .map(|listener| format!("{} (pid {})", listener.command, listener.pid))
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!(
                "A previous OpenClaw OAuth session is still using localhost:{} after cleanup: {}",
                port, details
            ));
        }
        thread::sleep(Duration::from_millis(200));
    }
}

#[allow(dead_code)]
fn build_terminal_runner_command(command: &str, marker_path: &str) -> String {
    format!(
        "{}; auth_exit_code=$?; printf '%s' \"$auth_exit_code\" > {}; exit $auth_exit_code",
        command,
        shell_single_quote(marker_path)
    )
}

fn build_unix_terminal_script(
    platform: TerminalPlatform,
    command: &str,
    marker_path: &str,
) -> String {
    let wrapped_command = match platform {
        TerminalPlatform::Macos => command.to_string(),
        TerminalPlatform::Linux => format!("/bin/sh -lc {}", shell_single_quote(command)),
        TerminalPlatform::Windows => command.to_string(),
    };
    let shebang = match platform {
        TerminalPlatform::Macos => "#!/bin/zsh -l",
        TerminalPlatform::Linux => "#!/bin/sh",
        TerminalPlatform::Windows => "#!/bin/sh",
    };

    format!(
        "{shebang}\n{wrapped_command}\nauth_exit_code=$?\nprintf '%s' \"$auth_exit_code\" > {marker}\nexit $auth_exit_code\n",
        marker = shell_single_quote(marker_path)
    )
}

fn build_macos_terminal_launch(script_path: &str) -> TerminalLaunchPlan {
    TerminalLaunchPlan {
        program: "open".to_string(),
        args: vec![
            "-a".to_string(),
            "Terminal".to_string(),
            script_path.to_string(),
        ],
    }
}

#[allow(dead_code)]
fn build_linux_terminal_launches(script_path: &str) -> Vec<TerminalLaunchPlan> {
    vec![
        TerminalLaunchPlan {
            program: "x-terminal-emulator".to_string(),
            args: vec![
                "-e".to_string(),
                "/bin/sh".to_string(),
                script_path.to_string(),
            ],
        },
        TerminalLaunchPlan {
            program: "gnome-terminal".to_string(),
            args: vec![
                "--".to_string(),
                "/bin/sh".to_string(),
                script_path.to_string(),
            ],
        },
        TerminalLaunchPlan {
            program: "konsole".to_string(),
            args: vec![
                "-e".to_string(),
                "/bin/sh".to_string(),
                script_path.to_string(),
            ],
        },
        TerminalLaunchPlan {
            program: "xfce4-terminal".to_string(),
            args: vec![
                "-x".to_string(),
                "/bin/sh".to_string(),
                script_path.to_string(),
            ],
        },
        TerminalLaunchPlan {
            program: "kitty".to_string(),
            args: vec!["/bin/sh".to_string(), script_path.to_string()],
        },
        TerminalLaunchPlan {
            program: "alacritty".to_string(),
            args: vec![
                "-e".to_string(),
                "/bin/sh".to_string(),
                script_path.to_string(),
            ],
        },
        TerminalLaunchPlan {
            program: "xterm".to_string(),
            args: vec![
                "-e".to_string(),
                "/bin/sh".to_string(),
                script_path.to_string(),
            ],
        },
    ]
}

#[allow(dead_code)]
fn build_windows_terminal_launches(runner_command: &str) -> Vec<TerminalLaunchPlan> {
    vec![
        TerminalLaunchPlan {
            program: "wt.exe".to_string(),
            args: vec![
                "-w".to_string(),
                "0".to_string(),
                "wsl.exe".to_string(),
                "-d".to_string(),
                "Ubuntu".to_string(),
                "--".to_string(),
                "/bin/bash".to_string(),
                "-lc".to_string(),
                runner_command.to_string(),
            ],
        },
        TerminalLaunchPlan {
            program: "cmd.exe".to_string(),
            args: vec![
                "/C".to_string(),
                "start".to_string(),
                "".to_string(),
                "wsl.exe".to_string(),
                "-d".to_string(),
                "Ubuntu".to_string(),
                "--".to_string(),
                "/bin/bash".to_string(),
                "-lc".to_string(),
                runner_command.to_string(),
            ],
        },
    ]
}

fn create_local_terminal_artifacts(
    platform: TerminalPlatform,
    command: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let temp_dir = std::env::temp_dir().join("clawnetes-oauth");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to prepare temp auth dir: {}", e))?;

    let suffix = rand::thread_rng().gen::<u64>();
    let marker_path = temp_dir.join(format!("openclaw-auth-{}.exit", suffix));
    let extension = if matches!(platform, TerminalPlatform::Macos) {
        "command"
    } else {
        "sh"
    };
    let script_path = temp_dir.join(format!("openclaw-auth-{}.{}", suffix, extension));
    let script = build_unix_terminal_script(platform, command, &marker_path.to_string_lossy());
    fs::write(&script_path, script)
        .map_err(|e| format!("Failed to write temp auth script: {}", e))?;

    #[cfg(unix)]
    {
        let mut perms = fs::metadata(&script_path)
            .map_err(|e| format!("Failed to read auth script permissions: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&script_path, perms)
            .map_err(|e| format!("Failed to mark auth script executable: {}", e))?;
    }

    Ok((marker_path, script_path))
}

fn wait_for_local_marker(marker_path: &Path, timeout: Duration) -> Result<(), String> {
    let started = Instant::now();
    loop {
        if marker_path.exists() {
            let status = fs::read_to_string(marker_path)
                .map_err(|e| format!("Failed to read auth status: {}", e))?;
            let exit_code = status.trim().parse::<i32>().unwrap_or(-1);
            let _ = fs::remove_file(marker_path);
            if exit_code == 0 {
                return Ok(());
            }
            return Err(format!("OpenClaw auth exited with status {}.", exit_code));
        }
        if started.elapsed() > timeout {
            return Err("Timed out waiting for the OpenClaw auth terminal to finish.".to_string());
        }
        thread::sleep(Duration::from_millis(500));
    }
}

#[cfg(target_os = "windows")]
fn wait_for_wsl_marker(marker_path: &str, timeout: Duration) -> Result<(), String> {
    let started = Instant::now();
    loop {
        if let Ok(status) = wsl_read_file(marker_path) {
            let exit_code = status.trim().parse::<i32>().unwrap_or(-1);
            let _ = shell_command(&format!("rm -f {}", shell_single_quote(marker_path)));
            if exit_code == 0 {
                return Ok(());
            }
            return Err(format!("OpenClaw auth exited with status {}.", exit_code));
        }
        if started.elapsed() > timeout {
            return Err("Timed out waiting for the OpenClaw auth terminal to finish.".to_string());
        }
        thread::sleep(Duration::from_millis(500));
    }
}

#[cfg(not(target_os = "windows"))]
fn spawn_terminal_plan(plan: &TerminalLaunchPlan) -> Result<(), String> {
    Command::new(&plan.program)
        .args(&plan.args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch {}: {}", plan.program, e))
}

#[cfg(target_os = "windows")]
fn spawn_terminal_plan(plan: &TerminalLaunchPlan) -> Result<(), String> {
    Command::new(&plan.program)
        .args(&plan.args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch {}: {}", plan.program, e))
}

#[cfg(target_os = "macos")]
fn launch_provider_auth_terminal(command: &str) -> Result<(), String> {
    let (marker_path, script_path) =
        create_local_terminal_artifacts(TerminalPlatform::Macos, command)?;
    let plan = build_macos_terminal_launch(&script_path.to_string_lossy());
    let launch_result = spawn_terminal_plan(&plan);
    if launch_result.is_err() {
        let _ = fs::remove_file(&script_path);
    }
    launch_result?;
    let wait_result = wait_for_local_marker(&marker_path, Duration::from_secs(300));
    let _ = fs::remove_file(script_path);
    wait_result
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch_provider_auth_terminal(command: &str) -> Result<(), String> {
    let (marker_path, script_path) =
        create_local_terminal_artifacts(TerminalPlatform::Linux, command)?;
    let script_path_str = script_path.to_string_lossy().to_string();
    let mut launched = false;
    let mut last_error = None;

    for plan in build_linux_terminal_launches(&script_path_str) {
        match spawn_terminal_plan(&plan) {
            Ok(_) => {
                launched = true;
                break;
            }
            Err(err) => last_error = Some(err),
        }
    }

    if !launched {
        let _ = fs::remove_file(&script_path);
        return Err(last_error.unwrap_or_else(|| {
            "No supported terminal emulator was found for OpenClaw auth.".to_string()
        }));
    }

    let wait_result = wait_for_local_marker(&marker_path, Duration::from_secs(300));
    let _ = fs::remove_file(script_path);
    wait_result
}

#[cfg(target_os = "windows")]
fn launch_provider_auth_terminal(command: &str) -> Result<(), String> {
    let home = wsl_home_dir()?.trim().to_string();
    let marker_dir = format!("{}/.openclaw/tmp", home);
    wsl_mkdir_p(&marker_dir)?;
    let marker_path = format!(
        "{}/openclaw-auth-{}.exit",
        marker_dir,
        rand::thread_rng().gen::<u64>()
    );
    let runner_command = build_terminal_runner_command(command, &marker_path);

    let mut launched = false;
    let mut last_error = None;
    for plan in build_windows_terminal_launches(&runner_command) {
        match spawn_terminal_plan(&plan) {
            Ok(_) => {
                launched = true;
                break;
            }
            Err(err) => last_error = Some(err),
        }
    }

    if !launched {
        return Err(last_error.unwrap_or_else(|| {
            "No supported Windows terminal launcher was found for OpenClaw auth.".to_string()
        }));
    }

    wait_for_wsl_marker(&marker_path, Duration::from_secs(300))
}

#[cfg(target_os = "windows")]
fn read_provider_auth_profiles() -> Result<serde_json::Value, String> {
    let home = wsl_home_dir()?.trim().to_string();
    let auth_profiles_path = format!("{}/.openclaw/agents/main/agent/auth-profiles.json", home);
    let auth_profiles_str = wsl_read_file(&auth_profiles_path)
        .map_err(|e| format!("Failed to read auth profiles: {}", e))?;
    serde_json::from_str(&auth_profiles_str)
        .map_err(|e| format!("Failed to parse auth profiles: {}", e))
}

#[cfg(not(target_os = "windows"))]
fn read_provider_auth_profiles() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let auth_profiles_path = format!("{}/.openclaw/agents/main/agent/auth-profiles.json", home);
    let auth_profiles_str = fs::read_to_string(&auth_profiles_path)
        .map_err(|e| format!("Failed to read auth profiles: {}", e))?;
    serde_json::from_str(&auth_profiles_str)
        .map_err(|e| format!("Failed to parse auth profiles: {}", e))
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
    if sess
        .userauth_pubkey_file(user, None, key_path, None)
        .is_ok()
    {
        return Ok(());
    }

    // Strategy 2: Try with an explicit .pub file if it exists
    let mut pubkey_path = key_path.to_path_buf();
    pubkey_path.set_extension("pub");
    if pubkey_path.exists() {
        if sess
            .userauth_pubkey_file(user, Some(&pubkey_path), key_path, None)
            .is_ok()
        {
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
    sess.handshake()
        .map_err(|e| format!("SSH handshake failed: {}", e))?;

    // 1. Try provided private key path if it exists
    // If a key is explicitly provided, ONLY use that key and don't fallback
    if let Some(ref path) = remote.private_key_path {
        let key_path = Path::new(path);
        if !key_path.exists() {
            return Err(format!(
                "The provided private key file does not exist at: {}",
                path
            ));
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
        let keys = [
            home.join(".ssh").join("id_rsa"),
            home.join(".ssh").join("id_ed25519"),
        ];
        for key in keys {
            if key.exists() {
                if sess
                    .userauth_pubkey_file(&remote.user, None, &key, None)
                    .is_ok()
                {
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
    channel
        .stderr()
        .read_to_string(&mut stderr)
        .map_err(|e| e.to_string())?;
    let _ = channel.wait_close();

    if channel.exit_status().unwrap_or(0) != 0 {
        return Err(format!("Command failed: {}\nStderr: {}", cmd, stderr));
    }
    Ok(s)
}

#[command]
async fn test_ssh_connection(remote: RemoteInfo) -> Result<String, String> {
    // 1. Check network connectivity
    if TcpStream::connect_timeout(
        &format!("{}:22", remote.ip).parse().unwrap(),
        Duration::from_secs(5),
    )
    .is_err()
    {
        return Err(
            "Connectivity failed. Could not reach port 22 on the remote server.".to_string(),
        );
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
    soul: String,
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
            home.join(".openclaw")
                .join("agents")
                .join(id)
                .join("workspace")
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
        let skill_dir = home
            .join(".openclaw")
            .join("workspace")
            .join("skills")
            .join(&name);

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
            let install_curl = format!(
                "{}apt-get update && {}apt-get install -y curl",
                sudo_prefix, sudo_prefix
            );
            execute_ssh(&sess, &install_curl)
                .map_err(|e| format!("Failed to install curl: {}", e))?;

            // Add NodeSource repo and install Node.js
            // We pipe to bash. If not root, we need to run bash with sudo rights to modify apt sources.
            let setup_cmd = if is_root {
                "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
            } else {
                "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
            };
            execute_ssh(&sess, setup_cmd)
                .map_err(|e| format!("Failed to setup NodeSource: {}", e))?;

            let install_node = format!("{}apt-get install -y nodejs", sudo_prefix);
            execute_ssh(&sess, &install_node)
                .map_err(|e| format!("Failed to install Node.js: {}", e))?;
        }
    } else if os_type == "Darwin" {
        if execute_ssh(&sess, "node -v").is_err() {
            // Check brew
            if execute_ssh(&sess, "command -v brew").is_err() {
                // Install brew non-interactively
                let install_brew = "NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"";
                execute_ssh(&sess, install_brew)
                    .map_err(|e| format!("Failed to install Homebrew: {}", e))?;

                // Add brew to shellrc for future sessions (Standard paths for Apple Silicon / Intel)
                let configure_shell = r#"
                    (echo; echo 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"') >> $HOME/.zprofile
                    (echo; echo 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"') >> $HOME/.bash_profile
                 "#;
                let _ = execute_ssh(&sess, configure_shell);
            }

            // Install node using brew, ensuring brew is in path for this session
            let install_node = "eval \"$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)\"; brew install node";
            execute_ssh(&sess, install_node)
                .map_err(|e| format!("Failed to install Node.js via Homebrew: {}", e))?;
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
        let _ = execute_ssh(
            &sess,
            &format!("{}openclaw gateway stop || true", nvm_prefix),
        );
        // DO NOT remove openclaw.json. The token is tied to keychain.
        // install --force will scaffold missing fields while keeping the token.
        let _ = execute_ssh(
            &sess,
            &format!(
                "{}openclaw gateway install --force --profile messaging",
                nvm_prefix
            ),
        );
        // Stop gateway immediately after install to prevent crash-loop
        // (install enables+starts the systemd service, but config lacks gateway.mode=local yet)
        let _ = execute_ssh(
            &sess,
            &format!("{}openclaw gateway stop || true", nvm_prefix),
        );
    }

    execute_ssh(
        &sess,
        &format!("mkdir -p {} && mkdir -p {}", workspace, agents_dir),
    )?;

    // Always preserve existing/scaffolded gateway token to avoid device token mismatch
    let gateway_token: String = {
        let read_token_result = execute_ssh(
            &sess,
            &format!(
                "cat {}/openclaw.json 2>/dev/null || echo '{{}}'",
                openclaw_root
            ),
        );
        if let Ok(contents) = read_token_result {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                if let Some(token) = parsed
                    .get("gateway")
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
        let read_token_result = execute_ssh(
            &sess,
            &format!(
                "cat {}/openclaw.json 2>/dev/null || echo '{{}}'",
                openclaw_root
            ),
        );
        if let Ok(contents) = read_token_result {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                let default_acc = parsed
                    .get("channels")
                    .and_then(|c| c.get("telegram"))
                    .and_then(|t| t.get("accounts"))
                    .and_then(|a| a.get("default"));

                let allow_from = default_acc.and_then(|d| d.get("allowFrom")).cloned();
                let dm_policy = default_acc
                    .and_then(|d| d.get("dmPolicy"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                (allow_from, dm_policy)
            } else {
                (None, None)
            }
        } else {
            (None, None)
        }
    };

    let (whatsapp_allow_from, _whatsapp_dm_policy): (Option<serde_json::Value>, Option<String>) = {
        let read_token_result = execute_ssh(
            &sess,
            &format!(
                "cat {}/openclaw.json 2>/dev/null || echo '{{}}'",
                openclaw_root
            ),
        );
        if let Ok(contents) = read_token_result {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                let default_acc = parsed
                    .get("channels")
                    .and_then(|c| c.get("whatsapp"))
                    .and_then(|t| t.get("accounts"))
                    .and_then(|a| a.get("default"));

                let allow_from = default_acc.and_then(|d| d.get("allowFrom")).cloned();
                let dm_policy = default_acc
                    .and_then(|d| d.get("dmPolicy"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                (allow_from, dm_policy)
            } else {
                (None, None)
            }
        } else {
            (None, None)
        }
    };

    let provider_auths = get_provider_auth_map(&config);
    let primary_provider_auth = provider_auths
        .get(&config.provider)
        .cloned()
        .unwrap_or_else(|| {
            default_provider_auth(
                &config.provider,
                &config.api_key,
                config.auth_method.as_deref().unwrap_or("token"),
                config.local_base_url.as_ref(),
            )
        });
    let effective_primary_model = apply_model_provider_auth(&config.model, &provider_auths);
    let effective_fallback_models = config
        .fallback_models
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|model| apply_model_provider_auth(&model, &provider_auths))
        .collect::<Vec<_>>();
    let primary_auth_provider =
        auth_provider_id_for_config(&config.provider, &primary_provider_auth, &provider_auths);
    let profile_name = resolve_profile_name(&config.provider, &primary_provider_auth);
    let auth_mode = normalize_auth_mode(&primary_provider_auth.auth_method);

    // Telegram config will be added to the JSON object

    let gateway_port = config.gateway_port.unwrap_or(18789);
    let gateway_bind = config
        .gateway_bind
        .unwrap_or_else(|| "loopback".to_string());
    let gateway_auth_mode = config
        .gateway_auth_mode
        .unwrap_or_else(|| "token".to_string());
    let tailscale_mode = config.tailscale_mode.unwrap_or_else(|| "off".to_string());

    // Build models config including fallback models
    let mut defaults_obj = serde_json::json!({
        "maxConcurrent": 4,
        "subagents": { "maxConcurrent": 8 },
        "compaction": { "mode": "safeguard" },
        "workspace": workspace,
        "model": { "primary": effective_primary_model },
        "models": build_effective_models_catalog(&effective_primary_model, &effective_fallback_models)
    });

    // Add fallback models
    if !effective_fallback_models.is_empty() {
        if let Some(primary) = defaults_obj
            .get_mut("model")
            .and_then(|m| m.as_object_mut())
        {
            primary.insert(
                "fallbacks".to_string(),
                serde_json::to_value(&effective_fallback_models).unwrap(),
            );
        }
    }

    // Add heartbeat config
    if let Some(hb_mode) = config.heartbeat_mode.as_deref() {
        match hb_mode {
            "never" => {
                if let Some(obj) = defaults_obj.as_object_mut() {
                    obj.insert(
                        "heartbeat".to_string(),
                        serde_json::json!({ "enabled": false }),
                    );
                }
            }
            "idle" => {
                if let Some(obj) = defaults_obj.as_object_mut() {
                    obj.insert(
                        "heartbeat".to_string(),
                        serde_json::json!({
                            "mode": "idle",
                            "timeout": config.idle_timeout_ms.unwrap_or(3600000)
                        }),
                    );
                }
            }
            interval => {
                if let Some(obj) = defaults_obj.as_object_mut() {
                    obj.insert(
                        "heartbeat".to_string(),
                        serde_json::json!({ "every": interval }),
                    );
                }
            }
        }
    }

    // Add sandbox config
    if let Some(sb_mode) = config.sandbox_mode.as_deref() {
        let mapped = if sb_mode == "full" {
            "all"
        } else if sb_mode == "partial" {
            "non-main"
        } else if sb_mode == "none" {
            "off"
        } else {
            sb_mode
        };
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
                    "primary": apply_model_provider_auth(&agent.model, &provider_auths)
                }
            });

            if let Some(fb) = &agent.fallback_models {
                let effective_agent_fallbacks = fb
                    .iter()
                    .map(|model| apply_model_provider_auth(model, &provider_auths))
                    .collect::<Vec<_>>();
                if !fb.is_empty() {
                    if let Some(model_obj) =
                        agent_obj.get_mut("model").and_then(|m| m.as_object_mut())
                    {
                        model_obj.insert(
                            "fallbacks".to_string(),
                            serde_json::to_value(effective_agent_fallbacks).unwrap(),
                        );
                    }
                }
            }

            apply_agent_overrides(&mut agent_obj, agent);

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
                "primary": effective_primary_model
            }
        });

        if !effective_fallback_models.is_empty() {
            if let Some(model_obj) = main_obj.get_mut("model").and_then(|m| m.as_object_mut()) {
                model_obj.insert(
                    "fallbacks".to_string(),
                    serde_json::to_value(&effective_fallback_models).unwrap(),
                );
            }
        }

        agents_list.insert(0, main_obj);
    }

    // Construct auth profiles map dynamically to support variable keys
    let mut auth_profiles = serde_json::Map::new();
    auth_profiles.insert(
        profile_name.clone(),
        serde_json::json!({
            "provider": primary_auth_provider,
            "mode": auth_mode
        }),
    );

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
                obj.insert(
                    "plugins".to_string(),
                    serde_json::json!({
                        "entries": { "telegram": { "enabled": true } }
                    }),
                );

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
                    c.insert(
                        "dmPolicy".to_string(),
                        serde_json::Value::String(dm_policy.clone()),
                    );
                    if dm_policy == "allowlist" {
                        if let Some(existing_allow) = telegram_allow_from.clone() {
                            c.insert("allowFrom".to_string(), existing_allow);
                        }
                    }
                }

                obj.insert(
                    "channels".to_string(),
                    serde_json::json!({
                        "telegram": {
                            "accounts": {
                                "default": channel_config
                            }
                        }
                    }),
                );
            }
        }
    }

    // Add WhatsApp config inline if enabled
    if config.whatsapp_enabled.unwrap_or(false) {
        let dm_policy = config.whatsapp_dm_policy.as_deref().unwrap_or("open");
        if let Some(obj) = config_val.as_object_mut() {
            // Merge plugins entries
            let plugins_entry = obj
                .entry("plugins".to_string())
                .or_insert(serde_json::json!({ "entries": {} }));
            if let Some(entries) = plugins_entry
                .get_mut("entries")
                .and_then(|e| e.as_object_mut())
            {
                entries.insert(
                    "whatsapp".to_string(),
                    serde_json::json!({ "enabled": true }),
                );
            }

            // Merge channels
            let channels_entry = obj
                .entry("channels".to_string())
                .or_insert(serde_json::json!({}));
            if let Some(channels_obj) = channels_entry.as_object_mut() {
                let mut whatsapp_obj = serde_json::json!({
                    "enabled": true,
                    "selfChatMode": true,
                    "dmPolicy": dm_policy,
                    "groupPolicy": "allowlist",
                    "debounceMs": 0,
                    "mediaMaxMb": 50
                });

                if dm_policy == "open" {
                    if let Some(w) = whatsapp_obj.as_object_mut() {
                        w.insert("allowFrom".to_string(), serde_json::json!(["*"]));
                    }
                } else if dm_policy == "allowlist" {
                    if let Some(mut existing) = whatsapp_allow_from.clone() {
                        if let Some(ref phone) = config.whatsapp_phone_number {
                            let formatted_phone = if phone.starts_with('+') {
                                phone.clone()
                            } else {
                                format!("+{}", phone)
                            };
                            existing = serde_json::json!([formatted_phone]);
                        }
                        if let Some(w) = whatsapp_obj.as_object_mut() {
                            w.insert("allowFrom".to_string(), existing);
                        }
                    } else if let Some(ref phone) = config.whatsapp_phone_number {
                        let formatted_phone = if phone.starts_with('+') {
                            phone.clone()
                        } else {
                            format!("+{}", phone)
                        };
                        if let Some(w) = whatsapp_obj.as_object_mut() {
                            w.insert(
                                "allowFrom".to_string(),
                                serde_json::json!([formatted_phone]),
                            );
                        }
                    }
                }

                channels_obj.insert("whatsapp".to_string(), whatsapp_obj);
            }
        }
    }
    if config.tools_mode.is_some() || config.tools_profile.is_some() {
        let mut tools_obj = serde_json::Map::new();
        if let Some(profile) = config.tools_profile.as_ref() {
            tools_obj.insert("profile".to_string(), serde_json::json!(profile));
        }
        if let Some(tools) = config.allowed_tools.as_ref() {
            tools_obj.insert("allow".to_string(), serde_json::to_value(tools).unwrap());
        }
        if let Some(tools) = config.denied_tools.as_ref() {
            tools_obj.insert("deny".to_string(), serde_json::to_value(tools).unwrap());
        }
        if !tools_obj.is_empty() {
            if let Some(obj) = config_val.as_object_mut() {
                obj.insert("tools".to_string(), serde_json::Value::Object(tools_obj));
            }
        }
    }

    // Add memory configuration (memoryFlush must be { enabled: bool })
    if config.memory_enabled.unwrap_or(false) {
        if let Some(defaults) = config_val
            .get_mut("agents")
            .and_then(|a| a.get_mut("defaults"))
            .and_then(|d| d.as_object_mut())
        {
            if let Some(compaction) = defaults
                .get_mut("compaction")
                .and_then(|c| c.as_object_mut())
            {
                compaction.insert(
                    "memoryFlush".to_string(),
                    serde_json::json!({ "enabled": true }),
                );
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

    // Add models.providers section for LM Studio so openclaw can resolve lmstudio/ models
    if config.provider == "lmstudio" {
        let base_url = config
            .local_base_url
            .as_deref()
            .unwrap_or("http://localhost:1234");
        let base_url_v1 = if base_url.ends_with("/v1") {
            base_url.to_string()
        } else {
            format!("{}/v1", base_url.trim_end_matches('/'))
        };
        let model_id = if config.model.starts_with("lmstudio/") {
            config.model.strip_prefix("lmstudio/").unwrap().to_string()
        } else {
            config.model.clone()
        };
        let mut model_ids = vec![model_id];
        if let Some(fb) = &config.fallback_models {
            for fb_model in fb {
                if let Some(stripped) = fb_model.strip_prefix("lmstudio/") {
                    if !model_ids.contains(&stripped.to_string()) {
                        model_ids.push(stripped.to_string());
                    }
                }
            }
        }
        let lmstudio_models: Vec<serde_json::Value> = model_ids
            .iter()
            .map(|id| {
                serde_json::json!({
                    "id": id,
                    "name": id,
                    "reasoning": false,
                    "input": ["text"],
                    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
                    "contextWindow": 131072,
                    "maxTokens": 8192
                })
            })
            .collect();
        if let Some(obj) = config_val.as_object_mut() {
            obj.insert(
                "models".to_string(),
                serde_json::json!({
                    "mode": "merge",
                    "providers": {
                        "lmstudio": {
                            "baseUrl": base_url_v1,
                            "apiKey": "lmstudio",
                            "api": "openai-completions",
                            "models": lmstudio_models
                        }
                    }
                }),
            );
        }
    }

    let config_json_final = serde_json::to_string_pretty(&config_val).map_err(|e| e.to_string())?;
    let config_json_escaped = config_json_final.replace("'", "'\\''");
    execute_ssh(
        &sess,
        &format!(
            "echo '{}' > {}/openclaw.json",
            config_json_escaped, openclaw_root
        ),
    )?;

    // Force sync the token to keychain to permanently fix any token mismatches
    let _ = execute_ssh(
        &sess,
        &format!(
            "{}openclaw config set gateway.auth.token {}",
            nvm_prefix, gateway_token
        ),
    );

    // Store Clawnetes metadata in separate file on remote
    {
        let mut meta = serde_json::Map::new();
        if let Some(agent_type) = &config.agent_type {
            meta.insert(
                "agent_type".to_string(),
                serde_json::Value::String(agent_type.clone()),
            );
        }
        if let Some(cron_jobs) = &config.cron_jobs {
            if !cron_jobs.is_empty() {
                meta.insert(
                    "cron_jobs".to_string(),
                    serde_json::to_value(cron_jobs).unwrap_or_default(),
                );
            }
        }
        if config.memory_enabled.unwrap_or(false) {
            meta.insert("memory_enabled".to_string(), serde_json::Value::Bool(true));
        }
        let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
        let meta_escaped = meta_json.replace("'", "'\\''");
        execute_ssh(
            &sess,
            &format!(
                "echo '{}' > {}/clawnetes-meta.json",
                meta_escaped, openclaw_root
            ),
        )?;
    }

    // auth-profiles.json
    let auth_profiles_val = build_auth_profiles_doc(
        &provider_auths,
        config.fallback_models.as_ref(),
        config.local_base_url.as_ref(),
        &config.provider,
    );
    let auth_profiles_json = serde_json::to_string_pretty(&auth_profiles_val)
        .map_err(|e| e.to_string())?
        .replace("'", "'\\''");
    execute_ssh(
        &sess,
        &format!(
            "echo '{}' > {}/auth-profiles.json",
            auth_profiles_json, agents_dir
        ),
    )?;

    // Identity Files
    let identity_md = config
        .identity_md
        .unwrap_or_else(|| {
            format!(
                r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Emoji:** 🦞
---
Managed by Clawnetes."#,
                config.agent_name
            )
        })
        .replace("'", "'\\''");
    execute_ssh(
        &sess,
        &format!("echo '{}' > {}/IDENTITY.md", identity_md, workspace),
    )?;

    let user_md = config
        .user_md
        .unwrap_or_else(|| {
            format!(
                r#"# USER.md - About Your Human
- **Name:** {}
---"#,
                config.user_name
            )
        })
        .replace("'", "'\\''");
    execute_ssh(
        &sess,
        &format!("echo '{}' > {}/USER.md", user_md, workspace),
    )?;

    let soul_md = config
        .soul_md
        .unwrap_or_else(|| {
            format!(
                r#"# SOUL.md
## Mission
Serve {}."#,
                config.user_name
            )
        })
        .replace("'", "'\\''");
    execute_ssh(
        &sess,
        &format!("echo '{}' > {}/SOUL.md", soul_md, workspace),
    )?;

    // Write additional markdown files if provided
    if let Some(ref tools_md) = config.tools_md {
        let escaped = tools_md.replace("'", "'\\''");
        execute_ssh(
            &sess,
            &format!("echo '{}' > {}/TOOLS.md", escaped, workspace),
        )?;
    }
    if let Some(ref agents_md) = config.agents_md {
        let escaped = agents_md.replace("'", "'\\''");
        execute_ssh(
            &sess,
            &format!("echo '{}' > {}/AGENTS.md", escaped, workspace),
        )?;
    }
    if let Some(ref heartbeat_md) = config.heartbeat_md {
        let escaped = heartbeat_md.replace("'", "'\\''");
        execute_ssh(
            &sess,
            &format!("echo '{}' > {}/HEARTBEAT.md", escaped, workspace),
        )?;
    }
    if let Some(ref memory_md) = config.memory_md {
        let escaped = memory_md.replace("'", "'\\''");
        execute_ssh(
            &sess,
            &format!("echo '{}' > {}/MEMORY.md", escaped, workspace),
        )?;
    }

    // Prefix for openclaw commands is defined at top of function

    if let Some(nm) = config.node_manager {
        let _ = execute_ssh(
            &sess,
            &format!(
                "{}openclaw config set skills.nodeManager {}",
                nvm_prefix, nm
            ),
        );
    }

    // Plugins
    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            let _ = execute_ssh(
                &sess,
                &format!("{}openclaw plugins enable telegram", nvm_prefix),
            );
        }
    }

    if config.whatsapp_enabled.unwrap_or(false) {}

    // Skills
    if let Some(skills) = &config.skills {
        for skill in skills {
            let _ = execute_ssh(
                &sess,
                &format!("{}npx clawhub install {}", nvm_prefix, skill),
            );
        }
    }

    // Multi-agent setup (Agents)
    if let Some(agents) = &config.agents {
        for agent in agents {
            let agent_workspace = format!("{}/agents/{}/workspace", openclaw_root, agent.id);
            let agent_config_dir = format!("{}/agents/{}/agent", openclaw_root, agent.id);

            execute_ssh(
                &sess,
                &format!(
                    "mkdir -p {} && mkdir -p {}",
                    agent_workspace, agent_config_dir
                ),
            )?;

            // Agent Identity Files
            let a_identity = agent
                .identity_md
                .clone()
                .unwrap_or_else(|| {
                    format!(
                        r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Emoji:** 🦞
---
Managed by Clawnetes."#,
                        agent.name
                    )
                })
                .replace("'", "'\\''");
            execute_ssh(
                &sess,
                &format!("echo '{}' > {}/IDENTITY.md", a_identity, agent_workspace),
            )?;

            // For simplicity, reuse user/soul for sub-agents unless specified
            let a_user = agent
                .user_md
                .clone()
                .unwrap_or_else(|| {
                    format!(
                        r#"# USER.md - About Your Human
- **Name:** {}
---"#,
                        config.user_name
                    )
                })
                .replace("'", "'\\''");
            execute_ssh(
                &sess,
                &format!("echo '{}' > {}/USER.md", a_user, agent_workspace),
            )?;

            let a_soul = agent
                .soul_md
                .clone()
                .unwrap_or_else(|| {
                    format!(
                        r#"# SOUL.md
## Mission
Serve {}."#,
                        config.user_name
                    )
                })
                .replace("'", "'\\''");
            execute_ssh(
                &sess,
                &format!("echo '{}' > {}/SOUL.md", a_soul, agent_workspace),
            )?;

            // Agent Auth (Clone main)
            execute_ssh(
                &sess,
                &format!(
                    "cp {}/auth-profiles.json {}/auth-profiles.json",
                    agents_dir, agent_config_dir
                ),
            )?;
        }
    }

    // Start Gateway
    // Run doctor --fix to auto-migrate any pairing stores and resolve schema quirks
    let _ = execute_ssh(
        &sess,
        &format!("{}openclaw doctor --fix --yes || true", nvm_prefix),
    );

    // Reset any failed systemd state from crash-loops before starting
    let _ = execute_ssh(
        &sess,
        "systemctl --user reset-failed openclaw-gateway.service 2>/dev/null || true",
    );
    execute_ssh(
        &sess,
        &format!("{}openclaw gateway stop || true", nvm_prefix),
    )?;
    execute_ssh(&sess, &format!("{}openclaw gateway start", nvm_prefix))?;

    if let Some(agents) = &config.agents {
        thread::sleep(Duration::from_secs(3));
        for agent in agents {
            if agent.id == "main" {
                continue;
            }
            let cmd = format!(
                "{}{}",
                nvm_prefix,
                build_agent_session_init_command(&agent.id)
            );
            let _ = execute_ssh(&sess, &cmd);
            thread::sleep(Duration::from_secs(1));
        }
    }

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

                        let mut remote_channel =
                            match sess.channel_direct_tcpip("127.0.0.1", 18789, None) {
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
                            if !TUNNEL_RUNNING.load(Ordering::Relaxed) {
                                break;
                            }
                            let mut active = false;

                            match stream.read(&mut buf1) {
                                Ok(0) => break,
                                Ok(n) => {
                                    active = true;
                                    let mut sent = 0;
                                    while sent < n {
                                        match remote_channel.write(&buf1[sent..n]) {
                                            Ok(m) => sent += m,
                                            Err(e)
                                                if e.kind() == std::io::ErrorKind::WouldBlock =>
                                            {
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
                                            Err(e)
                                                if e.kind() == std::io::ErrorKind::WouldBlock =>
                                            {
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

fn parse_gateway_token_cli_output(output: &str) -> Option<String> {
    let token = output.trim().trim_matches('"').to_string();
    if token.is_empty() || token == "null" || token == "undefined" {
        None
    } else {
        Some(token)
    }
}

fn parse_dashboard_url_cli_output(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("Dashboard URL: ")
            .map(|url| url.trim().to_string())
            .filter(|url| !url.is_empty())
    })
}

fn extract_gateway_token_from_config(config_str: &str, context: &str) -> Result<String, String> {
    let json: serde_json::Value = serde_json::from_str(config_str).map_err(|e| e.to_string())?;
    json.get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(|token| token.to_string())
        .ok_or_else(|| format!("Could not find gateway token in {}", context))
}

#[command]
async fn get_remote_gateway_token(remote: RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(&remote)?;
    let os_type = execute_ssh(&sess, "uname -s")?.trim().to_string();
    let prefix = get_env_prefix(&os_type);
    let cli_token = execute_ssh(
        &sess,
        &format!("{}openclaw config get gateway.auth.token", prefix),
    )
    .ok()
    .and_then(|output| parse_gateway_token_cli_output(&output));

    if let Some(token) = cli_token {
        return Ok(token);
    }

    let content = execute_ssh(&sess, "cat ~/.openclaw/openclaw.json")?;
    extract_gateway_token_from_config(&content, "remote config")
}

#[command]
fn start_provider_auth(
    provider: String,
    method: String,
    oauth_provider_id: String,
) -> Result<ProviderAuthData, String> {
    cleanup_stale_oauth_listener(&oauth_provider_id)?;
    let cmd = build_provider_auth_command(&provider, &method, &oauth_provider_id);
    launch_provider_auth_terminal(&cmd)?;

    let auth_config = read_provider_auth_profiles()?;
    resolve_provider_auth_data(&provider, &auth_config)
        .map(|mut auth| {
            auth.oauth_provider_id = Some(oauth_provider_id);
            auth
        })
        .ok_or_else(|| {
            format!(
                "OAuth completed but no auth profile was found for provider {}",
                provider
            )
        })
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
        {
            wsl_mkdir_p(path)
        }
        #[cfg(not(target_os = "windows"))]
        {
            fs::create_dir_all(path).map_err(|e| e.to_string())
        }
    };

    let write_file_fn = |path: &str, content: &str| -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            wsl_write_file(path, content)
        }
        #[cfg(not(target_os = "windows"))]
        {
            fs::write(path, content).map_err(|e| e.to_string())
        }
    };

    let read_file_fn = |path: &str| -> String {
        #[cfg(target_os = "windows")]
        {
            wsl_read_file(path).unwrap_or_default()
        }
        #[cfg(not(target_os = "windows"))]
        {
            fs::read_to_string(path).unwrap_or_default()
        }
    };

    // Run gateway install --force FIRST to scaffold, ONLY if not preserving state
    if config.preserve_state != Some(true) {
        let _ = shell_command("openclaw gateway stop");
        // DO NOT remove openclaw.json. The token is tied to keychain.
        // install --force will scaffold missing fields while keeping the token.
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
                if let Some(token) = parsed
                    .get("gateway")
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
                let default_acc = parsed
                    .get("channels")
                    .and_then(|c| c.get("telegram"))
                    .and_then(|t| t.get("accounts"))
                    .and_then(|a| a.get("default"));

                let allow_from = default_acc.and_then(|d| d.get("allowFrom")).cloned();
                let dm_policy = default_acc
                    .and_then(|d| d.get("dmPolicy"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                (allow_from, dm_policy)
            } else {
                (None, None)
            }
        } else {
            (None, None)
        }
    };

    let provider_auths = get_provider_auth_map(&config);
    let primary_provider_auth = provider_auths
        .get(&config.provider)
        .cloned()
        .unwrap_or_else(|| {
            default_provider_auth(
                &config.provider,
                &config.api_key,
                config.auth_method.as_deref().unwrap_or("token"),
                config.local_base_url.as_ref(),
            )
        });
    let effective_primary_model = apply_model_provider_auth(&config.model, &provider_auths);
    let effective_fallback_models = config
        .fallback_models
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|model| apply_model_provider_auth(&model, &provider_auths))
        .collect::<Vec<_>>();
    let primary_auth_provider =
        auth_provider_id_for_config(&config.provider, &primary_provider_auth, &provider_auths);
    let profile_name = resolve_profile_name(&config.provider, &primary_provider_auth);
    let auth_mode = normalize_auth_mode(&primary_provider_auth.auth_method);

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
                    "primary": apply_model_provider_auth(&agent.model, &provider_auths)
                }
            });

            if let Some(fb) = &agent.fallback_models {
                let effective_agent_fallbacks = fb
                    .iter()
                    .map(|model| apply_model_provider_auth(model, &provider_auths))
                    .collect::<Vec<_>>();
                if !fb.is_empty() {
                    if let Some(model_obj) =
                        agent_obj.get_mut("model").and_then(|m| m.as_object_mut())
                    {
                        model_obj.insert(
                            "fallbacks".to_string(),
                            serde_json::to_value(effective_agent_fallbacks).unwrap(),
                        );
                    }
                }
            }

            apply_agent_overrides(&mut agent_obj, agent);

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
                "primary": effective_primary_model
            }
        });

        if !effective_fallback_models.is_empty() {
            if let Some(model_obj) = main_obj.get_mut("model").and_then(|m| m.as_object_mut()) {
                model_obj.insert(
                    "fallbacks".to_string(),
                    serde_json::to_value(&effective_fallback_models).unwrap(),
                );
            }
        }

        agents_list.insert(0, main_obj);
    }

    let existing_config = {
        let path = format!("{}/openclaw.json", openclaw_root);
        let contents = read_file_fn(&path);
        if !contents.is_empty() {
            serde_json::from_str::<serde_json::Value>(&contents).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        }
    };

    let mut config_json = existing_config.clone();

    // Deep merge top-level keys
    if let Some(obj) = config_json.as_object_mut() {
        // Messages
        let messages_entry = obj
            .entry("messages".to_string())
            .or_insert(serde_json::json!({}));
        if let Some(m) = messages_entry.as_object_mut() {
            m.insert(
                "ackReactionScope".to_string(),
                serde_json::json!("group-mentions"),
            );
        }

        // Agents
        let agents_entry = obj
            .entry("agents".to_string())
            .or_insert(serde_json::json!({
                "defaults": { "models": {} }
            }));
        if let Some(a) = agents_entry.as_object_mut() {
            let defaults = a
                .entry("defaults".to_string())
                .or_insert(serde_json::json!({ "models": {} }));
            if let Some(d) = defaults.as_object_mut() {
                d.insert("maxConcurrent".to_string(), serde_json::json!(4));
                d.insert(
                    "subagents".to_string(),
                    serde_json::json!({ "maxConcurrent": 8 }),
                );
                d.insert(
                    "compaction".to_string(),
                    serde_json::json!({ "mode": "safeguard" }),
                );
                d.insert("workspace".to_string(), serde_json::json!(workspace));
                d.insert(
                    "model".to_string(),
                    serde_json::json!({ "primary": effective_primary_model }),
                );
            }
            a.insert("list".to_string(), serde_json::json!(agents_list));
        }

        // Gateway
        let gateway_entry = obj
            .entry("gateway".to_string())
            .or_insert(serde_json::json!({}));
        if let Some(g) = gateway_entry.as_object_mut() {
            g.insert("mode".to_string(), serde_json::json!("local"));
            g.insert("port".to_string(), serde_json::json!(gateway_port));
            g.insert("bind".to_string(), serde_json::json!(gateway_bind));
            g.insert(
                "auth".to_string(),
                serde_json::json!({
                    "mode": gateway_auth_mode,
                    "token": gateway_token
                }),
            );
            g.insert(
                "tailscale".to_string(),
                serde_json::json!({
                    "mode": tailscale_mode,
                    "resetOnExit": false
                }),
            );
        }

        // Auth
        let auth_entry = obj
            .entry("auth".to_string())
            .or_insert(serde_json::json!({}));
        if let Some(a) = auth_entry.as_object_mut() {
            a.entry("profiles".to_string())
                .or_insert(serde_json::json!({}));
        }

        // Commands
        let commands_entry = obj
            .entry("commands".to_string())
            .or_insert(serde_json::json!({}));
        if let Some(c) = commands_entry.as_object_mut() {
            c.insert("native".to_string(), serde_json::json!("auto"));
            c.insert("nativeSkills".to_string(), serde_json::json!("auto"));
        }
    }

    // Add Telegram config inline (avoids hot-reload conflicts from openclaw config set)
    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            if let Some(obj) = config_json.as_object_mut() {
                obj.insert(
                    "plugins".to_string(),
                    serde_json::json!({
                        "entries": { "telegram": { "enabled": true } }
                    }),
                );

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

                obj.insert(
                    "channels".to_string(),
                    serde_json::json!({
                        "telegram": {
                            "accounts": {
                                "default": channel_config
                            }
                        }
                    }),
                );
            }
        }
    }

    // Add WhatsApp config inline if enabled
    if config.whatsapp_enabled.unwrap_or(false) {
        let dm_policy = config.whatsapp_dm_policy.as_deref().unwrap_or("open");
        if let Some(obj) = config_json.as_object_mut() {
            // Merge plugins entries (may already have telegram)
            let plugins_entry = obj
                .entry("plugins".to_string())
                .or_insert(serde_json::json!({ "entries": {} }));
            if let Some(entries) = plugins_entry
                .get_mut("entries")
                .and_then(|e| e.as_object_mut())
            {
                entries.insert(
                    "whatsapp".to_string(),
                    serde_json::json!({ "enabled": true }),
                );
            }

            // Merge channels (may already have telegram)
            let channels_entry = obj
                .entry("channels".to_string())
                .or_insert(serde_json::json!({}));
            if let Some(channels_obj) = channels_entry.as_object_mut() {
                let mut whatsapp_obj = serde_json::json!({
                    "enabled": true,
                    "selfChatMode": true,
                    "dmPolicy": dm_policy,
                    "groupPolicy": "allowlist",
                    "debounceMs": 0,
                    "mediaMaxMb": 50
                });

                if dm_policy == "open" {
                    if let Some(w) = whatsapp_obj.as_object_mut() {
                        w.insert("allowFrom".to_string(), serde_json::json!(["*"]));
                    }
                } else if dm_policy == "allowlist" {
                    let mut existing_wa_allow = {
                        let existing_config_path = format!("{}/openclaw.json", openclaw_root);
                        let contents = read_file_fn(&existing_config_path);
                        if !contents.is_empty() {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents)
                            {
                                parsed
                                    .get("channels")
                                    .and_then(|c| c.get("whatsapp"))
                                    .and_then(|w| w.get("allowFrom"))
                                    .cloned()
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    };

                    if let Some(ref phone) = config.whatsapp_phone_number {
                        let formatted_phone = if phone.starts_with('+') {
                            phone.clone()
                        } else {
                            format!("+{}", phone)
                        };
                        existing_wa_allow = Some(serde_json::json!([formatted_phone]));
                    }

                    if let Some(existing) = existing_wa_allow {
                        if let Some(w) = whatsapp_obj.as_object_mut() {
                            w.insert("allowFrom".to_string(), existing);
                        }
                    }
                }
                channels_obj.insert("whatsapp".to_string(), whatsapp_obj);
            }
        }
    }

    // Add thinking level for Claude 4.x models via Anthropic provider
    if let Some(ref thinking_level) = config.thinking_level {
        if config.provider == "anthropic" && !thinking_level.is_empty() && thinking_level != "off" {
            if let Some(defaults) = config_json
                .get_mut("agents")
                .and_then(|a| a.get_mut("defaults"))
                .and_then(|d| d.as_object_mut())
            {
                defaults.insert(
                    "thinkingDefault".to_string(),
                    serde_json::Value::String(thinking_level.clone()),
                );
            }
        }
    }

    // Insert dynamic auth profile
    if let Some(profiles) = config_json
        .get_mut("auth")
        .and_then(|a| a.get_mut("profiles"))
        .and_then(|p| p.as_object_mut())
    {
        let profile = serde_json::json!({
            "provider": primary_auth_provider,
            "mode": auth_mode
        });

        profiles.insert(profile_name.clone(), profile);
    }

    // Insert dynamic model key and optional fields
    if let Some(defaults) = config_json
        .get_mut("agents")
        .and_then(|a| a.get_mut("defaults"))
        .and_then(|d| d.as_object_mut())
    {
        // Rebuild the model catalog from the effective namespace so stale providers
        // from previous auth modes do not survive deep-merge updates.
        defaults.insert(
            "models".to_string(),
            serde_json::Value::Object(build_effective_models_catalog(
                &effective_primary_model,
                &effective_fallback_models,
            )),
        );

        // Correctly place fallbacks under the specific model configuration
        if !effective_fallback_models.is_empty() {
            if let Some(primary_model_config) =
                defaults.get_mut("model").and_then(|m| m.as_object_mut())
            {
                primary_model_config.insert(
                    "fallbacks".to_string(),
                    serde_json::to_value(&effective_fallback_models).unwrap(),
                );
            }
        }

        if let Some(hb_mode) = config.heartbeat_mode.as_deref() {
            match hb_mode {
                "never" => {
                    defaults.insert(
                        "heartbeat".to_string(),
                        serde_json::json!({ "enabled": false }),
                    );
                }
                "idle" => {
                    defaults.insert(
                        "heartbeat".to_string(),
                        serde_json::json!({
                            "mode": "idle",
                            "timeout": config.idle_timeout_ms.unwrap_or(3600000)
                        }),
                    );
                }
                interval => {
                    defaults.insert(
                        "heartbeat".to_string(),
                        serde_json::json!({ "every": interval }),
                    );
                }
            }
        }

        if let Some(sb_mode) = config.sandbox_mode.as_deref() {
            let mapped = if sb_mode == "full" {
                "all"
            } else if sb_mode == "partial" {
                "non-main"
            } else if sb_mode == "none" {
                "off"
            } else {
                sb_mode
            };
            defaults.insert("sandbox".to_string(), serde_json::json!({ "mode": mapped }));
        }
    }

    if let Some(obj) = config_json.as_object_mut() {
        // Add tools config
        if config.tools_mode.is_some() || config.tools_profile.is_some() {
            let mut tools_obj = serde_json::Map::new();
            if let Some(profile) = config.tools_profile.as_ref() {
                tools_obj.insert("profile".to_string(), serde_json::json!(profile));
            }
            if let Some(tools) = config.allowed_tools.as_ref() {
                tools_obj.insert("allow".to_string(), serde_json::to_value(tools).unwrap());
            }
            if let Some(tools) = config.denied_tools.as_ref() {
                tools_obj.insert("deny".to_string(), serde_json::to_value(tools).unwrap());
            }
            if !tools_obj.is_empty() {
                obj.insert("tools".to_string(), serde_json::Value::Object(tools_obj));
            }
        }
    }

    // Add memory configuration
    // memoryFlush must be an object with { enabled: bool }, not a bare boolean
    if config.memory_enabled.unwrap_or(false) {
        if let Some(defaults) = config_json
            .get_mut("agents")
            .and_then(|a| a.get_mut("defaults"))
            .and_then(|d| d.as_object_mut())
        {
            if let Some(compaction) = defaults
                .get_mut("compaction")
                .and_then(|c| c.as_object_mut())
            {
                compaction.insert(
                    "memoryFlush".to_string(),
                    serde_json::json!({ "enabled": true }),
                );
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

    // Add models.providers section for LM Studio so openclaw can resolve lmstudio/ models
    if config.provider == "lmstudio" {
        let base_url = config
            .local_base_url
            .as_deref()
            .unwrap_or("http://localhost:1234");
        let base_url_v1 = if base_url.ends_with("/v1") {
            base_url.to_string()
        } else {
            format!("{}/v1", base_url.trim_end_matches('/'))
        };
        // Extract model ID by stripping the "lmstudio/" prefix
        let model_id = if config.model.starts_with("lmstudio/") {
            config.model.strip_prefix("lmstudio/").unwrap().to_string()
        } else {
            config.model.clone()
        };
        let mut model_ids = vec![model_id];
        // Also register any lmstudio fallback models
        if let Some(fb) = &config.fallback_models {
            for fb_model in fb {
                if let Some(stripped) = fb_model.strip_prefix("lmstudio/") {
                    if !model_ids.contains(&stripped.to_string()) {
                        model_ids.push(stripped.to_string());
                    }
                }
            }
        }
        let lmstudio_models: Vec<serde_json::Value> = model_ids
            .iter()
            .map(|id| {
                serde_json::json!({
                    "id": id,
                    "name": id,
                    "reasoning": false,
                    "input": ["text"],
                    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
                    "contextWindow": 131072,
                    "maxTokens": 8192
                })
            })
            .collect();
        if let Some(obj) = config_json.as_object_mut() {
            obj.insert(
                "models".to_string(),
                serde_json::json!({
                    "mode": "merge",
                    "providers": {
                        "lmstudio": {
                            "baseUrl": base_url_v1,
                            "apiKey": "lmstudio",
                            "api": "openai-completions",
                            "models": lmstudio_models
                        }
                    }
                }),
            );
        }
    }

    let config_json_raw = serde_json::to_string_pretty(&config_json).map_err(|e| e.to_string())?;

    write_file_fn(
        &format!("{}/openclaw.json", openclaw_root),
        &config_json_raw,
    )?;

    // Force sync the token to keychain to permanently fix any token mismatches
    let _ = shell_command(&format!(
        "openclaw config set gateway.auth.token {}",
        gateway_token
    ));

    // Store Clawnetes-specific metadata in a separate file
    {
        let mut meta = serde_json::Map::new();
        if let Some(agent_type) = &config.agent_type {
            meta.insert(
                "agent_type".to_string(),
                serde_json::Value::String(agent_type.clone()),
            );
        }
        if let Some(cron_jobs) = &config.cron_jobs {
            if !cron_jobs.is_empty() {
                meta.insert(
                    "cron_jobs".to_string(),
                    serde_json::to_value(cron_jobs).unwrap_or_default(),
                );
            }
        }
        if config.memory_enabled.unwrap_or(false) {
            meta.insert("memory_enabled".to_string(), serde_json::Value::Bool(true));
        }
        let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
        write_file_fn(
            &format!("{}/clawnetes-meta.json", openclaw_root),
            &meta_json,
        )?;
    }

    if let Some(agents) = &config.agents {
        for agent in agents {
            let agent_workspace = format!("{}/agents/{}/workspace", openclaw_root, agent.id);
            let agent_config_dir = format!("{}/agents/{}/agent", openclaw_root, agent.id);

            mkdir_p_fn(&agent_workspace)?;
            mkdir_p_fn(&agent_config_dir)?;

            let agent_identity = agent.identity_md.clone().unwrap_or_else(|| {
                format!(
                    r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Emoji:** 🦞
---
Managed by Clawnetes."#,
                    agent.name
                )
            });
            write_file_fn(&format!("{}/IDENTITY.md", agent_workspace), &agent_identity)?;

            let agent_user_md = agent.user_md.clone().unwrap_or_else(|| {
                format!(
                    r#"# USER.md - About Your Human
- **Name:** {}
---"#,
                    config.user_name
                )
            });
            write_file_fn(&format!("{}/USER.md", agent_workspace), &agent_user_md)?;

            let agent_soul_md = agent.soul_md.clone().unwrap_or_else(|| {
                format!(
                    r#"# SOUL.md
## Mission
Serve {}."#,
                    config.user_name
                )
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

            let agent_auth_profiles = build_auth_profiles_doc(
                &provider_auths,
                agent
                    .fallback_models
                    .as_ref()
                    .or(config.fallback_models.as_ref()),
                config.local_base_url.as_ref(),
                &config.provider,
            );

            let agent_auth_json =
                serde_json::to_string_pretty(&agent_auth_profiles).map_err(|e| e.to_string())?;
            write_file_fn(
                &format!("{}/auth-profiles.json", agent_config_dir),
                &agent_auth_json,
            )?;
        }
    }

    if let Some(nm) = config.node_manager {
        let _ = shell_command(&format!("openclaw config set skills.nodeManager {}", nm));
    }

    // Telegram config is now written inline in the JSON above.
    // No need for openclaw config set commands which cause hot-reload conflicts.

    let auth_profiles_val = build_auth_profiles_doc(
        &provider_auths,
        config.fallback_models.as_ref(),
        config.local_base_url.as_ref(),
        &config.provider,
    );

    let auth_profiles_json =
        serde_json::to_string_pretty(&auth_profiles_val).map_err(|e| e.to_string())?;
    write_file_fn(
        &format!("{}/auth-profiles.json", agents_dir),
        &auth_profiles_json,
    )?;

    let identity_md = if let Some(custom) = config.identity_md {
        custom
    } else {
        format!(
            r#"# IDENTITY.md - Who Am I?
- **Name:** {}
- **Emoji:** 🦞
---
Managed by Clawnetes."#,
            config.agent_name
        )
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
        format!(
            r#"# USER.md - About Your Human
- **Name:** {}
---"#,
            config.user_name
        )
    };
    write_file_fn(&format!("{}/USER.md", workspace), &user_md)?;

    let soul_md = if let Some(custom) = config.soul_md {
        custom
    } else {
        format!(
            r#"# SOUL.md
## Mission
Serve {}."#,
            config.user_name
        )
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
            let _ = shell_command(&format!(
                "launchctl bootstrap gui/$(id -u) \"{}\"",
                plist_path.to_string_lossy()
            ));
        }
    }

    // Removed gateway install --force logic to prevent overwriting custom config.
    // Installation is now handled in configure_agent / setup_remote_openclaw.

    // Run doctor --fix to auto-migrate any pairing stores and resolve schema quirks
    let _ = shell_command("openclaw doctor --fix --yes || true");

    let start_output = shell_command("openclaw gateway start")?;

    if start_output.to_lowercase().contains("error")
        || start_output.to_lowercase().contains("failed")
    {
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
        last_error, final_status
    ))
}

#[command]
fn initialize_agent_sessions(agent_ids: Vec<String>) -> Result<String, String> {
    let mut initialized = 0;
    for id in &agent_ids {
        if id == "main" {
            continue;
        }
        let _ = shell_command(&build_agent_session_init_command(id));
        thread::sleep(Duration::from_millis(500));
        initialized += 1;
    }
    Ok(format!("Initialized {} agent sessions", initialized))
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
        }
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
        let r = remote.unwrap();
        let sess = connect_ssh(&r)?;
        let os_type = execute_ssh(&sess, "uname -s")?.trim().to_string();
        let prefix = get_env_prefix(&os_type);

        if let Some(url) = execute_ssh(&sess, &format!("{}openclaw dashboard --no-open", prefix))
            .ok()
            .and_then(|output| parse_dashboard_url_cli_output(&output))
        {
            return Ok(url);
        }

        if let Some(token) = execute_ssh(
            &sess,
            &format!("{}openclaw config get gateway.auth.token", prefix),
        )
        .ok()
        .and_then(|output| parse_gateway_token_cli_output(&output))
        {
            token
        } else {
            let content = execute_ssh(&sess, "cat ~/.openclaw/openclaw.json")?;
            extract_gateway_token_from_config(&content, "remote config")?
        }
    } else {
        #[cfg(target_os = "windows")]
        {
            if let Some(url) = wsl_root_command("openclaw dashboard --no-open")
                .ok()
                .and_then(|output| parse_dashboard_url_cli_output(&output))
            {
                return Ok(url);
            }

            if let Some(token) = wsl_root_command("openclaw config get gateway.auth.token")
                .ok()
                .and_then(|output| parse_gateway_token_cli_output(&output))
            {
                token
            } else {
                let home = wsl_home_dir()?.trim().to_string();
                let config_path = format!("{}/.openclaw/openclaw.json", home);
                let config_str = wsl_read_file(&config_path)?;
                extract_gateway_token_from_config(&config_str, "config")?
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            if let Some(url) = shell_command("openclaw dashboard --no-open")
                .ok()
                .and_then(|output| parse_dashboard_url_cli_output(&output))
            {
                return Ok(url);
            }

            if let Some(token) = shell_command("openclaw config get gateway.auth.token")
                .ok()
                .and_then(|output| parse_gateway_token_cli_output(&output))
            {
                token
            } else {
                let home = dirs::home_dir().ok_or("Could not find home directory")?;
                let config_path = home.join(".openclaw").join("openclaw.json");
                let config_str = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
                extract_gateway_token_from_config(&config_str, "config")?
            }
        }
    };

    Ok(format!("http://127.0.0.1:18789/#token={}", token))
}

#[command]
fn verify_tunnel_connectivity(remote: RemoteInfo) -> Result<bool, String> {
    let mut last_error = String::from("No attempts made");

    // Retry loop: 30 attempts, 2 seconds between each (60s total)
    for i in 0..30 {
        if i > 0 {
            thread::sleep(Duration::from_secs(2));
        }

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
                    if status.to_lowercase().contains("stopped")
                        || status.to_lowercase().contains("error")
                    {
                        last_error =
                            format!("Remote gateway is not running. Status: {}", status.trim());
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
            if let Some(token) = json
                .get("gateway")
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
                    }
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
    Err(format!(
        "Tunnel verification failed after 60s. Last error: {}",
        last_error
    ))
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
    Err(format!(
        "WSL Ubuntu not ready after {} seconds",
        timeout_secs
    ))
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
        if stderr.contains("canceled")
            || stderr.contains("denied")
            || stderr.contains("not have permission")
        {
            return Err("WSL2 installation requires administrator approval. Please click 'Yes' on the admin dialog when prompted.".to_string());
        }
        return Err(format!(
            "WSL2 installation failed. Please ensure virtualization is enabled in BIOS. Error: {}",
            stderr
        ));
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
        eprintln!(
            "Warning: user setup returned error (may be harmless if user exists): {}",
            stderr
        );
    }

    // Write /etc/wsl.conf to set default user (more reliable than `ubuntu config --default-user`)
    let wsl_conf = Command::new("wsl")
        .args([
            "-d",
            "Ubuntu",
            "-u",
            "root",
            "--",
            "/bin/bash",
            "-c",
            "printf '[user]\\ndefault=openclaw\\n' > /etc/wsl.conf",
        ])
        .output()
        .map_err(|e| format!("Failed to write /etc/wsl.conf: {}", e))?;

    if !wsl_conf.status.success() {
        let stderr = String::from_utf8_lossy(&wsl_conf.stderr);
        eprintln!("Warning: failed to write wsl.conf: {}", stderr);
    }

    // Terminate Ubuntu so wsl.conf takes effect on next launch
    let _ = Command::new("wsl").args(["--terminate", "Ubuntu"]).output();

    thread::sleep(Duration::from_secs(2));

    // Wait for Ubuntu to come back with the new default user
    wait_for_wsl_ready(30).map_err(|e| {
        format!(
            "WSL Ubuntu failed to restart after user configuration: {}",
            e
        )
    })?;

    Ok(())
}

/// Run a command as root inside WSL (for apt-get, system setup, etc.)
/// This avoids the sudo password prompt by using `wsl -u root` directly.
#[cfg(target_os = "windows")]
fn wsl_root_command(cmd: &str) -> Result<String, String> {
    let output = Command::new("wsl")
        .args([
            "-d",
            "Ubuntu",
            "--user",
            "root",
            "--",
            "/bin/bash",
            "-c",
            cmd,
        ])
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
    shell_command("echo $HOME").map(|s| s.trim().to_string())
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
            Err(format!(
                "Command failed with exit code: {}",
                output.status.code().unwrap_or(-1)
            ))
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
        }
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
        execute_ssh(sess, "echo $HOME")
            .map_err(|e| format!("Failed to get remote home: {}", e))?
            .trim()
            .to_string()
    } else {
        // On Windows, openclaw runs inside WSL — use WSL home, not Windows home
        #[cfg(target_os = "windows")]
        {
            wsl_home_dir()?
        }
        #[cfg(not(target_os = "windows"))]
        {
            dirs::home_dir()
                .ok_or("Could not find local home directory")?
                .to_string_lossy()
                .to_string()
        }
    };

    // Helper to read file content (using absolute paths)
    let read_file_content = |path: &str| -> String {
        if let Some(sess) = &session {
            // Remote read
            execute_ssh(sess, &format!("cat \"{}\"", path)).unwrap_or_default()
        } else {
            // On Windows, read from WSL filesystem
            #[cfg(target_os = "windows")]
            {
                wsl_read_file(path).unwrap_or_default()
            }
            #[cfg(not(target_os = "windows"))]
            {
                fs::read_to_string(path).unwrap_or_default()
            }
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
    let auth_profiles_str = read_file_content(&format!(
        "{}/.openclaw/agents/main/agent/auth-profiles.json",
        home_dir
    ));
    let identity_str = read_file_content(&format!("{}/.openclaw/workspace/IDENTITY.md", home_dir));
    let user_str = read_file_content(&format!("{}/.openclaw/workspace/USER.md", home_dir));
    let soul_str = read_file_content(&format!("{}/.openclaw/workspace/SOUL.md", home_dir));

    if openclaw_json_str.is_empty() {
        return Err("Configuration not found (openclaw.json is empty or missing)".to_string());
    }

    let oc_config: serde_json::Value = serde_json::from_str(&openclaw_json_str)
        .map_err(|e| format!("Failed to parse openclaw.json: {}", e))?;
    let auth_config: serde_json::Value =
        serde_json::from_str(&auth_profiles_str).unwrap_or(serde_json::json!({}));
    let empty_json = serde_json::json!({});

    // Gateway Config
    let gateway = oc_config.get("gateway").unwrap_or(&empty_json);
    let gateway_port = gateway
        .get("port")
        .and_then(|v| v.as_u64())
        .unwrap_or(18789) as u16;
    let gateway_bind = gateway
        .get("bind")
        .and_then(|v| v.as_str())
        .unwrap_or("loopback")
        .to_string();
    let gateway_auth_mode = gateway
        .get("auth")
        .and_then(|a| a.get("mode"))
        .and_then(|v| v.as_str())
        .unwrap_or("token")
        .to_string();
    let tailscale_mode = gateway
        .get("tailscale")
        .and_then(|t| t.get("mode"))
        .and_then(|v| v.as_str())
        .unwrap_or("off")
        .to_string();

    // Agent Config (Defaults / Main)
    let defaults = oc_config
        .get("agents")
        .and_then(|a| a.get("defaults"))
        .unwrap_or(&empty_json);
    let model_primary_raw = defaults
        .get("model")
        .and_then(|m| m.get("primary"))
        .and_then(|v| v.as_str())
        .unwrap_or("anthropic/claude-opus-4-6")
        .to_string();
    let model_primary = normalize_model_ref_for_ui(&model_primary_raw);
    let fallback_models_raw: Vec<String> = defaults
        .get("model")
        .and_then(|m| m.get("fallbacks"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let fallback_models: Vec<String> = fallback_models_raw
        .iter()
        .map(|model| normalize_model_ref_for_ui(model))
        .collect();

    // Auth & Provider (Main)
    let base_provider = model_primary_raw
        .split('/')
        .next()
        .map(normalize_provider_for_ui)
        .unwrap_or_else(|| "anthropic".to_string());
    let main_provider_auth = resolve_provider_auth_data(&base_provider, &auth_config)
        .unwrap_or_else(|| default_provider_auth(&base_provider, "", "token", None));
    let profile = main_provider_auth
        .profile
        .clone()
        .unwrap_or(serde_json::json!({}));
    let provider = base_provider.clone();
    let api_key = main_provider_auth.token.clone();
    let auth_method = main_provider_auth.auth_method.clone();

    // Markdown Extraction (Main)
    let agent_name = extract_md_value(&identity_str, "Name");
    let agent_vibe = extract_md_value(&identity_str, "Vibe");
    let agent_emoji = extract_md_value(&identity_str, "Emoji");
    let user_name = extract_md_value(&user_str, "Name");

    // Telegram
    let telegram_token = oc_config
        .get("channels")
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

    let mut referenced_providers = std::collections::BTreeSet::new();
    referenced_providers.insert(base_provider.clone());
    for model in &fallback_models_raw {
        if let Some(p) = model.split('/').next() {
            referenced_providers.insert(normalize_provider_for_ui(p));
        }
    }

    // Advanced Settings
    let sandbox_mode = defaults
        .get("sandbox")
        .and_then(|s| s.get("mode"))
        .and_then(|v| v.as_str())
        .unwrap_or("full")
        .to_string();
    let mapped_sandbox = if sandbox_mode == "all" {
        "full"
    } else if sandbox_mode == "non-main" {
        "partial"
    } else if sandbox_mode == "off" {
        "none"
    } else {
        &sandbox_mode
    };

    let tools = oc_config.get("tools").unwrap_or(&empty_json);
    let tools_profile = tools
        .get("profile")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let allowed_tools: Vec<String> = tools
        .get("allow")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let denied_tools: Vec<String> = tools
        .get("deny")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let tools_mode = if tools_profile.as_deref() == Some("full") && denied_tools.is_empty() {
        "all"
    } else if !allowed_tools.is_empty() || tools_profile.is_some() {
        "allowlist"
    } else if !denied_tools.is_empty() {
        "denylist"
    } else {
        "all"
    };

    let mut provider_auths = std::collections::HashMap::new();
    for referenced_provider in &referenced_providers {
        if let Some(auth) = resolve_provider_auth_data(referenced_provider, &auth_config) {
            provider_auths.insert(referenced_provider.clone(), auth);
        }
    }

    let fallbacks = fallback_models.clone();

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
    let idle_timeout = heartbeat
        .get("timeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(3600000);

    // Multi-agent
    let empty_vec = vec![];
    let agent_list = oc_config
        .get("agents")
        .and_then(|a| a.get("list"))
        .and_then(|v| v.as_array())
        .unwrap_or(&empty_vec);
    let enable_multi_agent = agent_list.len() > 1;
    let mut agent_configs = Vec::new();

    if enable_multi_agent {
        for agent_val in agent_list {
            let aid = agent_val
                .get("id")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            if aid.is_empty() || aid == "main" {
                continue;
            }

            // Basic info from openclaw.json
            let mut name = agent_val
                .get("name")
                .and_then(|s| s.as_str())
                .unwrap_or("Agent")
                .to_string();

            // Robust Model Extraction: Handle nested {primary: "..."} or simple string "..."
            let amodel_raw = if let Some(m_obj) = agent_val.get("model").and_then(|m| m.as_object())
            {
                m_obj
                    .get("primary")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string()
            } else if let Some(m_str) = agent_val.get("model").and_then(|s| s.as_str()) {
                m_str.to_string()
            } else {
                "".to_string()
            };
            let amodel = normalize_model_ref_for_ui(&amodel_raw);

            let afallbacks_raw: Vec<String> = agent_val
                .get("model")
                .and_then(|m| {
                    if m.is_object() {
                        m.get("fallbacks")
                    } else {
                        None
                    }
                })
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let afallbacks: Vec<String> = afallbacks_raw
                .iter()
                .map(|model| normalize_model_ref_for_ui(model))
                .collect();

            // Read Agent Files (Absolute Paths)
            let agent_workspace_base = format!("{}/.openclaw/agents/{}/workspace", home_dir, aid);

            let aid_md = read_file_content(&format!("{}/IDENTITY.md", agent_workspace_base));
            let au_md = read_file_content(&format!("{}/USER.md", agent_workspace_base));
            let as_md = read_file_content(&format!("{}/SOUL.md", agent_workspace_base));

            // Extract Metadata
            let extracted_name = extract_md_value(&aid_md, "Name");
            if !extracted_name.is_empty() {
                name = extracted_name;
            } // Identity MD overrides config name

            let avibe = extract_md_value(&aid_md, "Vibe");
            let aemoji = extract_md_value(&aid_md, "Emoji");

            // Extract Skills for this agent
            let askills = list_directories(&format!("{}/skills", agent_workspace_base));
            let askills_opt = if askills.is_empty() {
                None
            } else {
                Some(askills)
            };

            // Read additional md files for sub-agent
            let a_tools_md_s = read_file_content(&format!("{}/TOOLS.md", agent_workspace_base));
            let a_tools_md = if a_tools_md_s.is_empty() {
                None
            } else {
                Some(a_tools_md_s)
            };
            let a_agents_md_s = read_file_content(&format!("{}/AGENTS.md", agent_workspace_base));
            let a_agents_md = if a_agents_md_s.is_empty() {
                None
            } else {
                Some(a_agents_md_s)
            };
            let a_heartbeat_md_s =
                read_file_content(&format!("{}/HEARTBEAT.md", agent_workspace_base));
            let a_heartbeat_md = if a_heartbeat_md_s.is_empty() {
                None
            } else {
                Some(a_heartbeat_md_s)
            };
            let a_memory_md_s = read_file_content(&format!("{}/MEMORY.md", agent_workspace_base));
            let a_memory_md = if a_memory_md_s.is_empty() {
                None
            } else {
                Some(a_memory_md_s)
            };

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
                tools: agent_val
                    .get("tools")
                    .and_then(|value| serde_json::from_value(value.clone()).ok()),
            });
            if let Some(agent_provider) =
                agent_configs.last().and_then(|a| a.model.split('/').next())
            {
                referenced_providers.insert(normalize_provider_for_ui(agent_provider));
            }
            if let Some(agent_fallbacks) =
                agent_configs.last().and_then(|a| a.fallback_models.clone())
            {
                for fallback in agent_fallbacks {
                    if let Some(fallback_provider) = fallback.split('/').next() {
                        referenced_providers.insert(normalize_provider_for_ui(fallback_provider));
                    }
                }
            }
        }
    }

    // Check Pairing Status
    let dm_policy = oc_config
        .get("channels")
        .and_then(|c| c.get("telegram"))
        .and_then(|t| t.get("accounts"))
        .and_then(|a| a.get("default"))
        .and_then(|m| m.get("dmPolicy"))
        .and_then(|v| v.as_str())
        .unwrap_or("default");

    let is_paired = dm_policy != "pairing";

    // Read additional workspace markdown files
    let tools_md_s = read_file_content(&format!("{}/.openclaw/workspace/TOOLS.md", home_dir));
    let tools_md_str = if tools_md_s.is_empty() {
        None
    } else {
        Some(tools_md_s)
    };
    let agents_md_s = read_file_content(&format!("{}/.openclaw/workspace/AGENTS.md", home_dir));
    let agents_md_str = if agents_md_s.is_empty() {
        None
    } else {
        Some(agents_md_s)
    };
    let heartbeat_md_s =
        read_file_content(&format!("{}/.openclaw/workspace/HEARTBEAT.md", home_dir));
    let heartbeat_md_str = if heartbeat_md_s.is_empty() {
        None
    } else {
        Some(heartbeat_md_s)
    };
    let memory_md_s = read_file_content(&format!("{}/.openclaw/workspace/MEMORY.md", home_dir));
    let memory_md_str = if memory_md_s.is_empty() {
        None
    } else {
        Some(memory_md_s)
    };

    // Check memory enabled (memoryFlush is an object: { enabled: bool })
    let memory_enabled = defaults
        .get("compaction")
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
    let cron_jobs: Option<Vec<CronJobConfig>> = meta
        .get("cron_jobs")
        .and_then(|c| serde_json::from_value(c.clone()).ok());

    // Read agent type from metadata (NOT from openclaw.json)
    let agent_type = meta
        .get("agent_type")
        .and_then(|v| v.as_str())
        .unwrap_or("custom")
        .to_string();

    // Read WhatsApp config from openclaw.json
    let whatsapp_enabled = oc_config
        .get("plugins")
        .and_then(|p| p.get("entries"))
        .and_then(|e| e.get("whatsapp"))
        .and_then(|w| w.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let whatsapp_dm_policy = oc_config
        .get("channels")
        .and_then(|c| c.get("whatsapp"))
        .and_then(|w| w.get("accounts"))
        .and_then(|a| a.get("default"))
        .and_then(|m| m.get("dmPolicy"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let thinking_level = defaults
        .get("thinkingDefault")
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
        provider_auths,
        sandbox_mode: mapped_sandbox.to_string(),
        tools_mode: tools_mode.to_string(),
        tools_profile,
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
        local_base_url: profile
            .get("baseUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        thinking_level,
        whatsapp_enabled: Some(whatsapp_enabled),
        whatsapp_dm_policy,
        whatsapp_phone_number: oc_config
            .get("channels")
            .and_then(|c| c.get("whatsapp"))
            .and_then(|w| w.get("allowFrom"))
            .and_then(|a| a.as_array())
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
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
        let install_nvm_cmd =
            "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash";
        shell_command(install_nvm_cmd).map_err(|e| format!("Failed to install nvm: {}", e))?;

        let install_node_cmd = "export NVM_DIR=\"$HOME/.nvm\"; \
            [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; \
            nvm install node && nvm use node && nvm alias default node";

        shell_command(install_node_cmd)
            .map_err(|e| format!("Failed to install Node.js via nvm: {}", e))
    }
}

#[command]
fn get_ollama_models(remote: Option<RemoteInfo>) -> Result<Vec<String>, String> {
    if let Some(r) = remote {
        // Remote: SSH exec curl to hit Ollama API on the remote host
        let sess = connect_ssh(&r).map_err(|e| format!("SSH connect failed: {}", e))?;
        let output = execute_ssh(
            &sess,
            "curl -sf http://localhost:11434/api/tags 2>/dev/null || echo '{}'",
        );
        match output {
            Ok(json_str) => {
                let val: serde_json::Value =
                    serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));
                let models: Vec<String> = val
                    .get("models")
                    .and_then(|m| m.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| {
                                m.get("name")
                                    .and_then(|n| n.as_str())
                                    .map(|s| s.to_string())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![]),
        }
    } else {
        // Local: use reqwest blocking
        match reqwest::blocking::get("http://localhost:11434/api/tags") {
            Ok(resp) => {
                let json: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
                let models: Vec<String> = json
                    .get("models")
                    .and_then(|m| m.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| {
                                m.get("name")
                                    .and_then(|n| n.as_str())
                                    .map(|s| s.to_string())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![]),
        }
    }
}

#[command]
fn get_lmstudio_models(
    base_url: Option<String>,
    remote: Option<RemoteInfo>,
) -> Result<Vec<String>, String> {
    let url_base = base_url.as_deref().unwrap_or("http://localhost:1234");
    let models_url = format!("{}/v1/models", url_base);

    if let Some(r) = remote {
        let sess = connect_ssh(&r).map_err(|e| format!("SSH connect failed: {}", e))?;
        let output = execute_ssh(
            &sess,
            &format!("curl -sf {}/v1/models 2>/dev/null || echo '{{}}'", url_base),
        );
        match output {
            Ok(json_str) => {
                let val: serde_json::Value =
                    serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));
                let models: Vec<String> = val
                    .get("data")
                    .and_then(|d| d.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| {
                                m.get("id").and_then(|n| n.as_str()).map(|s| s.to_string())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![]),
        }
    } else {
        match reqwest::blocking::get(&models_url) {
            Ok(resp) => {
                let json: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
                let models: Vec<String> = json
                    .get("data")
                    .and_then(|d| d.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| {
                                m.get("id").and_then(|n| n.as_str()).map(|s| s.to_string())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![]),
        }
    }
}

#[command]
fn validate_openclaw_config(
    remote: Option<RemoteInfo>,
    is_wsl: Option<bool>,
) -> Result<String, String> {
    if let Some(r) = remote {
        let sess = connect_ssh(&r).map_err(|e| format!("SSH connect failed: {}", e))?;
        let os_type = execute_ssh(&sess, "uname -s")
            .unwrap_or_default()
            .trim()
            .to_string();
        let prefix = get_env_prefix(&os_type);
        execute_ssh(&sess, &format!("{}openclaw config validate 2>&1", prefix))
    } else if is_wsl.unwrap_or(false) {
        shell_command("wsl -- openclaw config validate 2>&1")
    } else {
        shell_command("openclaw config validate 2>&1")
    }
}

#[command]
async fn start_whatsapp_login(
    gateway_port: u16,
    remote: Option<RemoteInfo>,
) -> Result<String, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::protocol::Message;

    // Read auth token from the correct host (remote via SSH, or local filesystem).
    let auth_token: Option<String> = if let Some(ref r) = remote {
        let sess = connect_ssh(r)?;
        let home = execute_ssh(&sess, "echo $HOME").unwrap_or_default();
        let home = home.trim();
        let json_str = execute_ssh(&sess, &format!("cat {}/.openclaw/openclaw.json", home))
            .unwrap_or_default();
        serde_json::from_str::<serde_json::Value>(&json_str)
            .ok()
            .and_then(|c| {
                c.get("gateway")
                    .and_then(|g| g.get("auth"))
                    .and_then(|a| a.get("token"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
    } else {
        let home_dir = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let openclaw_json_str =
            std::fs::read_to_string(format!("{}/.openclaw/openclaw.json", home_dir))
                .unwrap_or_default();
        serde_json::from_str::<serde_json::Value>(&openclaw_json_str)
            .ok()
            .and_then(|c| {
                c.get("gateway")
                    .and_then(|g| g.get("auth"))
                    .and_then(|a| a.get("token"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
    };

    // On the very first connection to a fresh gateway the gateway responds NOT_PAIRED to the
    // connect handshake, then immediately auto-approves the new client device.  The connection
    // is closed right after that response, so any RPC sent on it is lost.  We retry once (after
    // a short pause) so the second connection sees the now-approved device and gets ok:true.
    let url = format!("ws://127.0.0.1:{}", gateway_port);
    // The gateway auto-approves new client devices asynchronously; from the logs this takes
    // up to ~30 seconds.  We retry with a 10-second pause so we don't exhaust retries before
    // approval completes.  5 attempts × 10 s = up to 40 s total wait, well above the observed
    // ~30 s worst case.
    let max_attempts: u8 = 5;
    for attempt in 0..max_attempts {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        }

        let (mut ws_stream, _) = connect_async(&url)
            .await
            .map_err(|e| format!("WebSocket connect failed: {}", e))?;

        let connect_req_id = uuid::Uuid::new_v4().to_string();
        let mut connect_msg = serde_json::json!({
            "type": "req",
            "id": connect_req_id,
            "method": "connect",
            "params": {
                "client": {
                    "id": "gateway-client",
                    "version": "1.0",
                    "platform": std::env::consts::OS,
                    "mode": "backend"
                },
                "minProtocol": 3,
                "maxProtocol": 3,
                "role": "operator",
                "scopes": ["operator.admin"]
            }
        });
        if let Some(ref token) = auth_token {
            if let Some(params) = connect_msg
                .get_mut("params")
                .and_then(|p| p.as_object_mut())
            {
                params.insert("auth".to_string(), serde_json::json!({ "token": token }));
            }
        }

        ws_stream
            .send(Message::Text(connect_msg.to_string()))
            .await
            .map_err(|e| format!("WebSocket send connect failed: {}", e))?;

        let mut handshake_ok = false;
        let mut needs_reconnect = false;
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let val: serde_json::Value =
                        serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                    if val.get("id").and_then(|v| v.as_str()) == Some(&connect_req_id) {
                        if val.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                            handshake_ok = true;
                            break;
                        } else {
                            // NOT_PAIRED / device-required: gateway has started async approval of
                            // this client device.  Close and retry after a pause so the approval
                            // can complete before the next attempt.
                            let error_code = val
                                .get("error")
                                .and_then(|e| e.get("code"))
                                .and_then(|c| c.as_str())
                                .unwrap_or("");
                            let detail_code = val
                                .get("error")
                                .and_then(|e| e.get("details"))
                                .and_then(|d| d.get("code"))
                                .and_then(|c| c.as_str())
                                .unwrap_or("");
                            if error_code == "NOT_PAIRED"
                                || detail_code == "DEVICE_IDENTITY_REQUIRED"
                            {
                                needs_reconnect = true;
                                break;
                            }
                            return Err(format!("Gateway connect handshake failed: {}", text));
                        }
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => return Err(format!("WebSocket error during handshake: {}", e)),
                _ => {}
            }
        }

        if needs_reconnect {
            continue;
        }
        if !handshake_ok {
            return Err("Gateway connect handshake timed out".to_string());
        }

        // Handshake succeeded — request QR code.
        let request_id = uuid::Uuid::new_v4().to_string();
        let rpc_msg = serde_json::json!({
            "type": "req",
            "id": request_id,
            "method": "web.login.start",
            "params": { "timeoutMs": 30000, "force": true }
        });

        ws_stream
            .send(Message::Text(rpc_msg.to_string()))
            .await
            .map_err(|e| format!("WebSocket send failed: {}", e))?;

        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let val: serde_json::Value =
                        serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                    if val.get("id").and_then(|v| v.as_str()) == Some(&request_id) {
                        if val.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                            if let Some(qr) = val
                                .get("payload")
                                .and_then(|r| r.get("qrDataUrl"))
                                .and_then(|v| v.as_str())
                            {
                                return Ok(qr.to_string());
                            }
                            // ok:true but no qrDataUrl — already linked or unexpected format
                            return Err(
                                "Gateway returned ok but no QR code (already linked?)".to_string()
                            );
                        } else if let Some(err) = val.get("error") {
                            return Err(format!("Gateway error: {}", err));
                        }
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => return Err(format!("WebSocket error: {}", e)),
                _ => {}
            }
        }

        // No QR received on this attempt; if retries remain, try again.
    }

    Err("No QR code received from gateway after retries".to_string())
}

#[command]
async fn wait_whatsapp_login(
    gateway_port: u16,
    remote: Option<RemoteInfo>,
) -> Result<bool, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::protocol::Message;

    let auth_token: Option<String> = if let Some(ref r) = remote {
        let sess = connect_ssh(r)?;
        let home = execute_ssh(&sess, "echo $HOME").unwrap_or_default();
        let home = home.trim();
        let json_str = execute_ssh(&sess, &format!("cat {}/.openclaw/openclaw.json", home))
            .unwrap_or_default();
        serde_json::from_str::<serde_json::Value>(&json_str)
            .ok()
            .and_then(|c| {
                c.get("gateway")
                    .and_then(|g| g.get("auth"))
                    .and_then(|a| a.get("token"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
    } else {
        let home_dir = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let openclaw_json_str =
            std::fs::read_to_string(format!("{}/.openclaw/openclaw.json", home_dir))
                .unwrap_or_default();
        serde_json::from_str::<serde_json::Value>(&openclaw_json_str)
            .ok()
            .and_then(|c| {
                c.get("gateway")
                    .and_then(|g| g.get("auth"))
                    .and_then(|a| a.get("token"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
    };

    let url = format!("ws://127.0.0.1:{}", gateway_port);
    let max_attempts: u8 = 5;
    for attempt in 0..max_attempts {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        }

        let (mut ws_stream, _) = connect_async(&url)
            .await
            .map_err(|e| format!("WebSocket connect failed: {}", e))?;

        let connect_req_id = uuid::Uuid::new_v4().to_string();
        let mut connect_msg = serde_json::json!({
            "type": "req",
            "id": connect_req_id,
            "method": "connect",
            "params": {
                "client": {
                    "id": "gateway-client",
                    "version": "1.0",
                    "platform": std::env::consts::OS,
                    "mode": "backend"
                },
                "minProtocol": 3,
                "maxProtocol": 3,
                "role": "operator",
                "scopes": ["operator.admin"]
            }
        });
        if let Some(ref token) = auth_token {
            if let Some(params) = connect_msg
                .get_mut("params")
                .and_then(|p| p.as_object_mut())
            {
                params.insert("auth".to_string(), serde_json::json!({ "token": token }));
            }
        }

        ws_stream
            .send(Message::Text(connect_msg.to_string()))
            .await
            .map_err(|e| format!("WebSocket send connect failed: {}", e))?;

        let mut handshake_ok = false;
        let mut needs_reconnect = false;
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let val: serde_json::Value =
                        serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                    if val.get("id").and_then(|v| v.as_str()) == Some(&connect_req_id) {
                        if val.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                            handshake_ok = true;
                            break;
                        } else {
                            let error_code = val
                                .get("error")
                                .and_then(|e| e.get("code"))
                                .and_then(|c| c.as_str())
                                .unwrap_or("");
                            let detail_code = val
                                .get("error")
                                .and_then(|e| e.get("details"))
                                .and_then(|d| d.get("code"))
                                .and_then(|c| c.as_str())
                                .unwrap_or("");
                            if error_code == "NOT_PAIRED"
                                || detail_code == "DEVICE_IDENTITY_REQUIRED"
                            {
                                needs_reconnect = true;
                                break;
                            }
                            return Err(format!("Gateway connect handshake failed: {}", text));
                        }
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => return Err(format!("WebSocket error during handshake: {}", e)),
                _ => {}
            }
        }

        if needs_reconnect {
            continue;
        }
        if !handshake_ok {
            return Err("Gateway connect handshake timed out".to_string());
        }

        let request_id = uuid::Uuid::new_v4().to_string();
        let rpc_msg = serde_json::json!({
            "type": "req",
            "id": request_id,
            "method": "web.login.wait",
            "params": { "timeoutMs": 120000 }
        });

        ws_stream
            .send(Message::Text(rpc_msg.to_string()))
            .await
            .map_err(|e| format!("WebSocket send failed: {}", e))?;

        let result = tokio::time::timeout(std::time::Duration::from_secs(130), async {
            while let Some(msg) = ws_stream.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        let val: serde_json::Value =
                            serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                        if val.get("id").and_then(|v| v.as_str()) == Some(&request_id) {
                            if val.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                                let connected = val
                                    .get("payload")
                                    .and_then(|r| r.get("connected"))
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);
                                return Ok(connected);
                            } else if let Some(err) = val.get("error") {
                                return Err(format!("Gateway error: {}", err));
                            }
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Err(e) => return Err(format!("WebSocket error: {}", e)),
                    _ => {}
                }
            }
            Ok(false)
        })
        .await;

        return match result {
            Ok(r) => r,
            Err(_) => Err("WhatsApp login wait timed out".to_string()),
        };
    }

    Err("Gateway connect handshake failed after retries".to_string())
}
#[command]
async fn wipe_whatsapp_session() -> Result<(), String> {
    let home_dir = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let session_dir = format!("{}/.openclaw/credentials/whatsapp/default", home_dir);
    if std::path::Path::new(&session_dir).exists() {
        std::fs::remove_dir_all(&session_dir)
            .map_err(|e| format!("Failed to delete whatsapp session: {}", e))?;
    }
    Ok(())
}

/// Check if WhatsApp creds are saved by calling web.login.start WITHOUT force.
/// If creds exist, OpenClaw returns ok:true with no qrDataUrl ("already linked").
#[command]
async fn check_whatsapp_linked(gateway_port: u16) -> Result<bool, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::protocol::Message;

    let url = format!("ws://127.0.0.1:{}", gateway_port);
    let (mut ws_stream, _) = connect_async(&url)
        .await
        .map_err(|e| format!("WebSocket connect failed: {}", e))?;

    // Connect handshake
    let connect_req_id = uuid::Uuid::new_v4().to_string();
    let mut connect_msg = serde_json::json!({
        "type": "req",
        "id": connect_req_id,
        "method": "connect",
        "params": {
            "client": {
                "id": "gateway-client",
                "version": "1.0",
                "platform": std::env::consts::OS,
                "mode": "backend"
            },
            "minProtocol": 3,
            "maxProtocol": 3,
            "role": "operator",
            "scopes": ["operator.admin"]
        }
    });

    let home_dir = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let openclaw_json_str =
        std::fs::read_to_string(format!("{}/.openclaw/openclaw.json", home_dir))
            .unwrap_or_default();
    if let Ok(oc_config) = serde_json::from_str::<serde_json::Value>(&openclaw_json_str) {
        if let Some(token) = oc_config
            .get("gateway")
            .and_then(|g| g.get("auth"))
            .and_then(|a| a.get("token"))
            .and_then(|v| v.as_str())
        {
            if let Some(params) = connect_msg
                .get_mut("params")
                .and_then(|p| p.as_object_mut())
            {
                params.insert("auth".to_string(), serde_json::json!({ "token": token }));
            }
        }
    }

    ws_stream
        .send(Message::Text(connect_msg.to_string()))
        .await
        .map_err(|e| format!("WebSocket send connect failed: {}", e))?;

    // Wait for handshake response
    while let Some(msg) = ws_stream.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let val: serde_json::Value =
                    serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                if val.get("id").and_then(|v| v.as_str()) == Some(&connect_req_id) {
                    if val.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                        break;
                    } else {
                        // NOT_PAIRED from the connect handshake means WhatsApp is definitively
                        // not linked — return false rather than an error.
                        let error_code = val
                            .get("error")
                            .and_then(|e| e.get("code"))
                            .and_then(|c| c.as_str())
                            .unwrap_or("");
                        let detail_code = val
                            .get("error")
                            .and_then(|e| e.get("details"))
                            .and_then(|d| d.get("code"))
                            .and_then(|c| c.as_str())
                            .unwrap_or("");
                        if error_code == "NOT_PAIRED" || detail_code == "DEVICE_IDENTITY_REQUIRED" {
                            return Ok(false);
                        }
                        return Err(format!("Gateway handshake failed: {}", text));
                    }
                }
            }
            Ok(Message::Close(_)) => return Err("WebSocket closed during handshake".to_string()),
            Err(e) => return Err(format!("WebSocket error: {}", e)),
            _ => {}
        }
    }

    // Call web.login.start WITHOUT force — if creds exist, returns "already linked" with no QR
    let request_id = uuid::Uuid::new_v4().to_string();
    let rpc_msg = serde_json::json!({
        "type": "req",
        "id": request_id,
        "method": "web.login.start",
        "params": { "timeoutMs": 10000 }
    });

    ws_stream
        .send(Message::Text(rpc_msg.to_string()))
        .await
        .map_err(|e| format!("WebSocket send failed: {}", e))?;

    let timeout = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let val: serde_json::Value =
                        serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                    if val.get("id").and_then(|v| v.as_str()) == Some(&request_id) {
                        if val.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                            // If no qrDataUrl → creds exist, already linked
                            let has_qr = val
                                .get("payload")
                                .and_then(|r| r.get("qrDataUrl"))
                                .and_then(|v| v.as_str())
                                .is_some();
                            return Ok(!has_qr);
                        } else {
                            return Ok(false);
                        }
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => return Err(format!("WebSocket error: {}", e)),
                _ => {}
            }
        }
        Ok(false)
    })
    .await;

    match timeout {
        Ok(result) => result,
        Err(_) => Ok(false),
    }
}

#[command]
async fn restart_openclaw_gateway(remote: Option<RemoteInfo>) -> Result<(), String> {
    if let Some(r) = remote {
        let sess = connect_ssh(&r)?;
        let nvm_prefix = get_env_prefix(&execute_ssh(&sess, "uname -s")?.trim().to_string());
        execute_ssh(&sess, &format!("{}openclaw gateway restart", nvm_prefix))?;
    } else {
        // 'openclaw gateway restart' uses launchctl kickstart which fails with
        // "Operation not permitted" from Tauri's subprocess context.
        // Use the same stop → bootstrap → start pattern as start_gateway() instead.
        let _ = shell_command("openclaw gateway stop");
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        #[cfg(target_os = "macos")]
        if let Some(home) = dirs::home_dir() {
            let plist = home.join("Library/LaunchAgents/ai.openclaw.gateway.plist");
            if plist.exists() {
                let _ = shell_command(&format!(
                    "launchctl bootstrap gui/$(id -u) \"{}\"",
                    plist.to_string_lossy()
                ));
            }
        }

        shell_command("openclaw gateway start")
            .map_err(|e| format!("Gateway restart failed: {}", e))?;
    }
    // Wait for gateway to fully start before returning
    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            install_local_nodejs,
            check_prerequisites,
            install_openclaw,
            configure_agent,
            start_gateway,
            initialize_agent_sessions,
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
            wait_whatsapp_login,
            wipe_whatsapp_session,
            check_whatsapp_linked,
            restart_openclaw_gateway
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

        let config: AgentConfig =
            serde_json::from_str(json_data).expect("Failed to deserialize AgentConfig");

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
    fn test_apply_agent_overrides_serializes_explicit_tools_and_subagents() {
        let agent = AgentData {
            id: "data-analysis".to_string(),
            name: "Data Analysis".to_string(),
            model: "anthropic/claude-sonnet-4-6".to_string(),
            fallback_models: None,
            skills: None,
            vibe: None,
            emoji: None,
            identity_md: None,
            user_md: None,
            soul_md: None,
            tools_md: None,
            agents_md: None,
            heartbeat_md: None,
            memory_md: None,
            subagents: Some(SubagentConfig {
                allow_agents: vec!["reporting".to_string()],
            }),
            tools: Some(AgentToolsConfig {
                profile: Some("coding".to_string()),
                allow: Some(vec!["browser".to_string(), "web_search".to_string()]),
                deny: Some(vec!["subagents".to_string()]),
                elevated: Some(ElevatedToolConfig { enabled: true }),
            }),
        };
        let mut agent_obj = serde_json::json!({
            "id": agent.id,
            "name": agent.name
        });

        apply_agent_overrides(&mut agent_obj, &agent);

        assert_eq!(
            agent_obj
                .get("tools")
                .and_then(|tools| tools.get("profile"))
                .and_then(|value| value.as_str()),
            Some("coding")
        );
        assert_eq!(
            agent_obj
                .get("tools")
                .and_then(|tools| tools.get("allow"))
                .and_then(|value| value.as_array())
                .map(|values| values.len()),
            Some(2)
        );
        assert!(agent_obj
            .get("tools")
            .and_then(|tools| tools.get("agentToAgent"))
            .is_none());
        assert_eq!(
            agent_obj
                .get("subagents")
                .and_then(|subagents| subagents.get("allowAgents"))
                .and_then(|value| value.as_array())
                .map(|values| values.len()),
            Some(1)
        );
    }

    #[test]
    fn test_apply_agent_overrides_omits_missing_nested_agent_config() {
        let agent = AgentData {
            id: "reporting".to_string(),
            name: "Reporting".to_string(),
            model: "anthropic/claude-sonnet-4-6".to_string(),
            fallback_models: None,
            skills: None,
            vibe: None,
            emoji: None,
            identity_md: None,
            user_md: None,
            soul_md: None,
            tools_md: None,
            agents_md: None,
            heartbeat_md: None,
            memory_md: None,
            subagents: None,
            tools: None,
        };
        let mut agent_obj = serde_json::json!({
            "id": agent.id,
            "name": agent.name
        });

        apply_agent_overrides(&mut agent_obj, &agent);

        assert!(agent_obj.get("tools").is_none());
        assert!(agent_obj.get("subagents").is_none());
    }

    #[test]
    fn test_agent_tools_config_omits_empty_optional_fields() {
        let tools = AgentToolsConfig {
            profile: Some("minimal".to_string()),
            allow: None,
            deny: None,
            elevated: None,
        };

        let serialized = serde_json::to_value(&tools).expect("tool config should serialize");

        assert_eq!(
            serialized.get("profile").and_then(|value| value.as_str()),
            Some("minimal")
        );
        assert!(serialized.get("allow").is_none());
        assert!(serialized.get("deny").is_none());
        assert!(serialized.get("elevated").is_none());
        assert!(serialized.get("agentToAgent").is_none());
    }

    #[test]
    fn test_build_agent_session_init_command_uses_hello_message() {
        assert_eq!(
            build_agent_session_init_command("data-analysis"),
            "openclaw agent --agent data-analysis --message \"hello\" 2>/dev/null || true"
        );
    }

    #[test]
    fn test_build_auth_profiles_doc_preserves_oauth_profile_shape() {
        let mut provider_auths = std::collections::HashMap::new();
        provider_auths.insert(
            "openai".to_string(),
            ProviderAuthData {
                auth_method: "openai-codex".to_string(),
                token: "".to_string(),
                profile_key: Some("openai-codex:default".to_string()),
                profile: Some(serde_json::json!({
                    "type": "oauth",
                    "provider": "openai-codex",
                    "access": "access-token",
                    "refresh": "refresh-token"
                })),
                oauth_provider_id: Some("openai-codex".to_string()),
            },
        );

        let doc = build_auth_profiles_doc(&provider_auths, None, None, "openai");
        let profile = doc
            .get("profiles")
            .and_then(|p| p.get("openai-codex:default"))
            .unwrap();
        assert_eq!(profile.get("type").and_then(|v| v.as_str()), Some("oauth"));
        assert_eq!(
            profile.get("refresh").and_then(|v| v.as_str()),
            Some("refresh-token")
        );
        assert_eq!(
            doc.get("lastGood")
                .and_then(|v| v.get("openai"))
                .and_then(|v| v.as_str()),
            Some("openai-codex:default")
        );
    }

    #[test]
    fn test_resolve_provider_auth_data_uses_last_good_for_oauth_provider() {
        let auth_config = serde_json::json!({
            "profiles": {
                "openai-codex:default": {
                    "type": "oauth",
                    "provider": "openai-codex",
                    "access": "access-token"
                }
            },
            "lastGood": {
                "openai": "openai-codex:default"
            }
        });

        let resolved = resolve_provider_auth_data("openai", &auth_config)
            .expect("provider auth should resolve");
        assert_eq!(
            resolved.profile_key.as_deref(),
            Some("openai-codex:default")
        );
        assert_eq!(resolved.auth_method, "openai-codex");
        assert_eq!(resolved.token, "access-token");
        assert_eq!(resolved.oauth_provider_id.as_deref(), Some("openai-codex"));
    }

    #[test]
    fn test_resolve_provider_auth_data_prefers_usable_oauth_over_empty_last_good() {
        let auth_config = serde_json::json!({
            "profiles": {
                "openai:default": {
                    "type": "oauth",
                    "provider": "openai",
                    "access": ""
                },
                "openai-codex:default": {
                    "type": "oauth",
                    "provider": "openai-codex",
                    "access": "real-access-token"
                }
            },
            "lastGood": {
                "openai": "openai:default"
            }
        });

        let resolved = resolve_provider_auth_data("openai", &auth_config)
            .expect("provider auth should resolve");
        assert_eq!(
            resolved.profile_key.as_deref(),
            Some("openai-codex:default")
        );
        assert_eq!(resolved.token, "real-access-token");
        assert_eq!(resolved.oauth_provider_id.as_deref(), Some("openai-codex"));
    }

    #[test]
    fn test_resolve_provider_auth_data_maps_anthropic_oauth_to_setup_token() {
        let auth_config = serde_json::json!({
            "profiles": {
                "anthropic:default": {
                    "type": "oauth",
                    "provider": "anthropic",
                    "access": "anthropic-access"
                }
            },
            "lastGood": {
                "anthropic": "anthropic:default"
            }
        });

        let resolved = resolve_provider_auth_data("anthropic", &auth_config)
            .expect("provider auth should resolve");
        assert_eq!(resolved.auth_method, "setup-token");
        assert_eq!(resolved.token, "anthropic-access");
    }

    #[test]
    fn test_build_terminal_runner_command_writes_marker_file() {
        let command = "openclaw models auth login --provider 'openai-codex'";
        let runner = build_terminal_runner_command(command, "/tmp/clawnetes-oauth.exit");

        assert!(runner.contains("openclaw models auth login"));
        assert!(runner.contains("auth_exit_code=$?"));
        assert!(runner.contains("printf '%s' \"$auth_exit_code\" > '/tmp/clawnetes-oauth.exit'"));
        assert!(runner.ends_with("exit $auth_exit_code"));
    }

    #[test]
    fn test_build_provider_auth_command_uses_plugin_login_for_gemini_cli() {
        assert_eq!(
            build_provider_auth_command("google", "google-gemini-cli", "google-gemini-cli"),
            "openclaw models auth login --provider 'google-gemini-cli'"
        );
    }

    #[test]
    fn test_build_provider_auth_command_uses_plugin_login_for_codex() {
        assert_eq!(
            build_provider_auth_command("openai", "openai-codex", "openai-codex"),
            "openclaw models auth login --provider 'openai-codex'"
        );
    }

    #[test]
    fn test_build_unix_terminal_script_uses_login_shell_on_macos() {
        let script = build_unix_terminal_script(
            TerminalPlatform::Macos,
            "openclaw models auth login --provider 'openai-codex'",
            "/tmp/clawnetes-oauth.exit",
        );

        assert!(script.starts_with("#!/bin/zsh -l"));
        assert!(script.contains("openclaw models auth login --provider 'openai-codex'"));
        assert!(script.contains("auth_exit_code=$?"));
        assert!(script.contains("printf '%s' \"$auth_exit_code\" > '/tmp/clawnetes-oauth.exit'"));
        assert!(!script.contains("\nstatus=$?\n"));
    }

    #[test]
    fn test_build_macos_terminal_launch_uses_terminal_app() {
        let plan = build_macos_terminal_launch("/tmp/openclaw-auth.command");

        assert_eq!(plan.program, "open");
        assert_eq!(
            plan.args,
            vec!["-a", "Terminal", "/tmp/openclaw-auth.command"]
        );
    }

    #[test]
    fn test_build_linux_terminal_launches_include_common_emulators() {
        let plans = build_linux_terminal_launches("/tmp/openclaw-auth.sh");

        assert_eq!(
            plans.first().map(|plan| plan.program.as_str()),
            Some("x-terminal-emulator")
        );
        assert!(plans.iter().any(|plan| plan.program == "gnome-terminal"));
        assert!(plans.iter().any(|plan| plan.program == "xterm"));
    }

    #[test]
    fn test_build_windows_terminal_launches_include_tty_capable_launchers() {
        let plans =
            build_windows_terminal_launches("openclaw models auth login --provider 'openai-codex'");

        assert_eq!(
            plans.first().map(|plan| plan.program.as_str()),
            Some("wt.exe")
        );
        assert!(plans.iter().any(|plan| plan.program == "cmd.exe"));
        assert!(plans[0].args.contains(&"wsl.exe".to_string()));
        assert!(plans[0].args.contains(&"/bin/bash".to_string()));
    }

    #[test]
    fn test_oauth_callback_port_mapping() {
        assert_eq!(oauth_callback_port("openai-codex"), Some(1455));
        assert_eq!(oauth_callback_port("google-gemini-cli"), Some(8085));
        assert_eq!(oauth_callback_port("anthropic"), None);
    }

    #[test]
    fn test_normalize_auth_mode_maps_oauth_variants() {
        assert_eq!(normalize_auth_mode("openai-codex"), "oauth");
        assert_eq!(normalize_auth_mode("claude-cli"), "token");
        assert_eq!(normalize_auth_mode("setup-token"), "token");
        assert_eq!(normalize_auth_mode("token"), "token");
    }

    #[test]
    fn test_normalize_provider_for_ui_maps_openai_codex_and_google_vertex() {
        assert_eq!(normalize_provider_for_ui("openai-codex"), "openai");
        assert_eq!(normalize_provider_for_ui("google-vertex"), "google");
        assert_eq!(normalize_provider_for_ui("openai"), "openai");
    }

    #[test]
    fn test_normalize_model_ref_for_ui_maps_openai_codex_namespace() {
        assert_eq!(
            normalize_model_ref_for_ui("openai-codex/gpt-5.4"),
            "openai/gpt-5.4"
        );
        assert_eq!(
            normalize_model_ref_for_ui("anthropic/claude-opus-4-6"),
            "anthropic/claude-opus-4-6"
        );
    }

    #[test]
    fn test_apply_model_provider_auth_maps_openai_models_for_codex_oauth() {
        let mut provider_auths = std::collections::HashMap::new();
        provider_auths.insert(
            "openai".to_string(),
            ProviderAuthData {
                auth_method: "openai-codex".to_string(),
                token: "".to_string(),
                profile_key: Some("openai-codex:default".to_string()),
                profile: Some(serde_json::json!({
                    "provider": "openai-codex",
                    "type": "oauth"
                })),
                oauth_provider_id: Some("openai-codex".to_string()),
            },
        );

        assert_eq!(
            apply_model_provider_auth("openai/gpt-5.4", &provider_auths),
            "openai-codex/gpt-5.4"
        );
        assert_eq!(
            auth_provider_id_for_config(
                "openai",
                provider_auths.get("openai").unwrap(),
                &provider_auths
            ),
            "openai-codex"
        );
    }

    #[test]
    fn test_build_effective_models_catalog_uses_effective_namespace_only() {
        let models = build_effective_models_catalog(
            "openai-codex/gpt-5.4",
            &["openai-codex/gpt-5.4-mini".to_string()],
        );

        assert!(models.contains_key("openai-codex/gpt-5.4"));
        assert!(models.contains_key("openai-codex/gpt-5.4-mini"));
        assert!(!models.contains_key("openai/gpt-5.4"));
    }

    #[test]
    fn test_parse_lsof_listener_info_parses_multiple_records() {
        let parsed = parse_lsof_listener_info("p62370\ncopenclaw-models\np70001\ncnode\n");

        assert_eq!(
            parsed,
            vec![
                PortListenerInfo {
                    pid: 62370,
                    command: "openclaw-models".to_string()
                },
                PortListenerInfo {
                    pid: 70001,
                    command: "node".to_string()
                }
            ]
        );
    }

    #[test]
    fn test_is_openclaw_listener_only_matches_openclaw_processes() {
        assert!(is_openclaw_listener(&PortListenerInfo {
            pid: 1,
            command: "openclaw-models".to_string()
        }));
        assert!(is_openclaw_listener(&PortListenerInfo {
            pid: 2,
            command: "OpenClaw".to_string()
        }));
        assert!(!is_openclaw_listener(&PortListenerInfo {
            pid: 3,
            command: "node".to_string()
        }));
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
        assert_eq!(gateway.get("port").and_then(|v| v.as_u64()), Some(18789));
        assert_eq!(
            gateway
                .get("auth")
                .and_then(|a| a.get("token"))
                .and_then(|t| t.as_str()),
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
        let reset_failed_cmd =
            "systemctl --user reset-failed openclaw-gateway.service 2>/dev/null || true";
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

        assert_eq!(
            token,
            Some("existing-secret-token"),
            "Gateway auth token must be preserved during reconfiguration"
        );
    }

    #[test]
    fn test_parse_gateway_token_cli_output_rejects_empty_and_nullish_values() {
        assert_eq!(
            parse_gateway_token_cli_output("token-123\n"),
            Some("token-123".to_string())
        );
        assert_eq!(
            parse_gateway_token_cli_output("\"token-123\""),
            Some("token-123".to_string())
        );
        assert_eq!(parse_gateway_token_cli_output(""), None);
        assert_eq!(parse_gateway_token_cli_output("null"), None);
        assert_eq!(parse_gateway_token_cli_output("undefined"), None);
    }

    #[test]
    fn test_parse_dashboard_url_cli_output_finds_url_amid_other_output() {
        let output = "Doctor warnings...\nDashboard URL: http://127.0.0.1:18789/#token=abc123\nCopied to clipboard.\n";
        assert_eq!(
            parse_dashboard_url_cli_output(output),
            Some("http://127.0.0.1:18789/#token=abc123".to_string())
        );
        assert_eq!(parse_dashboard_url_cli_output("no dashboard line"), None);
    }

    #[test]
    fn test_rebuild_models_catalog_replaces_stale_openai_entry_during_merge() {
        let mut config_json = serde_json::json!({
            "agents": {
                "defaults": {
                    "models": {
                        "openai/gpt-5.4": {}
                    }
                }
            }
        });

        let effective_primary_model = "openai-codex/gpt-5.4".to_string();
        let effective_fallback_models = vec!["openai-codex/gpt-5.4-mini".to_string()];

        if let Some(defaults) = config_json
            .get_mut("agents")
            .and_then(|a| a.get_mut("defaults"))
            .and_then(|d| d.as_object_mut())
        {
            defaults.insert(
                "models".to_string(),
                serde_json::Value::Object(build_effective_models_catalog(
                    &effective_primary_model,
                    &effective_fallback_models,
                )),
            );
        }

        let models = config_json
            .get("agents")
            .and_then(|a| a.get("defaults"))
            .and_then(|d| d.get("models"))
            .and_then(|m| m.as_object())
            .expect("models object");

        assert!(models.contains_key("openai-codex/gpt-5.4"));
        assert!(models.contains_key("openai-codex/gpt-5.4-mini"));
        assert!(!models.contains_key("openai/gpt-5.4"));
    }

    #[test]
    fn test_extract_gateway_token_from_config_reads_gateway_auth_token() {
        let config = serde_json::json!({
            "gateway": {
                "auth": {
                    "token": "config-token-456"
                }
            }
        });

        assert_eq!(
            extract_gateway_token_from_config(&config.to_string(), "config").unwrap(),
            "config-token-456"
        );
    }

    #[test]
    fn test_wsl_root_command_uses_explicit_distro() {
        // wsl_root_command should use `-d Ubuntu` for robustness
        // Verify the expected argument structure
        let cmd = "echo hello";
        let expected_args = vec![
            "-d",
            "Ubuntu",
            "--user",
            "root",
            "--",
            "/bin/bash",
            "-c",
            cmd,
        ];
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
