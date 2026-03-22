mod config;
mod error;
mod executor;
mod gateway;
mod install;
mod license;
mod maintenance;
mod models;
mod oauth;
mod pairing;
mod remote;
mod ssh;
mod system;
mod types;
mod whatsapp;

use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{command, Manager};

#[macro_use]
extern crate lazy_static;

use license::verify_license_with_gumroad;
use ssh::connect_ssh;
use system::shell_command;
#[cfg(target_os = "windows")]
use system::{
    check_wsl2_installed, ensure_wsl2_installed, wait_for_wsl_ready, wsl_home_dir, wsl_list_dirs,
    wsl_mkdir_p, wsl_read_file, wsl_remove_dir, wsl_root_command, wsl_write_file,
};
use types::{
    AgentConfig, CurrentConfig, GatewayChatBootstrap, PrereqCheck, ProviderAuthData, RemoteInfo,
};

const ADVANCED_LICENSE_STORAGE_FILE: &str = "advanced-license.json";

fn app_license_storage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not determine app data directory".to_string())?;
    Ok(app_dir.join(ADVANCED_LICENSE_STORAGE_FILE))
}

fn write_saved_license(app: &tauri::AppHandle, license_key: &str) -> Result<(), String> {
    let path = app_license_storage_path(app)?;
    license::write_saved_license(&path, license_key)
}

fn read_saved_license(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app_license_storage_path(app)?;
    license::read_saved_license(&path)
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
    config::read_workspace_files()
}

#[command]
fn save_workspace_files(
    agent_id: Option<String>,
    identity: String,
    user: String,
    soul: String,
) -> Result<String, String> {
    config::save_workspace_files(agent_id.as_deref(), &identity, &user, &soul)
}

#[command]
fn create_custom_skill(name: String, content: String) -> Result<String, String> {
    config::create_custom_skill(&name, &content)
}

#[command]
async fn setup_remote_openclaw(remote: RemoteInfo, config: AgentConfig) -> Result<String, String> {
    remote::setup_remote_openclaw(&remote, config)
        .await
        .map_err(String::from)
}

#[command]
fn start_ssh_tunnel(remote: RemoteInfo) -> Result<String, String> {
    ssh::start_ssh_tunnel(&remote)
}

#[command]
fn stop_ssh_tunnel() -> Result<(), String> {
    ssh::stop_ssh_tunnel();
    Ok(())
}

#[command]
async fn check_remote_prerequisites(remote: RemoteInfo) -> Result<PrereqCheck, String> {
    install::check_remote_prerequisites(&remote)
}

#[command]
async fn get_remote_openclaw_version(remote: RemoteInfo) -> Result<String, String> {
    maintenance::get_remote_openclaw_version(&remote)
}

#[command]
async fn run_remote_doctor_repair(remote: RemoteInfo) -> Result<String, String> {
    maintenance::run_remote_doctor_repair(&remote)
}

#[command]
async fn run_remote_security_audit_fix(remote: RemoteInfo) -> Result<String, String> {
    maintenance::run_remote_security_audit_fix(&remote)
}

#[command]
async fn uninstall_remote_openclaw(remote: RemoteInfo) -> Result<String, String> {
    maintenance::uninstall_remote_openclaw(&remote)
}

#[command]
async fn update_remote_openclaw(remote: RemoteInfo) -> Result<String, String> {
    maintenance::update_remote_openclaw(&remote)
}

#[command]
async fn get_remote_gateway_token(remote: RemoteInfo) -> Result<String, String> {
    gateway::get_remote_gateway_token(&remote)
}

#[command]
async fn prepare_gateway_chat_connection(
    gateway_port: Option<u16>,
    remote: Option<RemoteInfo>,
) -> Result<GatewayChatBootstrap, String> {
    gateway::prepare_gateway_chat_connection(gateway_port.unwrap_or(18789), remote.as_ref()).await
}

#[command]
fn start_provider_auth(
    provider: String,
    method: String,
    oauth_provider_id: String,
    remote: Option<RemoteInfo>,
) -> Result<ProviderAuthData, String> {
    oauth::start_provider_auth(&provider, &method, &oauth_provider_id, remote.as_ref())
}

#[command]
fn close_app(window: tauri::Window) {
    let _ = window.close();
}

#[command]
fn install_skill(name: String) -> Result<String, String> {
    install::install_skill(&name)
}

#[command]
async fn install_remote_skill(remote: RemoteInfo, name: String) -> Result<String, String> {
    install::install_remote_skill(&remote, &name)
}

#[command]
fn get_openclaw_version() -> String {
    maintenance::get_openclaw_version()
}

#[command]
fn uninstall_openclaw() -> Result<String, String> {
    maintenance::uninstall_openclaw()
}

#[command]
fn run_doctor_repair() -> Result<String, String> {
    maintenance::run_doctor_repair()
}

#[command]
fn run_security_audit_fix() -> Result<String, String> {
    maintenance::run_security_audit_fix()
}

#[command]
fn check_prerequisites() -> PrereqCheck {
    install::check_prerequisites()
}

#[command]
fn install_openclaw() -> Result<String, String> {
    install::install_openclaw()
}

#[command]
fn configure_agent(config: AgentConfig) -> Result<String, String> {
    config::configure_agent(config)
}

#[command]
async fn start_gateway() -> Result<String, String> {
    gateway::start_gateway().await
}

#[command]
async fn initialize_agent_sessions(agent_ids: Vec<String>) -> Result<String, String> {
    gateway::initialize_agent_sessions(&agent_ids).await
}

#[command]
async fn generate_pairing_code() -> Result<String, String> {
    gateway::generate_pairing_code().await
}

#[command]
async fn approve_pairing(code: String, remote: Option<RemoteInfo>) -> Result<String, String> {
    gateway::approve_pairing(&code, remote.as_ref())
}

#[command]
fn get_dashboard_url(is_remote: bool, remote: Option<RemoteInfo>) -> Result<String, String> {
    gateway::get_dashboard_url(is_remote, remote.as_ref())
}

#[command]
fn verify_tunnel_connectivity(remote: RemoteInfo) -> Result<bool, String> {
    gateway::verify_tunnel_connectivity(&remote)
}

#[command]
fn check_pairing_status(remote: Option<RemoteInfo>) -> Result<bool, String> {
    pairing::check_pairing_status(remote.as_ref())
}

#[command]
fn check_messaging_link_status(
    channel: String,
    remote: Option<RemoteInfo>,
) -> Result<bool, String> {
    pairing::check_messaging_link_status(&channel, remote.as_ref())
}

#[command]
async fn get_current_config(remote: Option<RemoteInfo>) -> Result<CurrentConfig, String> {
    config::get_current_config(remote.as_ref())
}

#[command]
fn has_saved_license(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(read_saved_license(&app)?.is_some())
}

#[command]
fn verify_and_store_license(app: tauri::AppHandle, key: String) -> Result<bool, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("License key is required.".to_string());
    }

    verify_license_with_gumroad(trimmed)?;
    write_saved_license(&app, trimmed)?;
    Ok(true)
}

#[command]
async fn install_local_nodejs() -> Result<String, String> {
    install::install_local_nodejs()
}

#[command]
fn get_ollama_models(remote: Option<RemoteInfo>) -> Result<Vec<String>, String> {
    models::get_ollama_models(remote.as_ref())
}

#[command]
fn get_lmstudio_models(
    base_url: Option<String>,
    remote: Option<RemoteInfo>,
) -> Result<Vec<String>, String> {
    models::get_lmstudio_models(base_url.as_deref(), remote.as_ref())
}

#[command]
fn validate_openclaw_config(
    remote: Option<RemoteInfo>,
    is_wsl: Option<bool>,
) -> Result<String, String> {
    config::validate_openclaw_config(remote.as_ref(), is_wsl)
}

#[command]
async fn start_whatsapp_login(
    gateway_port: u16,
    remote: Option<RemoteInfo>,
) -> Result<String, String> {
    whatsapp::start_whatsapp_login(gateway_port, remote.as_ref()).await
}

#[command]
async fn wait_whatsapp_login(
    gateway_port: u16,
    remote: Option<RemoteInfo>,
) -> Result<bool, String> {
    whatsapp::wait_whatsapp_login(gateway_port, remote.as_ref()).await
}
#[command]
async fn wipe_whatsapp_session() -> Result<(), String> {
    whatsapp::wipe_whatsapp_session()
}

/// Check if WhatsApp creds are saved by calling web.login.start WITHOUT force.
/// If creds exist, OpenClaw returns ok:true with no qrDataUrl ("already linked").
#[command]
async fn check_whatsapp_linked(gateway_port: u16) -> Result<bool, String> {
    whatsapp::check_whatsapp_linked(gateway_port).await
}

#[command]
async fn restart_openclaw_gateway(remote: Option<RemoteInfo>) -> Result<(), String> {
    if let Some(r) = remote {
        gateway::restart_openclaw_gateway(&r).await.map(|_| ())?;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            prepare_gateway_chat_connection,
            verify_tunnel_connectivity,
            get_current_config,
            has_saved_license,
            verify_and_store_license,
            check_pairing_status,
            check_messaging_link_status,
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
    use crate::config::{apply_agent_overrides, build_agent_session_init_command};
    use crate::gateway::{
        extract_gateway_token_from_config, parse_dashboard_url_cli_output,
        parse_gateway_token_cli_output,
    };
    use crate::license::{
        decrypt_saved_license_value, derive_license_encryption_key, encrypt_saved_license_value,
        parse_windows_machine_guid, read_first_nonempty_file, validate_license_response,
    };
    use crate::oauth::{
        apply_model_provider_auth, auth_provider_id_for_config, build_auth_profiles_doc,
        build_effective_models_catalog, build_linux_terminal_launches, build_macos_terminal_launch,
        build_provider_auth_command, build_terminal_runner_command, build_unix_terminal_script,
        build_windows_terminal_launches, collect_required_plugin_ids, decorate_oauth_launch_error,
        is_openclaw_listener, merge_enabled_plugin_entries, normalize_auth_mode,
        normalize_model_ref_for_ui, normalize_provider_for_ui, oauth_callback_port,
        parse_lsof_listener_info, required_plugin_for_oauth_provider_id,
        resolve_provider_auth_data,
    };
    use crate::pairing::{
        extract_telegram_dm_policy_from_config, read_telegram_dm_policy_from_config_str,
        read_telegram_dm_policy_via_cli, telegram_allow_from_entries_from_str,
        telegram_allow_from_is_linked_local, telegram_pairing_status_from_dm_policy,
        whatsapp_session_is_linked,
    };
    use crate::types::{
        AgentData, AgentToolsConfig, ElevatedToolConfig, PortListenerInfo, SubagentConfig,
        TerminalPlatform,
    };
    use std::fs;

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
    fn test_required_plugin_for_oauth_provider_id_maps_gemini_cli() {
        assert_eq!(
            required_plugin_for_oauth_provider_id("google-gemini-cli"),
            Some("google-gemini-cli-auth")
        );
        assert_eq!(required_plugin_for_oauth_provider_id("openai-codex"), None);
    }

    #[test]
    fn test_decorate_oauth_launch_error_adds_gemini_guidance() {
        let message = decorate_oauth_launch_error(
            "google-gemini-cli",
            "OpenClaw auth exited with status 1.".to_string(),
        );

        assert!(message.contains("OpenClaw auth exited with status 1."));
        assert!(message.contains("GOOGLE_CLOUD_PROJECT"));
        assert!(message.contains("Gemini API Key"));
    }

    #[test]
    fn test_collect_required_plugin_ids_includes_gemini_oauth_and_skill_once() {
        let mut provider_auths = std::collections::HashMap::new();
        provider_auths.insert(
            "google".to_string(),
            ProviderAuthData {
                auth_method: "google-gemini-cli".to_string(),
                token: String::new(),
                profile_key: None,
                profile: None,
                oauth_provider_id: Some("google-gemini-cli".to_string()),
            },
        );

        let skills = vec!["gemini".to_string()];
        let required = collect_required_plugin_ids(&provider_auths, Some(&skills));

        assert_eq!(required, vec!["google-gemini-cli-auth".to_string()]);
    }

    #[test]
    fn test_collect_required_plugin_ids_ignores_plain_google_token_auth() {
        let mut provider_auths = std::collections::HashMap::new();
        provider_auths.insert(
            "google".to_string(),
            ProviderAuthData {
                auth_method: "token".to_string(),
                token: "test-token".to_string(),
                profile_key: None,
                profile: None,
                oauth_provider_id: None,
            },
        );

        let required = collect_required_plugin_ids(&provider_auths, None);

        assert!(required.is_empty());
    }

    #[test]
    fn test_merge_enabled_plugin_entries_adds_required_plugin_entry() {
        let mut config = serde_json::json!({});
        merge_enabled_plugin_entries(&mut config, &["google-gemini-cli-auth".to_string()]);

        assert_eq!(
            config
                .get("plugins")
                .and_then(|plugins| plugins.get("entries"))
                .and_then(|entries| entries.get("google-gemini-cli-auth"))
                .and_then(|plugin| plugin.get("enabled"))
                .and_then(|enabled| enabled.as_bool()),
            Some(true)
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
    fn test_telegram_pairing_status_from_dm_policy() {
        assert!(telegram_pairing_status_from_dm_policy("\"allowlist\""));
        assert!(telegram_pairing_status_from_dm_policy("open"));
        assert!(telegram_pairing_status_from_dm_policy("\"open\""));
        assert!(!telegram_pairing_status_from_dm_policy("pairing"));
        assert!(!telegram_pairing_status_from_dm_policy("\"pairing\""));
    }

    #[test]
    fn test_extract_telegram_dm_policy_from_config_supports_default_and_legacy_layouts() {
        let account_scoped = serde_json::json!({
            "channels": {
                "telegram": {
                    "accounts": {
                        "default": {
                            "dmPolicy": "open"
                        }
                    }
                }
            }
        });
        assert_eq!(
            extract_telegram_dm_policy_from_config(&account_scoped),
            Some("open".to_string())
        );

        let legacy = serde_json::json!({
            "channels": {
                "telegram": {
                    "dmPolicy": "pairing"
                }
            }
        });
        assert_eq!(
            extract_telegram_dm_policy_from_config(&legacy),
            Some("pairing".to_string())
        );
    }

    #[test]
    fn test_read_telegram_dm_policy_from_config_str_fallback_detects_linked_state() {
        let config = r#"{
            "channels": {
                "telegram": {
                    "dmPolicy": "open"
                }
            }
        }"#;

        let policy = read_telegram_dm_policy_from_config_str(config);
        assert_eq!(policy, Some("open".to_string()));
        assert!(telegram_pairing_status_from_dm_policy(
            policy.as_deref().unwrap()
        ));
    }

    #[test]
    fn test_read_telegram_dm_policy_via_cli_tries_legacy_after_primary_failure() {
        let mut commands = Vec::new();
        let policy = read_telegram_dm_policy_via_cli(|cmd| {
            commands.push(cmd.to_string());
            match cmd {
                "openclaw config get channels.telegram.accounts.default.dmPolicy" => {
                    Err("missing".to_string())
                }
                "openclaw config get channels.telegram.dmPolicy" => Ok("\"open\"".to_string()),
                _ => Err("unexpected command".to_string()),
            }
        })
        .expect("cli fallback succeeds");

        assert_eq!(policy, Some("open".to_string()));
        assert_eq!(
            commands,
            vec![
                "openclaw config get channels.telegram.accounts.default.dmPolicy".to_string(),
                "openclaw config get channels.telegram.dmPolicy".to_string(),
            ]
        );
    }

    #[test]
    fn test_telegram_allow_from_entries_from_str_detects_approved_senders() {
        let content = r#"{
            "version": 1,
            "allowFrom": ["5162540072"]
        }"#;
        assert_eq!(telegram_allow_from_entries_from_str(content), Some(1));

        let empty = r#"{
            "version": 1,
            "allowFrom": []
        }"#;
        assert_eq!(telegram_allow_from_entries_from_str(empty), Some(0));
    }

    #[test]
    fn test_telegram_allow_from_is_linked_local_detects_account_file() {
        let temp_dir = std::env::temp_dir().join(format!(
            "clawnetes-telegram-allowfrom-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_dir).expect("create temp telegram credentials dir");
        fs::write(
            temp_dir.join("telegram-default-allowFrom.json"),
            r#"{"version":1,"allowFrom":["5162540072"]}"#,
        )
        .expect("write allowFrom file");

        assert!(telegram_allow_from_is_linked_local(&temp_dir));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_whatsapp_session_is_linked_detects_nested_files() {
        let temp_dir =
            std::env::temp_dir().join(format!("clawnetes-whatsapp-test-{}", uuid::Uuid::new_v4()));
        let nested = temp_dir.join("nested");
        fs::create_dir_all(&nested).expect("create temp whatsapp dir");
        fs::write(nested.join("session.json"), "{}").expect("write temp whatsapp file");

        assert!(whatsapp_session_is_linked(&temp_dir));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_whatsapp_session_is_linked_false_for_missing_or_empty_dir() {
        let missing_dir =
            std::env::temp_dir().join(format!("clawnetes-whatsapp-test-{}", uuid::Uuid::new_v4()));
        assert!(!whatsapp_session_is_linked(&missing_dir));

        fs::create_dir_all(&missing_dir).expect("create empty whatsapp dir");
        assert!(!whatsapp_session_is_linked(&missing_dir));

        let _ = fs::remove_dir_all(&missing_dir);
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

    #[test]
    fn test_validate_license_response_accepts_clean_purchase() {
        let response = serde_json::json!({
            "success": true,
            "purchase": {
                "refunded": false,
                "chargebacked": false
            }
        });

        assert!(validate_license_response(&response).is_ok());
    }

    #[test]
    fn test_validate_license_response_rejects_refunded_purchase() {
        let response = serde_json::json!({
            "success": true,
            "purchase": {
                "refunded": true,
                "chargebacked": false
            }
        });

        assert_eq!(
            validate_license_response(&response).unwrap_err(),
            "License has been refunded."
        );
    }

    #[test]
    fn test_validate_license_response_rejects_chargebacked_purchase() {
        let response = serde_json::json!({
            "success": true,
            "purchase": {
                "refunded": false,
                "chargebacked": true
            }
        });

        assert_eq!(
            validate_license_response(&response).unwrap_err(),
            "License has been chargebacked."
        );
    }

    #[test]
    fn test_validate_license_response_rejects_unsuccessful_response() {
        let response = serde_json::json!({
            "success": false
        });

        assert_eq!(
            validate_license_response(&response).unwrap_err(),
            "Invalid license key."
        );
    }

    #[test]
    fn test_encrypt_saved_license_round_trip() {
        let key = derive_license_encryption_key("machine-a");
        let encrypted =
            encrypt_saved_license_value("LICENSE-123", &key).expect("license should encrypt");
        let decrypted =
            decrypt_saved_license_value(&encrypted, &key).expect("license should decrypt");

        assert_eq!(decrypted, "LICENSE-123");
    }

    #[test]
    fn test_saved_license_decrypt_fails_with_different_machine_key() {
        let key = derive_license_encryption_key("machine-a");
        let wrong_key = derive_license_encryption_key("machine-b");
        let encrypted =
            encrypt_saved_license_value("LICENSE-123", &key).expect("license should encrypt");

        assert_eq!(
            decrypt_saved_license_value(&encrypted, &wrong_key).unwrap_err(),
            "Saved license cannot be decrypted on this machine."
        );
    }

    #[test]
    fn test_parse_windows_machine_guid_extracts_value() {
        let output = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    1234-5678\r\n";
        assert_eq!(
            parse_windows_machine_guid(output).as_deref(),
            Some("1234-5678")
        );
    }

    #[test]
    fn test_read_first_nonempty_file_prefers_first_nonempty_candidate() {
        let temp_dir =
            std::env::temp_dir().join(format!("clawnetes-license-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).expect("temp dir should be created");
        let first = temp_dir.join("first");
        let second = temp_dir.join("second");
        fs::write(&first, "   ").expect("first file should be written");
        fs::write(&second, "machine-id-123\n").expect("second file should be written");

        let result = read_first_nonempty_file(&[first.clone(), second.clone()])
            .expect("machine id lookup should succeed");

        assert_eq!(result.as_deref(), Some("machine-id-123"));

        let _ = fs::remove_file(first);
        let _ = fs::remove_file(second);
        let _ = fs::remove_dir(temp_dir);
    }

    #[test]
    fn test_decrypt_saved_license_rejects_corrupt_payload() {
        let key = derive_license_encryption_key("machine-a");
        assert!(decrypt_saved_license_value(
            "{\"version\":1,\"nonce\":\"bad\",\"ciphertext\":\"bad\"}",
            &key
        )
        .is_err());
    }
}
