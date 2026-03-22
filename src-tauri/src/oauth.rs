use rand::Rng;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use crate::ssh::{connect_ssh, execute_ssh, get_env_prefix};
use crate::system::{shell_command, shell_single_quote};
use crate::types::{
    PortListenerInfo, ProviderAuthData, RemoteInfo, TerminalLaunchPlan, TerminalPlatform,
};

pub fn default_provider_auth(
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

pub fn normalize_auth_mode(auth_method: &str) -> String {
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

pub fn normalize_provider_for_ui(provider: &str) -> String {
    match provider {
        "openai-codex" => "openai".to_string(),
        "google-vertex" => "google".to_string(),
        _ => provider.to_string(),
    }
}

pub fn effective_model_provider(
    provider: &str,
    provider_auths: &HashMap<String, ProviderAuthData>,
) -> String {
    match provider_auths
        .get(provider)
        .map(|auth| auth.auth_method.as_str())
    {
        Some("openai-codex") => "openai-codex".to_string(),
        _ => provider.to_string(),
    }
}

pub fn apply_model_provider_auth(
    model_ref: &str,
    provider_auths: &HashMap<String, ProviderAuthData>,
) -> String {
    if let Some((provider, rest)) = model_ref.split_once('/') {
        let base_provider = normalize_provider_for_ui(provider);
        let effective_provider = effective_model_provider(&base_provider, provider_auths);
        format!("{}/{}", effective_provider, rest)
    } else {
        model_ref.to_string()
    }
}

pub fn build_effective_models_catalog(
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

pub fn auth_provider_id_for_config(
    provider: &str,
    provider_auth: &ProviderAuthData,
    provider_auths: &HashMap<String, ProviderAuthData>,
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

pub fn normalize_model_ref_for_ui(model_ref: &str) -> String {
    if let Some(rest) = model_ref.strip_prefix("openai-codex/") {
        format!("openai/{}", rest)
    } else {
        model_ref.to_string()
    }
}

pub fn get_provider_auth_map(
    config: &crate::types::AgentConfig,
) -> HashMap<String, ProviderAuthData> {
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

pub fn required_plugin_for_oauth_provider_id(oauth_provider_id: &str) -> Option<&'static str> {
    match oauth_provider_id {
        "google-gemini-cli" => Some("google-gemini-cli-auth"),
        _ => None,
    }
}

pub fn oauth_failure_guidance(oauth_provider_id: &str) -> Option<&'static str> {
    match oauth_provider_id {
        "google-gemini-cli" => Some(
            "Gemini CLI OAuth uses Google Code Assist and may be rejected for some Google accounts. Make sure the Gemini CLI is installed, try setting GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID if your account needs a project, or switch the Google provider auth method back to Gemini API Key.",
        ),
        _ => None,
    }
}

pub fn decorate_oauth_launch_error(oauth_provider_id: &str, err: String) -> String {
    match oauth_failure_guidance(oauth_provider_id) {
        Some(guidance) => format!("{} {}", err, guidance),
        None => err,
    }
}

pub fn required_plugin_for_skill_id(skill_id: &str) -> Option<&'static str> {
    match skill_id {
        "gemini" => Some("google-gemini-cli-auth"),
        _ => None,
    }
}

pub fn collect_required_plugin_ids(
    provider_auths: &HashMap<String, ProviderAuthData>,
    skills: Option<&Vec<String>>,
) -> Vec<String> {
    let mut required = std::collections::BTreeSet::new();

    for auth in provider_auths.values() {
        if normalize_auth_mode(&auth.auth_method) != "oauth" {
            continue;
        }

        let oauth_provider_id = auth
            .oauth_provider_id
            .as_deref()
            .unwrap_or(auth.auth_method.as_str());
        if let Some(plugin_id) = required_plugin_for_oauth_provider_id(oauth_provider_id) {
            required.insert(plugin_id.to_string());
        }
    }

    for skill_id in skills.into_iter().flatten() {
        if let Some(plugin_id) = required_plugin_for_skill_id(skill_id) {
            required.insert(plugin_id.to_string());
        }
    }

    required.into_iter().collect()
}

pub fn merge_enabled_plugin_entries(config: &mut serde_json::Value, plugin_ids: &[String]) {
    if plugin_ids.is_empty() {
        return;
    }

    if let Some(obj) = config.as_object_mut() {
        let plugins_entry = obj
            .entry("plugins".to_string())
            .or_insert(serde_json::json!({ "entries": {} }));
        if let Some(entries) = plugins_entry
            .get_mut("entries")
            .and_then(|value| value.as_object_mut())
        {
            for plugin_id in plugin_ids {
                entries.insert(plugin_id.clone(), serde_json::json!({ "enabled": true }));
            }
        }
    }
}

pub fn enable_openclaw_plugin(plugin_id: &str) -> Result<(), String> {
    shell_command(&format!(
        "openclaw plugins enable {}",
        shell_single_quote(plugin_id)
    ))
    .map(|_| ())
}

pub fn provider_id_is_available(oauth_provider_id: &str) -> Result<bool, String> {
    let output = shell_command("openclaw plugins list --json")?;
    let parsed: serde_json::Value =
        serde_json::from_str(&output).map_err(|e| format!("Failed to parse plugin list: {}", e))?;

    Ok(parsed
        .get("plugins")
        .and_then(|plugins| plugins.as_array())
        .map(|plugins| {
            plugins.iter().any(|plugin| {
                plugin
                    .get("status")
                    .and_then(|status| status.as_str())
                    .map(|status| status == "loaded")
                    .unwrap_or(false)
                    && plugin
                        .get("providerIds")
                        .and_then(|provider_ids| provider_ids.as_array())
                        .map(|provider_ids| {
                            provider_ids
                                .iter()
                                .any(|provider_id| provider_id.as_str() == Some(oauth_provider_id))
                        })
                        .unwrap_or(false)
            })
        })
        .unwrap_or(false))
}

pub fn resolve_profile_name(provider: &str, provider_auth: &ProviderAuthData) -> String {
    provider_auth
        .profile_key
        .clone()
        .unwrap_or_else(|| format!("{}:default", provider))
}

pub fn build_auth_profiles_doc(
    provider_auths: &HashMap<String, ProviderAuthData>,
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

pub fn oauth_provider_matches(base_provider: &str, provider_id: &str) -> bool {
    matches!(
        (base_provider, provider_id),
        ("openai", "openai-codex") | ("google", "google-gemini-cli") | ("anthropic", "anthropic")
    ) || base_provider == provider_id
}

pub fn resolve_provider_auth_data(
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

// --- OAuth callback port and listener management ---

pub fn oauth_callback_port(oauth_provider_id: &str) -> Option<u16> {
    match oauth_provider_id {
        "openai-codex" => Some(1455),
        "google-gemini-cli" => Some(8085),
        _ => None,
    }
}

pub fn build_provider_auth_command(
    _provider: &str,
    method: &str,
    oauth_provider_id: &str,
) -> String {
    build_provider_auth_command_for_binary("openclaw", method, oauth_provider_id)
}

pub fn build_provider_auth_command_for_binary(
    openclaw_binary: &str,
    method: &str,
    oauth_provider_id: &str,
) -> String {
    let command_word = if openclaw_binary == "openclaw" {
        "openclaw".to_string()
    } else {
        shell_single_quote(openclaw_binary)
    };
    let mut cmd = format!(
        "{} models auth login --provider {}",
        command_word,
        shell_single_quote(oauth_provider_id)
    );
    if !method.is_empty() && method != oauth_provider_id {
        cmd.push_str(&format!(" --method {}", shell_single_quote(method)));
    }
    cmd
}

pub fn parse_lsof_listener_info(output: &str) -> Vec<PortListenerInfo> {
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

pub fn is_openclaw_listener(listener: &PortListenerInfo) -> bool {
    let command = listener.command.to_ascii_lowercase();
    command.contains("openclaw")
}

pub fn find_oauth_port_listeners(port: u16) -> Result<Vec<PortListenerInfo>, String> {
    let cmd = format!(
        "if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:{} -sTCP:LISTEN -Fpc 2>/dev/null || true; fi",
        port
    );
    shell_command(&cmd).map(|output| parse_lsof_listener_info(&output))
}

pub fn terminate_listener_process(listener: &PortListenerInfo, port: u16) -> Result<(), String> {
    let cmd = format!("kill {}", listener.pid);
    shell_command(&cmd).map(|_| ()).map_err(|err| {
        format!(
            "A previous OpenClaw OAuth session is still using localhost:{} and could not be replaced: {}",
            port, err
        )
    })
}

pub fn cleanup_stale_oauth_listener(oauth_provider_id: &str) -> Result<(), String> {
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

fn remote_cleanup_command(port: u16) -> String {
    format!(
        "if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:{} -sTCP:LISTEN -Fpc 2>/dev/null || true; fi",
        port
    )
}

fn cleanup_stale_oauth_listener_remote(
    sess: &ssh2::Session,
    prefix: &str,
    oauth_provider_id: &str,
) -> Result<(), String> {
    let Some(port) = oauth_callback_port(oauth_provider_id) else {
        return Ok(());
    };

    let output = execute_ssh(sess, &format!("{}{}", prefix, remote_cleanup_command(port)))?;
    let listeners = parse_lsof_listener_info(&output);
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
            "Remote localhost:{} is already in use by a non-OpenClaw process: {}. Close it and retry OAuth.",
            port, details
        ));
    }

    for listener in &openclaw_listeners {
        execute_ssh(sess, &format!("kill {}", listener.pid)).map_err(|err| {
            format!(
                "A previous remote OpenClaw OAuth session is still using localhost:{} and could not be replaced: {}",
                port, err
            )
        })?;
    }

    Ok(())
}

fn enable_openclaw_plugin_remote(
    sess: &ssh2::Session,
    prefix: &str,
    plugin_id: &str,
) -> Result<(), String> {
    execute_ssh(
        sess,
        &format!(
            "{}openclaw plugins enable {}",
            prefix,
            shell_single_quote(plugin_id)
        ),
    )
    .map(|_| ())
}

fn provider_id_is_available_remote(
    sess: &ssh2::Session,
    prefix: &str,
    oauth_provider_id: &str,
) -> Result<bool, String> {
    let output = execute_ssh(sess, &format!("{}openclaw plugins list --json", prefix))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&output).map_err(|e| format!("Failed to parse plugin list: {}", e))?;

    Ok(parsed
        .get("plugins")
        .and_then(|plugins| plugins.as_array())
        .map(|plugins| {
            plugins.iter().any(|plugin| {
                plugin
                    .get("status")
                    .and_then(|status| status.as_str())
                    .map(|status| status == "loaded")
                    .unwrap_or(false)
                    && plugin
                        .get("providerIds")
                        .and_then(|provider_ids| provider_ids.as_array())
                        .map(|provider_ids| {
                            provider_ids
                                .iter()
                                .any(|provider_id| provider_id.as_str() == Some(oauth_provider_id))
                        })
                        .unwrap_or(false)
            })
        })
        .unwrap_or(false))
}

fn read_provider_auth_profiles_remote(sess: &ssh2::Session) -> Result<serde_json::Value, String> {
    let auth_profiles_str =
        execute_ssh(sess, "cat ~/.openclaw/agents/main/agent/auth-profiles.json")
            .map_err(|e| format!("Failed to read remote auth profiles: {}", e))?;
    serde_json::from_str(&auth_profiles_str)
        .map_err(|e| format!("Failed to parse remote auth profiles: {}", e))
}

fn build_remote_provider_auth_terminal_command(
    remote: &RemoteInfo,
    prefix: &str,
    method: &str,
    oauth_provider_id: &str,
) -> String {
    let remote_openclaw_command =
        build_provider_auth_command_for_binary("openclaw", method, oauth_provider_id);
    let remote_shell_command = format!("{}{}", prefix, remote_openclaw_command);

    let mut parts = vec![
        "ssh".to_string(),
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-t".to_string(),
    ];

    if let Some(port) = oauth_callback_port(oauth_provider_id) {
        parts.push("-L".to_string());
        parts.push(format!("{port}:127.0.0.1:{port}"));
    }

    if let Some(path) = remote.private_key_path.as_deref() {
        if !path.trim().is_empty() {
            parts.push("-i".to_string());
            parts.push(shell_single_quote(path));
        }
    }

    parts.push(format!("{}@{}", remote.user, remote.ip));
    parts.push(format!(
        "/bin/sh -lc {}",
        shell_single_quote(&remote_shell_command)
    ));
    parts.join(" ")
}

// --- Terminal launch helpers ---

#[allow(dead_code)]
pub fn build_terminal_runner_command(command: &str, marker_path: &str) -> String {
    format!(
        "{}; auth_exit_code=$?; printf '%s' \"$auth_exit_code\" > {}; exit $auth_exit_code",
        command,
        shell_single_quote(marker_path)
    )
}

pub fn build_unix_terminal_script(
    platform: TerminalPlatform,
    command: &str,
    marker_path: &str,
) -> String {
    let requires_local_openclaw = !command.trim_start().starts_with("ssh ");
    let env_bootstrap = match platform {
        TerminalPlatform::Macos => concat!(
            "eval \"$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)\"; ",
            "export PATH=\"$PATH:/usr/local/bin:/opt/homebrew/bin\"; ",
            "export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && . \"$NVM_DIR/nvm.sh\"; ",
            ". \"$HOME/.profile\" 2>/dev/null || true"
        ),
        TerminalPlatform::Linux => concat!(
            "export PATH=\"$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin\"; ",
            "export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && . \"$NVM_DIR/nvm.sh\"; ",
            ". \"$HOME/.profile\" 2>/dev/null || true; ",
            ". \"$HOME/.bash_profile\" 2>/dev/null || true"
        ),
        TerminalPlatform::Windows => "",
    };
    let bootstrapped_command = match platform {
        TerminalPlatform::Macos | TerminalPlatform::Linux => {
            let local_check = if requires_local_openclaw {
                "if ! command -v openclaw >/dev/null 2>&1; then\n  printf '%s\n' 'OpenClaw CLI not found in launched shell.' >&2\n  exit 127\nfi\n"
            } else {
                ""
            };
            format!("{env_bootstrap}\n{local_check}{command}")
        }
        TerminalPlatform::Windows => command.to_string(),
    };
    let wrapped_command = match platform {
        TerminalPlatform::Macos => bootstrapped_command,
        TerminalPlatform::Linux => {
            format!("/bin/sh -lc {}", shell_single_quote(&bootstrapped_command))
        }
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

pub fn build_macos_terminal_launch(script_path: &str) -> TerminalLaunchPlan {
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
pub fn build_linux_terminal_launches(script_path: &str) -> Vec<TerminalLaunchPlan> {
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
pub fn build_windows_terminal_launches(runner_command: &str) -> Vec<TerminalLaunchPlan> {
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

pub fn create_local_terminal_artifacts(
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

pub fn wait_for_local_marker(marker_path: &Path, timeout: Duration) -> Result<(), String> {
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
            if exit_code == 127 {
                return Err(
                    "OpenClaw auth exited with status 127. OpenClaw CLI was not found in the launched shell. Make sure your shell startup files add OpenClaw to PATH."
                        .to_string(),
                );
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
pub fn wait_for_wsl_marker(marker_path: &str, timeout: Duration) -> Result<(), String> {
    use crate::system::wsl_read_file;
    let started = Instant::now();
    loop {
        if let Ok(status) = wsl_read_file(marker_path) {
            let exit_code = status.trim().parse::<i32>().unwrap_or(-1);
            let _ = shell_command(&format!("rm -f {}", shell_single_quote(marker_path)));
            if exit_code == 0 {
                return Ok(());
            }
            if exit_code == 127 {
                return Err(
                    "OpenClaw auth exited with status 127. OpenClaw CLI was not found in the launched shell. Make sure your shell startup files add OpenClaw to PATH."
                        .to_string(),
                );
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
pub fn spawn_terminal_plan(plan: &TerminalLaunchPlan) -> Result<(), String> {
    Command::new(&plan.program)
        .args(&plan.args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch {}: {}", plan.program, e))
}

#[cfg(target_os = "windows")]
pub fn spawn_terminal_plan(plan: &TerminalLaunchPlan) -> Result<(), String> {
    Command::new(&plan.program)
        .args(&plan.args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch {}: {}", plan.program, e))
}

#[cfg(target_os = "macos")]
pub fn launch_provider_auth_terminal(command: &str) -> Result<(), String> {
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
pub fn launch_provider_auth_terminal(command: &str) -> Result<(), String> {
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
pub fn launch_provider_auth_terminal(command: &str) -> Result<(), String> {
    use crate::system::wsl_mkdir_p;
    let home = crate::system::wsl_home_dir()?.trim().to_string();
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
pub fn read_provider_auth_profiles() -> Result<serde_json::Value, String> {
    use crate::system::wsl_read_file;
    let home = crate::system::wsl_home_dir()?.trim().to_string();
    let auth_profiles_path = format!("{}/.openclaw/agents/main/agent/auth-profiles.json", home);
    let auth_profiles_str = wsl_read_file(&auth_profiles_path)
        .map_err(|e| format!("Failed to read auth profiles: {}", e))?;
    serde_json::from_str(&auth_profiles_str)
        .map_err(|e| format!("Failed to parse auth profiles: {}", e))
}

#[cfg(not(target_os = "windows"))]
pub fn read_provider_auth_profiles() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let auth_profiles_path = format!("{}/.openclaw/agents/main/agent/auth-profiles.json", home);
    let auth_profiles_str = fs::read_to_string(&auth_profiles_path)
        .map_err(|e| format!("Failed to read auth profiles: {}", e))?;
    serde_json::from_str(&auth_profiles_str)
        .map_err(|e| format!("Failed to parse auth profiles: {}", e))
}

/// Top-level OAuth flow: enable plugin, cleanup, launch terminal, read result.
pub fn start_provider_auth(
    provider: &str,
    method: &str,
    oauth_provider_id: &str,
    remote: Option<&RemoteInfo>,
) -> Result<ProviderAuthData, String> {
    if let Some(remote) = remote {
        let sess = connect_ssh(remote)?;
        let os_type = execute_ssh(&sess, "uname -s")?.trim().to_string();
        let prefix = get_env_prefix(&os_type);

        if let Some(plugin_id) = required_plugin_for_oauth_provider_id(oauth_provider_id) {
            enable_openclaw_plugin_remote(&sess, &prefix, plugin_id).map_err(|err| {
                format!(
                    "Gemini CLI OAuth depends on the OpenClaw plugin `{}`. Clawnetes tried to enable it automatically on the remote host, but that failed: {}",
                    plugin_id, err
                )
            })?;

            if !provider_id_is_available_remote(&sess, &prefix, oauth_provider_id)? {
                return Err(format!(
                    "Gemini CLI OAuth depends on the OpenClaw plugin `{}`. Clawnetes enabled that plugin on the remote host, but the provider `{}` is still unavailable in OpenClaw.",
                    plugin_id, oauth_provider_id
                ));
            }
        }

        cleanup_stale_oauth_listener_remote(&sess, &prefix, oauth_provider_id)?;
        let terminal_command =
            build_remote_provider_auth_terminal_command(remote, &prefix, method, oauth_provider_id);
        launch_provider_auth_terminal(&terminal_command)
            .map_err(|err| decorate_oauth_launch_error(oauth_provider_id, err))?;

        let auth_config = read_provider_auth_profiles_remote(&sess)?;
        return resolve_provider_auth_data(provider, &auth_config)
            .map(|mut auth| {
                auth.oauth_provider_id = Some(oauth_provider_id.to_string());
                auth
            })
            .ok_or_else(|| {
                format!(
                    "OAuth completed on the remote host but no auth profile was found for provider {}",
                    provider
                )
            });
    }

    if let Some(plugin_id) = required_plugin_for_oauth_provider_id(oauth_provider_id) {
        enable_openclaw_plugin(plugin_id).map_err(|err| {
            format!(
                "Gemini CLI OAuth depends on the OpenClaw plugin `{}`. Clawnetes tried to enable it automatically, but that failed: {}",
                plugin_id, err
            )
        })?;

        if !provider_id_is_available(oauth_provider_id)? {
            return Err(format!(
                "Gemini CLI OAuth depends on the OpenClaw plugin `{}`. Clawnetes enabled that plugin, but the provider `{}` is still unavailable in OpenClaw.",
                plugin_id, oauth_provider_id
            ));
        }
    }

    cleanup_stale_oauth_listener(oauth_provider_id)?;
    let cmd = build_provider_auth_command(provider, method, oauth_provider_id);
    launch_provider_auth_terminal(&cmd)
        .map_err(|err| decorate_oauth_launch_error(oauth_provider_id, err))?;

    let auth_config = read_provider_auth_profiles()?;
    resolve_provider_auth_data(provider, &auth_config)
        .map(|mut auth| {
            auth.oauth_provider_id = Some(oauth_provider_id.to_string());
            auth
        })
        .ok_or_else(|| {
            format!(
                "OAuth completed but no auth profile was found for provider {}",
                provider
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_auth_mode_token() {
        assert_eq!(normalize_auth_mode("setup-token"), "token");
        assert_eq!(normalize_auth_mode("claude-cli"), "token");
    }

    #[test]
    fn test_normalize_auth_mode_oauth() {
        assert_eq!(normalize_auth_mode("openai-codex"), "oauth");
        assert_eq!(normalize_auth_mode("google-gemini-cli"), "oauth");
    }

    #[test]
    fn test_normalize_auth_mode_passthrough() {
        assert_eq!(normalize_auth_mode("token"), "token");
        assert_eq!(normalize_auth_mode("api-key"), "api-key");
    }

    #[test]
    fn test_normalize_provider_for_ui() {
        assert_eq!(normalize_provider_for_ui("openai-codex"), "openai");
        assert_eq!(normalize_provider_for_ui("google-vertex"), "google");
        assert_eq!(normalize_provider_for_ui("anthropic"), "anthropic");
    }

    #[test]
    fn test_normalize_model_ref_for_ui() {
        assert_eq!(
            normalize_model_ref_for_ui("openai-codex/gpt-4"),
            "openai/gpt-4"
        );
        assert_eq!(
            normalize_model_ref_for_ui("anthropic/claude-3"),
            "anthropic/claude-3"
        );
    }

    #[test]
    fn test_oauth_provider_matches() {
        assert!(oauth_provider_matches("openai", "openai-codex"));
        assert!(oauth_provider_matches("google", "google-gemini-cli"));
        assert!(oauth_provider_matches("anthropic", "anthropic"));
        assert!(!oauth_provider_matches("openai", "google-gemini-cli"));
    }

    #[test]
    fn test_resolve_profile_name_with_key() {
        let auth = ProviderAuthData {
            auth_method: "token".to_string(),
            token: "abc".to_string(),
            profile_key: Some("openai:custom".to_string()),
            profile: None,
            oauth_provider_id: None,
        };
        assert_eq!(resolve_profile_name("openai", &auth), "openai:custom");
    }

    #[test]
    fn test_resolve_profile_name_default() {
        let auth = ProviderAuthData {
            auth_method: "token".to_string(),
            token: "abc".to_string(),
            profile_key: None,
            profile: None,
            oauth_provider_id: None,
        };
        assert_eq!(resolve_profile_name("openai", &auth), "openai:default");
    }

    #[test]
    fn test_parse_lsof_listener_info() {
        let output = "p1234\ncnode\n\np5678\ncopenclawgateway\n";
        let listeners = parse_lsof_listener_info(output);
        assert_eq!(listeners.len(), 2);
        assert_eq!(listeners[0].pid, 1234);
        assert_eq!(listeners[0].command, "node");
        assert_eq!(listeners[1].pid, 5678);
        assert_eq!(listeners[1].command, "openclawgateway");
    }

    #[test]
    fn test_is_openclaw_listener() {
        assert!(is_openclaw_listener(&PortListenerInfo {
            pid: 1,
            command: "openclawgateway".to_string()
        }));
        assert!(!is_openclaw_listener(&PortListenerInfo {
            pid: 2,
            command: "node".to_string()
        }));
    }

    #[test]
    fn test_build_provider_auth_command_simple() {
        let cmd = build_provider_auth_command("openai", "openai-codex", "openai-codex");
        assert_eq!(cmd, "openclaw models auth login --provider 'openai-codex'");
    }

    #[test]
    fn test_build_provider_auth_command_with_method() {
        let cmd = build_provider_auth_command("google", "gemini-cli", "google-gemini-cli");
        assert_eq!(
            cmd,
            "openclaw models auth login --provider 'google-gemini-cli' --method 'gemini-cli'"
        );
    }

    #[test]
    fn test_build_provider_auth_command_for_binary_uses_absolute_binary() {
        let cmd = build_provider_auth_command_for_binary(
            "/usr/local/bin/openclaw",
            "openai-codex",
            "openai-codex",
        );
        assert_eq!(
            cmd,
            "'/usr/local/bin/openclaw' models auth login --provider 'openai-codex'"
        );
    }

    #[test]
    fn test_build_unix_terminal_script_bootstraps_local_env_for_linux() {
        let script = build_unix_terminal_script(
            TerminalPlatform::Linux,
            "openclaw models auth login --provider 'openai-codex'",
            "/tmp/clawnetes-oauth.exit",
        );
        assert!(script.contains("export NVM_DIR=\"$HOME/.nvm\""));
        assert!(script.contains(". \"$HOME/.profile\" 2>/dev/null || true;"));
        assert!(script.contains("command -v openclaw >/dev/null 2>&1"));
        assert!(script.contains("OpenClaw CLI not found in launched shell."));
    }

    #[test]
    fn test_build_unix_terminal_script_skips_local_openclaw_check_for_remote_ssh_command() {
        let script = build_unix_terminal_script(
            TerminalPlatform::Macos,
            "ssh -t user@example.com '/bin/sh -lc '\\''openclaw models auth login --provider '\\''\\''openai-codex'\\'''",
            "/tmp/clawnetes-oauth.exit",
        );
        assert!(!script.contains("command -v openclaw >/dev/null 2>&1"));
        assert!(!script.contains(". \"$HOME/.zshrc\""));
    }

    #[test]
    fn test_wait_for_local_marker_returns_specific_missing_cli_error() {
        let marker_path =
            std::env::temp_dir().join(format!("clawnetes-oauth-marker-{}", uuid::Uuid::new_v4()));
        fs::write(&marker_path, "127").expect("write marker");
        let err = wait_for_local_marker(&marker_path, Duration::from_secs(1)).unwrap_err();
        assert!(err.contains("OpenClaw auth exited with status 127."));
        assert!(err.contains("OpenClaw CLI was not found"));
    }

    #[test]
    fn test_oauth_callback_port() {
        assert_eq!(oauth_callback_port("openai-codex"), Some(1455));
        assert_eq!(oauth_callback_port("google-gemini-cli"), Some(8085));
        assert_eq!(oauth_callback_port("anthropic"), None);
    }

    #[test]
    fn test_required_plugin_for_oauth_provider_id() {
        assert_eq!(
            required_plugin_for_oauth_provider_id("google-gemini-cli"),
            Some("google-gemini-cli-auth")
        );
        assert_eq!(required_plugin_for_oauth_provider_id("openai-codex"), None);
    }

    #[test]
    fn test_collect_required_plugin_ids_from_oauth() {
        let mut auths = HashMap::new();
        auths.insert(
            "google".to_string(),
            ProviderAuthData {
                auth_method: "google-gemini-cli".to_string(),
                token: "".to_string(),
                profile_key: None,
                profile: None,
                oauth_provider_id: Some("google-gemini-cli".to_string()),
            },
        );
        let result = collect_required_plugin_ids(&auths, None);
        assert_eq!(result, vec!["google-gemini-cli-auth"]);
    }

    #[test]
    fn test_collect_required_plugin_ids_from_skills() {
        let auths = HashMap::new();
        let skills = vec!["gemini".to_string()];
        let result = collect_required_plugin_ids(&auths, Some(&skills));
        assert_eq!(result, vec!["google-gemini-cli-auth"]);
    }

    #[test]
    fn test_merge_enabled_plugin_entries() {
        let mut config = serde_json::json!({});
        merge_enabled_plugin_entries(&mut config, &["google-gemini-cli-auth".to_string()]);
        assert_eq!(
            config["plugins"]["entries"]["google-gemini-cli-auth"]["enabled"],
            true
        );
    }

    #[test]
    fn test_merge_enabled_plugin_entries_empty() {
        let mut config = serde_json::json!({});
        merge_enabled_plugin_entries(&mut config, &[]);
        assert!(config.get("plugins").is_none());
    }

    #[test]
    fn test_build_effective_models_catalog() {
        let models =
            build_effective_models_catalog("anthropic/claude-3", &["openai/gpt-4".to_string()]);
        assert!(models.contains_key("anthropic/claude-3"));
        assert!(models.contains_key("openai/gpt-4"));
    }

    #[test]
    fn test_default_provider_auth_local_provider() {
        let auth = default_provider_auth("ollama", "sk-123", "token", None);
        assert_eq!(auth.token, "dummy-token");
    }

    #[test]
    fn test_default_provider_auth_normal_provider() {
        let auth = default_provider_auth("openai", "sk-123", "token", None);
        assert_eq!(auth.token, "sk-123");
    }

    #[test]
    fn test_resolve_provider_auth_data_with_token() {
        let config = serde_json::json!({
            "profiles": {
                "openai:default": {
                    "type": "token",
                    "provider": "openai",
                    "token": "sk-test"
                }
            },
            "lastGood": {
                "openai": "openai:default"
            }
        });
        let result = resolve_provider_auth_data("openai", &config);
        assert!(result.is_some());
        let auth = result.unwrap();
        assert_eq!(auth.token, "sk-test");
        assert_eq!(auth.auth_method, "token");
    }

    #[test]
    fn test_resolve_provider_auth_data_missing() {
        let config = serde_json::json!({
            "profiles": {},
            "lastGood": {}
        });
        let result = resolve_provider_auth_data("openai", &config);
        assert!(result.is_none());
    }
}
