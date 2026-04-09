use std::collections::HashMap;

use serde_yaml::{Mapping, Value as YamlValue};

use crate::error::ClawError;
use crate::executor::{CommandExecutor, LocalExecutor, SshExecutor};
use crate::system::{shell_command, shell_single_quote};
use crate::types::{AgentConfig, CurrentConfig, GatewayChatBootstrap, RemoteInfo};

use super::types::PlatformPrereqCheck;

const DEFAULT_API_PORT: u16 = 8642;
const DEFAULT_API_HOST: &str = "127.0.0.1";

fn provider_api_key_env(provider: &str) -> Option<&'static str> {
    match provider {
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "openai" | "openai-codex" => Some("OPENAI_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        "google" | "google-vertex" => Some("GEMINI_API_KEY"),
        "xai" => Some("XAI_API_KEY"),
        _ => None,
    }
}

fn parse_dotenv(contents: &str) -> HashMap<String, String> {
    contents
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let (key, value) = trimmed.split_once('=')?;
            Some((key.trim().to_string(), value.trim().trim_matches('"').to_string()))
        })
        .collect()
}

fn yaml_string(value: Option<&YamlValue>) -> Option<String> {
    value.and_then(|entry| entry.as_str()).map(ToString::to_string)
}

fn yaml_bool(value: Option<&YamlValue>) -> Option<bool> {
    value.and_then(|entry| entry.as_bool())
}

fn yaml_u64(value: Option<&YamlValue>) -> Option<u64> {
    value.and_then(|entry| entry.as_u64())
}

fn get_mapping<'a>(mapping: &'a Mapping, key: &str) -> Option<&'a Mapping> {
    mapping
        .get(YamlValue::String(key.to_string()))
        .and_then(|value| value.as_mapping())
}

fn hermes_home<E: CommandExecutor>(executor: &E) -> Result<String, ClawError> {
    Ok(format!("{}/.hermes", executor.home_dir()?))
}

fn hermes_prefix(home: &str) -> String {
    format!("export HERMES_HOME={}; ", shell_single_quote(home))
}

fn hermes_run<E: CommandExecutor>(executor: &E, home: &str, cmd: &str) -> Result<String, ClawError> {
    executor.run(&format!("{}{}", hermes_prefix(home), cmd))
}

fn check_prerequisites_with<E: CommandExecutor>(executor: &E) -> Result<PlatformPrereqCheck, ClawError> {
    let node_installed = executor.run("command -v node").is_ok() || executor.run("node -v").is_ok();
    let git_installed = executor.run("command -v git").is_ok() || executor.run("git --version").is_ok();
    let home = hermes_home(executor)?;
    let platform_installed = hermes_run(executor, &home, "hermes --version").is_ok() || executor.run("command -v hermes").is_ok() || executor.run("hermes --version").is_ok();

    Ok(PlatformPrereqCheck {
        node_installed,
        docker_running: true,
        platform_installed,
        git_installed,
        wsl2_installed: None,
    })
}

fn install_with<E: CommandExecutor>(executor: &E) -> Result<String, ClawError> {
    let home = hermes_home(executor)?;
    let install_cmd = "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash";
    hermes_run(executor, &home, install_cmd)?;
    hermes_run(executor, &home, "hermes --version")?;
    Ok("Hermes Agent installed successfully.".to_string())
}

fn set_config_value<E: CommandExecutor>(executor: &E, home: &str, key: &str, value: &str) -> Result<(), ClawError> {
    hermes_run(
        executor,
        home,
        &format!("hermes config set {} {}", shell_single_quote(key), shell_single_quote(value)),
    )?;
    Ok(())
}

fn configure_with<E: CommandExecutor>(executor: &E, config: &AgentConfig) -> Result<String, ClawError> {
    let home = hermes_home(executor)?;
    hermes_run(executor, &home, "mkdir -p \"$HERMES_HOME\" \"$HERMES_HOME/logs\" \"$HERMES_HOME/sessions\"")?;

    set_config_value(executor, &home, "model", &config.model)?;
    set_config_value(executor, &home, "API_SERVER_ENABLED", "true")?;
    set_config_value(
        executor,
        &home,
        "API_SERVER_PORT",
        &config.gateway_port.unwrap_or(DEFAULT_API_PORT).to_string(),
    )?;
    set_config_value(executor, &home, "API_SERVER_HOST", DEFAULT_API_HOST)?;
    set_config_value(executor, &home, "terminal.backend", "local")?;

    if let Some(api_key_env) = provider_api_key_env(&config.provider) {
        let token = config
            .provider_auths
            .as_ref()
            .and_then(|auths| auths.get(&config.provider))
            .map(|auth| auth.token.clone())
            .filter(|token| !token.trim().is_empty())
            .unwrap_or_else(|| config.api_key.clone());
        if !token.trim().is_empty() {
            set_config_value(executor, &home, api_key_env, &token)?;
        }
    }

    if let Some(telegram_token) = config.telegram_token.as_ref().filter(|token| !token.trim().is_empty()) {
        set_config_value(executor, &home, "TELEGRAM_BOT_TOKEN", telegram_token)?;
        set_config_value(executor, &home, "platforms.telegram.enabled", "true")?;
    }

    if config.whatsapp_enabled.unwrap_or(false) {
        set_config_value(executor, &home, "WHATSAPP_ENABLED", "true")?;
        if let Some(phone) = config.whatsapp_phone_number.as_ref().filter(|value| !value.trim().is_empty()) {
            set_config_value(executor, &home, "WHATSAPP_ALLOWED_USERS", phone)?;
        }
        if let Some(policy) = config.whatsapp_dm_policy.as_ref().filter(|value| !value.trim().is_empty()) {
            set_config_value(executor, &home, "whatsapp.unauthorized_dm_behavior", policy)?;
        }
    }

    Ok("Hermes Agent configured successfully.".to_string())
}

fn get_config_with<E: CommandExecutor>(executor: &E) -> Result<CurrentConfig, ClawError> {
    let home = hermes_home(executor)?;
    let yaml_str = hermes_run(executor, &home, "cat \"$HERMES_HOME/config.yaml\" 2>/dev/null || true")?;
    let env_str = hermes_run(executor, &home, "cat \"$HERMES_HOME/.env\" 2>/dev/null || true")?;
    let env = parse_dotenv(&env_str);
    let yaml = serde_yaml::from_str::<YamlValue>(&yaml_str).unwrap_or(YamlValue::Mapping(Mapping::new()));
    let root = yaml.as_mapping().cloned().unwrap_or_default();

    let platforms = get_mapping(&root, "platforms");
    let api_server = platforms.and_then(|p| get_mapping(p, "api_server"));
    let api_server_extra = api_server.and_then(|m| get_mapping(m, "extra"));
    let whatsapp = get_mapping(&root, "whatsapp");
    let terminal = get_mapping(&root, "terminal");

    let model = yaml_string(root.get(YamlValue::String("model".to_string())))
        .unwrap_or_else(|| "anthropic/claude-opus-4-6".to_string());
    let provider = model
        .split('/')
        .next()
        .unwrap_or("anthropic")
        .to_string();
    let api_key = provider_api_key_env(&provider)
        .and_then(|env_key| env.get(env_key))
        .cloned()
        .unwrap_or_default();

    let gateway_port = yaml_u64(api_server_extra.and_then(|m| m.get(YamlValue::String("port".to_string()))))
        .unwrap_or(DEFAULT_API_PORT as u64) as u16;
    let gateway_bind = yaml_string(api_server_extra.and_then(|m| m.get(YamlValue::String("host".to_string()))))
        .unwrap_or_else(|| DEFAULT_API_HOST.to_string());

    let whatsapp_enabled = env
        .get("WHATSAPP_ENABLED")
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes"))
        .or_else(|| yaml_bool(platforms.and_then(|m| get_mapping(m, "whatsapp")).and_then(|m| m.get(YamlValue::String("enabled".to_string())))))
        .unwrap_or(false);

    Ok(CurrentConfig {
        platform: "hermes".to_string(),
        provider,
        api_key,
        auth_method: "token".to_string(),
        model,
        user_name: "".to_string(),
        agent_name: "Hermes Agent".to_string(),
        agent_vibe: "".to_string(),
        agent_emoji: "⚕".to_string(),
        agent_type: "custom".to_string(),
        telegram_token: env.get("TELEGRAM_BOT_TOKEN").cloned().unwrap_or_default(),
        gateway_port,
        gateway_bind,
        gateway_auth_mode: "token".to_string(),
        tailscale_mode: "off".to_string(),
        node_manager: "pip".to_string(),
        skills: vec![],
        service_keys: HashMap::new(),
        provider_auths: HashMap::new(),
        sandbox_mode: "none".to_string(),
        tools_mode: "all".to_string(),
        tools_profile: None,
        allowed_tools: vec![],
        denied_tools: vec![],
        fallback_models: vec![],
        heartbeat_mode: "1h".to_string(),
        idle_timeout_ms: 3_600_000,
        identity_md: String::new(),
        user_md: String::new(),
        soul_md: String::new(),
        tools_md: None,
        agents_md: None,
        heartbeat_md: None,
        memory_md: None,
        memory_enabled: false,
        enable_multi_agent: false,
        agent_configs: vec![],
        is_paired: false,
        cron_jobs: None,
        local_base_url: yaml_string(terminal.and_then(|m| m.get(YamlValue::String("base_url".to_string())))),
        thinking_level: None,
        whatsapp_enabled: Some(whatsapp_enabled),
        whatsapp_dm_policy: yaml_string(whatsapp.and_then(|m| m.get(YamlValue::String("unauthorized_dm_behavior".to_string())))),
        whatsapp_phone_number: env.get("WHATSAPP_ALLOWED_USERS").cloned(),
    })
}

fn prepare_chat_bootstrap_with<E: CommandExecutor>(executor: &E) -> Result<GatewayChatBootstrap, ClawError> {
    let home = hermes_home(executor)?;
    let config = get_config_with(executor)?;
    let env_str = hermes_run(executor, &home, "cat \"$HERMES_HOME/.env\" 2>/dev/null || true")?;
    let env = parse_dotenv(&env_str);
    let api_key = env.get("API_SERVER_KEY").cloned().unwrap_or_else(|| "clawnetes-hermes".to_string());

    Ok(GatewayChatBootstrap {
        ws_url: String::new(),
        auth_token: api_key.clone(),
        target_environment: "local".to_string(),
        gateway_port: config.gateway_port,
        tunnel_active: false,
        openclaw_version: "Hermes Agent".to_string(),
        platform: Some("hermes".to_string()),
        chat_transport: Some("hermes-api".to_string()),
        api_base_url: Some(format!("http://{}:{}/v1", config.gateway_bind, config.gateway_port)),
        api_key: Some(api_key),
        supports_runs: Some(true),
        supports_agent_discovery: Some(false),
    })
}

fn start_gateway_with<E: CommandExecutor>(executor: &E) -> Result<String, ClawError> {
    let home = hermes_home(executor)?;
    hermes_run(executor, &home, "hermes gateway start")?;
    Ok("Hermes gateway started.".to_string())
}

fn restart_gateway_with<E: CommandExecutor>(executor: &E) -> Result<String, ClawError> {
    let home = hermes_home(executor)?;
    hermes_run(executor, &home, "hermes gateway restart")?;
    Ok("Hermes gateway restarted.".to_string())
}

pub fn check_prerequisites(remote: Option<&RemoteInfo>) -> Result<PlatformPrereqCheck, String> {
    if let Some(remote_info) = remote {
        let executor = SshExecutor::connect(remote_info).map_err(String::from)?;
        return check_prerequisites_with(&executor).map_err(String::from);
    }

    #[cfg(target_os = "windows")]
    {
        let mut check = check_prerequisites_with(&LocalExecutor).map_err(String::from)?;
        check.wsl2_installed = Some(crate::system::check_wsl2_installed());
        return Ok(check);
    }

    #[cfg(not(target_os = "windows"))]
    {
        check_prerequisites_with(&LocalExecutor).map_err(String::from)
    }
}

pub fn install(remote: Option<&RemoteInfo>) -> Result<String, String> {
    if let Some(remote_info) = remote {
        let executor = SshExecutor::connect(remote_info).map_err(String::from)?;
        return install_with(&executor).map_err(String::from);
    }

    #[cfg(target_os = "windows")]
    {
        crate::system::ensure_wsl2_installed()?;
    }
    install_with(&LocalExecutor).map_err(String::from)
}

pub fn get_version(remote: Option<&RemoteInfo>) -> Result<String, String> {
    if let Some(remote_info) = remote {
        let executor = SshExecutor::connect(remote_info).map_err(String::from)?;
        let home = hermes_home(&executor).map_err(String::from)?;
        return hermes_run(&executor, &home, "hermes --version")
            .or_else(|_| executor.run("hermes --version"))
            .map(|output| output.trim().to_string())
            .map_err(String::from);
    }

    let home = hermes_home(&LocalExecutor).map_err(String::from)?;
    hermes_run(&LocalExecutor, &home, "hermes --version")
        .or_else(|_| LocalExecutor.run("hermes --version"))
        .map(|output| output.trim().to_string())
        .map_err(String::from)
}

pub fn get_config(remote: Option<&RemoteInfo>) -> Result<CurrentConfig, String> {
    if let Some(remote_info) = remote {
        let executor = SshExecutor::connect(remote_info).map_err(String::from)?;
        return get_config_with(&executor).map_err(String::from);
    }
    get_config_with(&LocalExecutor).map_err(String::from)
}

pub fn configure(config: &AgentConfig, remote: Option<&RemoteInfo>) -> Result<String, String> {
    if let Some(remote_info) = remote {
        let executor = SshExecutor::connect(remote_info).map_err(String::from)?;
        return configure_with(&executor, config).map_err(String::from);
    }
    configure_with(&LocalExecutor, config).map_err(String::from)
}

pub fn prepare_chat_bootstrap(remote: Option<&RemoteInfo>) -> Result<GatewayChatBootstrap, String> {
    if let Some(remote_info) = remote {
        let executor = SshExecutor::connect(remote_info).map_err(String::from)?;
        let mut bootstrap = prepare_chat_bootstrap_with(&executor).map_err(String::from)?;
        bootstrap.target_environment = "cloud".to_string();
        bootstrap.tunnel_active = true;
        bootstrap.api_base_url = Some(format!("http://127.0.0.1:{}/v1", bootstrap.gateway_port));
        return Ok(bootstrap);
    }
    prepare_chat_bootstrap_with(&LocalExecutor).map_err(String::from)
}

pub fn start_gateway(remote: Option<&RemoteInfo>) -> Result<String, String> {
    if let Some(remote_info) = remote {
        let executor = SshExecutor::connect(remote_info).map_err(String::from)?;
        return start_gateway_with(&executor).map_err(String::from);
    }
    start_gateway_with(&LocalExecutor).map_err(String::from)
}

pub fn restart_gateway(remote: Option<&RemoteInfo>) -> Result<String, String> {
    if let Some(remote_info) = remote {
        let executor = SshExecutor::connect(remote_info).map_err(String::from)?;
        return restart_gateway_with(&executor).map_err(String::from);
    }
    restart_gateway_with(&LocalExecutor).map_err(String::from)
}

pub fn run_maintenance(action: &str, remote: Option<&RemoteInfo>) -> Result<String, String> {
    let run_local = |cmd: &str| shell_command(cmd);
    if let Some(remote_info) = remote {
        let executor = SshExecutor::connect(remote_info).map_err(String::from)?;
        let home = hermes_home(&executor).map_err(String::from)?;
        let command = match action {
            "repair" => "hermes doctor",
            "audit" => "hermes doctor",
            "update" => "hermes update",
            "uninstall" => "rm -rf \"$HERMES_HOME/hermes-agent\" \"$HERMES_HOME\"",
            other => return Err(format!("Unsupported Hermes maintenance action: {}", other)),
        };
        return hermes_run(&executor, &home, command).map_err(String::from);
    }

    let home = hermes_home(&LocalExecutor).map_err(String::from)?;
    let command = match action {
        "repair" => format!("{}hermes doctor", hermes_prefix(&home)),
        "audit" => format!("{}hermes doctor", hermes_prefix(&home)),
        "update" => format!("{}hermes update", hermes_prefix(&home)),
        "uninstall" => format!("rm -rf {} {}", shell_single_quote(&format!("{}/hermes-agent", home)), shell_single_quote(&home)),
        other => return Err(format!("Unsupported Hermes maintenance action: {}", other)),
    };
    run_local(&command)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeExecutor {
        success_commands: std::collections::HashSet<String>,
        files: HashMap<String, String>,
    }

    impl CommandExecutor for FakeExecutor {
        fn run(&self, cmd: &str) -> Result<String, ClawError> {
            if let Some(contents) = self.files.get(cmd) {
                return Ok(contents.clone());
            }
            if self.success_commands.contains(cmd) {
                return Ok("ok".to_string());
            }
            Err(ClawError::System(format!("missing command: {}", cmd)))
        }

        fn home_dir(&self) -> Result<String, ClawError> {
            Ok("/tmp/test-home".to_string())
        }
    }

    #[test]
    fn parses_dotenv_values() {
        let env = parse_dotenv("OPENAI_API_KEY=sk-test\nAPI_SERVER_KEY=secret\n");
        assert_eq!(env.get("OPENAI_API_KEY").map(String::as_str), Some("sk-test"));
        assert_eq!(env.get("API_SERVER_KEY").map(String::as_str), Some("secret"));
    }

    #[test]
    fn check_prerequisites_detects_commands() {
        let executor = FakeExecutor {
            success_commands: std::collections::HashSet::from([
                "node -v".to_string(),
                "git --version".to_string(),
                "export HERMES_HOME='/tmp/test-home/.hermes'; hermes --version".to_string(),
            ]),
            files: HashMap::new(),
        };

        let result = check_prerequisites_with(&executor).expect("check should succeed");
        assert!(result.node_installed);
        assert!(result.git_installed);
        assert!(result.platform_installed);
    }

    #[test]
    fn get_config_reads_api_server_and_tokens() {
        let yaml_cmd = "export HERMES_HOME='/tmp/test-home/.hermes'; cat \"$HERMES_HOME/config.yaml\" 2>/dev/null || true".to_string();
        let env_cmd = "export HERMES_HOME='/tmp/test-home/.hermes'; cat \"$HERMES_HOME/.env\" 2>/dev/null || true".to_string();
        let executor = FakeExecutor {
            success_commands: std::collections::HashSet::new(),
            files: HashMap::from([
                (yaml_cmd, "model: anthropic/claude-sonnet-4\nplatforms:\n  api_server:\n    extra:\n      port: 9999\n      host: 0.0.0.0\n".to_string()),
                (env_cmd, "ANTHROPIC_API_KEY=sk-ant\nTELEGRAM_BOT_TOKEN=bot\nAPI_SERVER_KEY=secret\n".to_string()),
            ]),
        };

        let current = get_config_with(&executor).expect("config should load");
        assert_eq!(current.platform, "hermes");
        assert_eq!(current.model, "anthropic/claude-sonnet-4");
        assert_eq!(current.gateway_port, 9999);
        assert_eq!(current.telegram_token, "bot");
        assert_eq!(current.api_key, "sk-ant");
    }
}
