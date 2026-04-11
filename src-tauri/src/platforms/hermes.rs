use std::collections::HashMap;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use serde_yaml::{Mapping, Value as YamlValue};

use crate::error::ClawError;
use crate::executor::{CommandExecutor, LocalExecutor, SshExecutor};
use crate::system::{shell_command, shell_single_quote};
use crate::types::{AgentConfig, CurrentConfig, GatewayChatBootstrap, RemoteInfo};

use super::types::PlatformPrereqCheck;

const DEFAULT_API_PORT: u16 = 8642;
const DEFAULT_API_HOST: &str = "127.0.0.1";
const REMOTE_HERMES_SSH_TIMEOUT: Duration = Duration::from_secs(15);

fn resolve_client_api_host(bind: &str) -> &str {
    match bind.trim() {
        "" | "loopback" | "localhost" | "0.0.0.0" | "::" | "::1" => DEFAULT_API_HOST,
        other => other,
    }
}

fn normalize_provider_for_hermes(provider: &str) -> &str {
    match provider {
        "google" | "google-vertex" => "gemini",
        other => other,
    }
}

fn normalize_provider_for_ui(provider: &str) -> &str {
    match provider {
        "gemini" => "google",
        other => other,
    }
}

fn provider_api_key_env(provider: &str) -> Option<&'static str> {
    match normalize_provider_for_hermes(provider) {
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "openai" | "openai-codex" => Some("OPENAI_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        "gemini" => Some("GEMINI_API_KEY"),
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
            Some((
                key.trim().to_string(),
                value.trim().trim_matches('"').to_string(),
            ))
        })
        .collect()
}

fn yaml_string(value: Option<&YamlValue>) -> Option<String> {
    value
        .and_then(|entry| entry.as_str())
        .map(ToString::to_string)
}

fn yaml_bool(value: Option<&YamlValue>) -> Option<bool> {
    value.and_then(|entry| entry.as_bool())
}

fn yaml_u64(value: Option<&YamlValue>) -> Option<u64> {
    value.and_then(|entry| entry.as_u64())
}

fn env_bool(value: Option<&String>) -> Option<bool> {
    value.map(|entry| matches!(entry.trim(), "1" | "true" | "TRUE" | "yes" | "on"))
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

fn hermes_run<E: CommandExecutor>(
    executor: &E,
    home: &str,
    cmd: &str,
) -> Result<String, ClawError> {
    executor.run(&format!("{}{}", hermes_prefix(home), cmd))
}

fn run_timeout_task<T, F>(timeout: Duration, context: &str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let context = context.to_string();
    let (sender, receiver) = mpsc::channel();

    thread::spawn(move || {
        let _ = sender.send(task());
    });

    match receiver.recv_timeout(timeout) {
        Ok(result) => result.map_err(|error| format!("{}: {}", context, error)),
        Err(RecvTimeoutError::Timeout) => Err(format!(
            "Timed out after {}s while {}.",
            timeout.as_secs(),
            context
        )),
        Err(RecvTimeoutError::Disconnected) => {
            Err(format!("{} failed before returning a result.", context))
        }
    }
}

fn get_remote_config_with_timeout(remote: &RemoteInfo) -> Result<CurrentConfig, String> {
    let remote = remote.clone();
    run_timeout_task(
        REMOTE_HERMES_SSH_TIMEOUT,
        "reading remote Hermes config over SSH",
        move || {
            let executor = SshExecutor::connect(&remote).map_err(String::from)?;
            get_config_with(&executor).map_err(String::from)
        },
    )
}

fn prepare_remote_chat_bootstrap_with_timeout(
    remote: &RemoteInfo,
) -> Result<GatewayChatBootstrap, String> {
    let remote = remote.clone();
    run_timeout_task(
        REMOTE_HERMES_SSH_TIMEOUT,
        "preparing remote Hermes API bootstrap over SSH",
        move || {
            let executor = SshExecutor::connect(&remote).map_err(String::from)?;
            prepare_chat_bootstrap_with(&executor).map_err(String::from)
        },
    )
}

fn apply_remote_chat_tunnel(mut bootstrap: GatewayChatBootstrap) -> GatewayChatBootstrap {
    bootstrap.target_environment = "cloud".to_string();
    bootstrap.tunnel_active = true;
    bootstrap.api_base_url = Some(format!(
        "http://127.0.0.1:{}/v1",
        crate::ssh::REMOTE_TUNNEL_LOCAL_PORT
    ));
    bootstrap
}

fn hermes_maintenance_command(action: &str) -> Result<&'static str, String> {
    match action {
        "repair" => Ok("hermes doctor"),
        "audit" => Ok("hermes doctor"),
        "update" => Ok("hermes update"),
        "uninstall" => Ok(HERMES_UNINSTALL_COMMAND),
        other => Err(format!("Unsupported Hermes maintenance action: {}", other)),
    }
}

const HERMES_GATEWAY_BACKGROUND_COMMAND: &str = "(mkdir -p \"$HERMES_HOME/logs\"; hermes gateway stop >/dev/null 2>&1 || true; nohup hermes gateway > \"$HERMES_HOME/logs/gateway.log\" 2>&1 < /dev/null & disown) >/dev/null 2>&1";

const HERMES_INSTALL_COMMAND: &str = "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup --dir \"$HERMES_HOME/hermes-agent\"";

const HERMES_CORS_PATCH_COMMAND: &str = r#"python3 <<'__CLAWNETES_CORS_PATCH__'
import os

home = os.environ.get("HERMES_HOME", "")
if not home:
    import sys
    sys.exit(0)

file_path = os.path.join(home, "hermes-agent", "gateway", "platforms", "api_server.py")
if not os.path.exists(file_path):
    import sys
    sys.exit(0)

try:
    with open(file_path, "r") as f:
        content = f.read()

    target = "        response = web.StreamResponse(\n            status=200,\n            headers={\n                \"Content-Type\": \"text/event-stream\",\n                \"Cache-Control\": \"no-cache\",\n                \"X-Accel-Buffering\": \"no\",\n            },\n        )"
    
    replacement = "        cors = self._cors_headers_for_origin(request.headers.get(\"Origin\")) if request.headers.get(\"Origin\") else {}\n        headers = {\n            \"Content-Type\": \"text/event-stream\",\n            \"Cache-Control\": \"no-cache\",\n            \"X-Accel-Buffering\": \"no\",\n            **cors\n        }\n        response = web.StreamResponse(status=200, headers=headers)"

    if target in content:
        content = content.replace(target, replacement)
        with open(file_path, "w") as f:
            f.write(content)
except Exception:
    pass
__CLAWNETES_CORS_PATCH__"#;

const HERMES_UNINSTALL_COMMAND: &str = r#"hermes gateway stop >/dev/null 2>&1 || true; python3 <<'__CLAWNETES_HERMES_UNINSTALL__'
import os
import pty
import select
import sys

pid, fd = pty.fork()
if pid == 0:
    os.execlp("hermes", "hermes", "uninstall", "--full", "--yes")

buffer = b""
sent_option = False
sent_confirm = False

while True:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if fd in ready:
        try:
            data = os.read(fd, 4096)
        except OSError:
            data = b""
        if not data:
            _, status = os.waitpid(pid, 0)
            sys.exit(os.waitstatus_to_exitcode(status))
        os.write(1, data)
        buffer = (buffer + data)[-8192:]
        lowered = buffer.lower()
        if not sent_option and b"select option" in lowered:
            os.write(fd, b"2\n")
            sent_option = True
        if not sent_confirm and b"type" in lowered and b"yes" in lowered:
            os.write(fd, b"yes\n")
            sent_confirm = True

    finished, status = os.waitpid(pid, os.WNOHANG)
    if finished:
        sys.exit(os.waitstatus_to_exitcode(status))

sys.exit(0)
__CLAWNETES_HERMES_UNINSTALL__"#;

fn write_hermes_file<E: CommandExecutor>(
    executor: &E,
    home: &str,
    relative_path: &str,
    contents: &str,
) -> Result<(), ClawError> {
    hermes_run(
        executor,
        home,
        &format!(
            "cat > \"$HERMES_HOME/{}\" <<'__CLAWNETES_EOF__'\n{}\n__CLAWNETES_EOF__",
            relative_path, contents
        ),
    )?;
    Ok(())
}

fn parse_yaml_mapping(contents: &str) -> Mapping {
    serde_yaml::from_str::<YamlValue>(contents)
        .ok()
        .and_then(|value| value.as_mapping().cloned())
        .unwrap_or_default()
}

fn validate_raw_yaml(contents: &str) -> Result<(), ClawError> {
    serde_yaml::from_str::<YamlValue>(contents)
        .map(|_| ())
        .map_err(|error| ClawError::System(format!("Invalid Hermes raw config YAML: {}", error)))
}

fn set_yaml_path(mapping: &mut Mapping, path: &[&str], value: YamlValue) {
    if path.is_empty() {
        return;
    }

    if path.len() == 1 {
        mapping.insert(YamlValue::String(path[0].to_string()), value);
        return;
    }

    let key = YamlValue::String(path[0].to_string());
    let entry = mapping
        .entry(key)
        .or_insert_with(|| YamlValue::Mapping(Mapping::new()));
    if !matches!(entry, YamlValue::Mapping(_)) {
        *entry = YamlValue::Mapping(Mapping::new());
    }
    if let YamlValue::Mapping(child) = entry {
        set_yaml_path(child, &path[1..], value);
    }
}

fn remove_yaml_path(mapping: &mut Mapping, path: &[&str]) {
    if path.is_empty() {
        return;
    }

    if path.len() == 1 {
        mapping.remove(YamlValue::String(path[0].to_string()));
        return;
    }

    let key = YamlValue::String(path[0].to_string());
    let mut remove_parent = false;
    if let Some(YamlValue::Mapping(child)) = mapping.get_mut(&key) {
        remove_yaml_path(child, &path[1..]);
        remove_parent = child.is_empty();
    }
    if remove_parent {
        mapping.remove(&key);
    }
}

fn yaml_to_string(root: &Mapping) -> Result<String, ClawError> {
    serde_yaml::to_string(&YamlValue::Mapping(root.clone())).map_err(|error| {
        ClawError::System(format!("Failed to serialize Hermes config.yaml: {}", error))
    })
}

fn update_env_contents(existing: &str, updates: &[(&str, String)]) -> String {
    let mut remaining: HashMap<String, String> = updates
        .iter()
        .map(|(key, value)| ((*key).to_string(), value.clone()))
        .collect();
    let mut lines = Vec::new();

    for line in existing.lines() {
        if let Some((raw_key, _)) = line.split_once('=') {
            let key = raw_key.trim();
            if let Some(value) = remaining.remove(key) {
                lines.push(format!("{}={}", key, value));
                continue;
            }
        }
        lines.push(line.to_string());
    }

    let mut appended = remaining.into_iter().collect::<Vec<_>>();
    appended.sort_by(|a, b| a.0.cmp(&b.0));
    if !appended.is_empty()
        && !lines.is_empty()
        && !lines.last().map(|line| line.is_empty()).unwrap_or(false)
    {
        lines.push(String::new());
    }
    for (key, value) in appended {
        lines.push(format!("{}={}", key, value));
    }

    let mut rendered = lines.join("\n");
    if !rendered.is_empty() && !rendered.ends_with('\n') {
        rendered.push('\n');
    }
    rendered
}

fn build_structured_hermes_files(
    config: &AgentConfig,
    existing_yaml: &str,
    existing_env: &str,
) -> Result<(String, String), ClawError> {
    let mut root = parse_yaml_mapping(existing_yaml);
    let parts: Vec<&str> = config.model.splitn(2, '/').collect();
    let (raw_provider, default_model) = if parts.len() == 2 {
        (parts[0], parts[1])
    } else {
        ("anthropic", "claude-opus-4-6")
    };
    let provider = normalize_provider_for_hermes(raw_provider);

    set_yaml_path(
        &mut root,
        &["model", "provider"],
        YamlValue::String(provider.to_string()),
    );
    set_yaml_path(
        &mut root,
        &["model", "default"],
        YamlValue::String(default_model.to_string()),
    );
    if let Some(base_url) = config
        .hermes_model_base_url
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        set_yaml_path(
            &mut root,
            &["model", "base_url"],
            YamlValue::String(base_url.clone()),
        );
    } else {
        remove_yaml_path(&mut root, &["model", "base_url"]);
    }

    if let Some(backend) = config
        .hermes_terminal_backend
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        set_yaml_path(
            &mut root,
            &["terminal", "backend"],
            YamlValue::String(backend.clone()),
        );
    }
    if let Some(turns) = config.hermes_max_turns {
        set_yaml_path(
            &mut root,
            &["agent", "max_turns"],
            YamlValue::Number(turns.into()),
        );
    }
    if let Some(effort) = config
        .hermes_reasoning_effort
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        set_yaml_path(
            &mut root,
            &["agent", "reasoning_effort"],
            YamlValue::String(effort.clone()),
        );
    }
    if let Some(personality) = config
        .hermes_personality
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        set_yaml_path(
            &mut root,
            &["display", "personality"],
            YamlValue::String(personality.clone()),
        );
    }
    if let Some(enabled) = config.hermes_memory_enabled {
        set_yaml_path(
            &mut root,
            &["memory", "memory_enabled"],
            YamlValue::Bool(enabled),
        );
    }
    if let Some(verbose) = config.hermes_verbose {
        set_yaml_path(&mut root, &["agent", "verbose"], YamlValue::Bool(verbose));
    }
    if let Some(routing) = config.hermes_smart_routing {
        set_yaml_path(
            &mut root,
            &["smart_model_routing", "enabled"],
            YamlValue::Bool(routing),
        );
    }
    if let Some(policy) = config
        .whatsapp_dm_policy
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        set_yaml_path(
            &mut root,
            &["whatsapp", "unauthorized_dm_behavior"],
            YamlValue::String(policy.clone()),
        );
    } else {
        remove_yaml_path(&mut root, &["whatsapp", "unauthorized_dm_behavior"]);
    }

    let model_provider_for_auth = normalize_provider_for_ui(provider);
    let provider_token = config
        .provider_auths
        .as_ref()
        .and_then(|auths| {
            auths
                .get(model_provider_for_auth)
                .or_else(|| auths.get(&config.provider))
        })
        .map(|auth| auth.token.clone())
        .filter(|token| !token.trim().is_empty())
        .unwrap_or_else(|| config.api_key.clone());

    let mut env_updates = vec![
        (
            "API_SERVER_ENABLED",
            config.hermes_api_server_enabled.unwrap_or(true).to_string(),
        ),
        (
            "API_SERVER_CORS_ORIGINS",
            config
                .hermes_api_server_cors_origins
                .clone()
                .unwrap_or_else(|| "*".to_string()),
        ),
        (
            "API_SERVER_PORT",
            config.gateway_port.unwrap_or(DEFAULT_API_PORT).to_string(),
        ),
        ("API_SERVER_HOST", DEFAULT_API_HOST.to_string()),
        (
            "API_SERVER_KEY",
            config.hermes_api_server_key.clone().unwrap_or_default(),
        ),
        (
            "TELEGRAM_BOT_TOKEN",
            config.telegram_token.clone().unwrap_or_default(),
        ),
        (
            "WHATSAPP_ENABLED",
            if config.whatsapp_enabled.unwrap_or(false) {
                "true".to_string()
            } else {
                "false".to_string()
            },
        ),
        (
            "WHATSAPP_ALLOWED_USERS",
            config.whatsapp_phone_number.clone().unwrap_or_default(),
        ),
    ];

    if let Some(api_key_env) = provider_api_key_env(provider) {
        env_updates.push((api_key_env, provider_token));
    }

    Ok((
        yaml_to_string(&root)?,
        update_env_contents(existing_env, &env_updates),
    ))
}

fn check_prerequisites_with<E: CommandExecutor>(
    executor: &E,
) -> Result<PlatformPrereqCheck, ClawError> {
    let node_installed = executor.run("command -v node").is_ok() || executor.run("node -v").is_ok();
    let git_installed =
        executor.run("command -v git").is_ok() || executor.run("git --version").is_ok();
    let home = hermes_home(executor)?;
    let platform_installed = hermes_run(executor, &home, "hermes --version").is_ok()
        || executor.run("command -v hermes").is_ok()
        || executor.run("hermes --version").is_ok();

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
    hermes_run(executor, &home, HERMES_INSTALL_COMMAND)?;
    hermes_run(executor, &home, "hermes --version")?;
    Ok("Hermes Agent installed successfully.".to_string())
}

fn configure_with<E: CommandExecutor>(
    executor: &E,
    config: &AgentConfig,
) -> Result<String, ClawError> {
    let home = hermes_home(executor)?;
    hermes_run(
        executor,
        &home,
        "mkdir -p \"$HERMES_HOME\" \"$HERMES_HOME/logs\" \"$HERMES_HOME/sessions\"",
    )?;

    if config.hermes_apply_raw_files.unwrap_or(false) {
        if let Some(raw_yaml) = &config.hermes_raw_config_yaml {
            validate_raw_yaml(raw_yaml)?;
            write_hermes_file(executor, &home, "config.yaml", raw_yaml)?;
        }
        if let Some(raw_env) = &config.hermes_raw_env {
            write_hermes_file(executor, &home, ".env", raw_env)?;
        }
        return Ok("Hermes Agent configured successfully.".to_string());
    }

    let existing_yaml = hermes_run(
        executor,
        &home,
        "cat \"$HERMES_HOME/config.yaml\" 2>/dev/null || true",
    )?;
    let existing_env = hermes_run(
        executor,
        &home,
        "cat \"$HERMES_HOME/.env\" 2>/dev/null || true",
    )?;
    let (rendered_yaml, rendered_env) =
        build_structured_hermes_files(config, &existing_yaml, &existing_env)?;
    write_hermes_file(executor, &home, "config.yaml", &rendered_yaml)?;
    write_hermes_file(executor, &home, ".env", &rendered_env)?;

    Ok("Hermes Agent configured successfully.".to_string())
}

fn get_config_with<E: CommandExecutor>(executor: &E) -> Result<CurrentConfig, ClawError> {
    let home = hermes_home(executor)?;
    let yaml_str = hermes_run(
        executor,
        &home,
        "cat \"$HERMES_HOME/config.yaml\" 2>/dev/null || true",
    )?;
    let env_str = hermes_run(
        executor,
        &home,
        "cat \"$HERMES_HOME/.env\" 2>/dev/null || true",
    )?;
    let env = parse_dotenv(&env_str);
    let yaml =
        serde_yaml::from_str::<YamlValue>(&yaml_str).unwrap_or(YamlValue::Mapping(Mapping::new()));
    let root = yaml.as_mapping().cloned().unwrap_or_default();

    let platforms = get_mapping(&root, "platforms");
    let whatsapp = get_mapping(&root, "whatsapp");
    let terminal = yaml_string(root.get(YamlValue::String("terminal.backend".to_string())))
        .or_else(|| {
            yaml_string(
                get_mapping(&root, "terminal")
                    .and_then(|m| m.get(YamlValue::String("backend".to_string()))),
            )
        })
        .unwrap_or_else(|| "local".to_string());

    let model_mapping = get_mapping(&root, "model");
    let provider =
        yaml_string(model_mapping.and_then(|m| m.get(YamlValue::String("provider".to_string()))))
            .map(|value| normalize_provider_for_ui(&value).to_string())
            .unwrap_or_else(|| "anthropic".to_string());
    let default_model =
        yaml_string(model_mapping.and_then(|m| m.get(YamlValue::String("default".to_string()))))
            .unwrap_or_else(|| "claude-opus-4-6".to_string());
    let model_base_url =
        yaml_string(model_mapping.and_then(|m| m.get(YamlValue::String("base_url".to_string()))));

    let model = format!("{}/{}", provider, default_model);

    let max_turns = get_mapping(&root, "agent")
        .and_then(|m| yaml_u64(m.get(YamlValue::String("max_turns".to_string()))))
        .map(|v| v as u32);
    let reasoning_effort = yaml_string(
        get_mapping(&root, "agent")
            .and_then(|m| m.get(YamlValue::String("reasoning_effort".to_string()))),
    );
    let personality = yaml_string(
        get_mapping(&root, "display")
            .and_then(|m| m.get(YamlValue::String("personality".to_string()))),
    );
    let memory_enabled = yaml_bool(
        get_mapping(&root, "memory")
            .and_then(|m| m.get(YamlValue::String("memory_enabled".to_string()))),
    );
    let verbose = yaml_bool(
        get_mapping(&root, "agent").and_then(|m| m.get(YamlValue::String("verbose".to_string()))),
    );
    let smart_routing = yaml_bool(
        get_mapping(&root, "smart_model_routing")
            .and_then(|m| m.get(YamlValue::String("enabled".to_string()))),
    );

    let api_key = provider_api_key_env(&provider)
        .and_then(|env_key| env.get(env_key).cloned())
        .unwrap_or_default();

    let gateway_port = env
        .get("API_SERVER_PORT")
        .and_then(|s| s.parse::<u16>().ok())
        .or_else(|| {
            yaml_u64(root.get(YamlValue::String("API_SERVER_PORT".to_string()))).map(|v| v as u16)
        })
        .unwrap_or(DEFAULT_API_PORT as u16);

    let gateway_bind = env
        .get("API_SERVER_HOST")
        .cloned()
        .or_else(|| yaml_string(root.get(YamlValue::String("API_SERVER_HOST".to_string()))))
        .unwrap_or_else(|| DEFAULT_API_HOST.to_string());
    let api_server_enabled = env_bool(env.get("API_SERVER_ENABLED"))
        .or_else(|| yaml_bool(root.get(YamlValue::String("API_SERVER_ENABLED".to_string()))))
        .unwrap_or(true);
    let api_server_key = env.get("API_SERVER_KEY").cloned();
    let api_server_cors_origins = env.get("API_SERVER_CORS_ORIGINS").cloned().or_else(|| {
        yaml_string(root.get(YamlValue::String("API_SERVER_CORS_ORIGINS".to_string())))
    });

    let whatsapp_enabled = env
        .get("WHATSAPP_ENABLED")
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes"))
        .or_else(|| {
            yaml_bool(
                platforms
                    .and_then(|m| get_mapping(m, "whatsapp"))
                    .and_then(|m| m.get(YamlValue::String("enabled".to_string()))),
            )
        })
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
        local_base_url: None,
        thinking_level: None,
        whatsapp_enabled: Some(whatsapp_enabled),
        whatsapp_dm_policy: yaml_string(
            whatsapp.and_then(|m| m.get(YamlValue::String("unauthorized_dm_behavior".to_string()))),
        ),
        whatsapp_phone_number: env.get("WHATSAPP_ALLOWED_USERS").cloned(),
        hermes_max_turns: max_turns,
        hermes_reasoning_effort: reasoning_effort,
        hermes_personality: personality,
        hermes_terminal_backend: Some(terminal.clone()),
        hermes_memory_enabled: memory_enabled,
        hermes_verbose: verbose,
        hermes_smart_routing: smart_routing,
        hermes_model_base_url: model_base_url,
        hermes_api_server_enabled: Some(api_server_enabled),
        hermes_api_server_key: api_server_key,
        hermes_api_server_cors_origins: api_server_cors_origins,
        hermes_raw_config_yaml: Some(yaml_str),
        hermes_raw_env: Some(env_str),
    })
}

use std::net::TcpStream;

fn prepare_chat_bootstrap_with<E: CommandExecutor>(
    executor: &E,
) -> Result<GatewayChatBootstrap, ClawError> {
    let home = hermes_home(executor)?;
    let config = get_config_with(executor)?;
    let env_str = hermes_run(
        executor,
        &home,
        "cat \"$HERMES_HOME/.env\" 2>/dev/null || true",
    )?;
    let env = parse_dotenv(&env_str);
    let api_key = env
        .get("API_SERVER_KEY")
        .cloned()
        .unwrap_or_else(|| "clawnetes-hermes".to_string());

    // Automatically start the Hermes API service if it's not listening on the target environment.
    let is_running = executor
        .run(&format!("curl -s -m 2 http://127.0.0.1:{}/health", config.gateway_port))
        .map(|out| out.contains("\"status\"") || out.contains("ok"))
        .unwrap_or(false);

    if !is_running {
        let _ = start_gateway_with(executor);
        // Give it a moment to boot
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    Ok(GatewayChatBootstrap {
        ws_url: String::new(),
        auth_token: api_key.clone(),
        target_environment: "local".to_string(),
        gateway_port: config.gateway_port,
        tunnel_active: false,
        openclaw_version: "Hermes Agent".to_string(),
        platform: Some("hermes".to_string()),
        chat_transport: Some("hermes-api".to_string()),
        api_base_url: Some(format!(
            "http://{}:{}/v1",
            resolve_client_api_host(&config.gateway_bind),
            config.gateway_port
        )),
        api_key: Some(api_key),
        supports_runs: Some(true),
        supports_agent_discovery: Some(false),
    })
}

fn start_gateway_with<E: CommandExecutor>(executor: &E) -> Result<String, ClawError> {
    let home = hermes_home(executor)?;
    let _ = hermes_run(executor, &home, HERMES_CORS_PATCH_COMMAND);
    hermes_run(executor, &home, HERMES_GATEWAY_BACKGROUND_COMMAND)?;
    Ok("Hermes gateway started.".to_string())
}

fn restart_gateway_with<E: CommandExecutor>(executor: &E) -> Result<String, ClawError> {
    let home = hermes_home(executor)?;
    let _ = hermes_run(executor, &home, HERMES_CORS_PATCH_COMMAND);
    hermes_run(executor, &home, HERMES_GATEWAY_BACKGROUND_COMMAND)?;
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
        return get_remote_config_with_timeout(remote_info);
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
        let bootstrap = prepare_remote_chat_bootstrap_with_timeout(remote_info)?;
        let remote_gateway_port = bootstrap.gateway_port;
        crate::gateway::ensure_remote_gateway_tunnel(remote_info, remote_gateway_port)?;

        if let Err(err) = crate::gateway::verify_tunnel_connectivity(
            remote_info,
            remote_gateway_port,
            Some(crate::platforms::types::AgentPlatform::Hermes),
        ) {
            eprintln!("Warning: Failed to verify Hermes tunnel connectivity: {}", err);
        }

        return Ok(apply_remote_chat_tunnel(bootstrap));
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
        let command = hermes_maintenance_command(action)?;
        return hermes_run(&executor, &home, command).map_err(String::from);
    }

    let home = hermes_home(&LocalExecutor).map_err(String::from)?;
    let command = format!(
        "{}{}",
        hermes_prefix(&home),
        hermes_maintenance_command(action)?
    );
    run_local(&command)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_agent_config() -> AgentConfig {
        AgentConfig {
            platform: Some("hermes".to_string()),
            provider: "google".to_string(),
            api_key: "gemini-secret".to_string(),
            auth_method: Some("token".to_string()),
            model: "google/gemini-3.1-pro-preview".to_string(),
            user_name: String::new(),
            agent_name: "Hermes Agent".to_string(),
            agent_vibe: None,
            telegram_token: Some("bot-token".to_string()),
            gateway_port: Some(DEFAULT_API_PORT),
            gateway_bind: Some(DEFAULT_API_HOST.to_string()),
            gateway_auth_mode: Some("token".to_string()),
            tailscale_mode: Some("off".to_string()),
            node_manager: Some("pip".to_string()),
            skills: None,
            service_keys: None,
            provider_auths: None,
            sandbox_mode: None,
            tools_mode: None,
            tools_profile: None,
            allowed_tools: None,
            denied_tools: None,
            fallback_models: None,
            heartbeat_mode: None,
            idle_timeout_ms: None,
            identity_md: None,
            user_md: None,
            soul_md: None,
            agents: None,
            preserve_state: None,
            agent_type: None,
            tools_md: None,
            agents_md: None,
            heartbeat_md: None,
            memory_md: None,
            memory_enabled: None,
            cron_jobs: None,
            local_base_url: None,
            thinking_level: None,
            whatsapp_enabled: Some(false),
            whatsapp_dm_policy: None,
            whatsapp_phone_number: None,
            hermes_max_turns: Some(60),
            hermes_reasoning_effort: Some("medium".to_string()),
            hermes_personality: Some("helpful".to_string()),
            hermes_terminal_backend: Some("local".to_string()),
            hermes_memory_enabled: Some(true),
            hermes_verbose: Some(false),
            hermes_smart_routing: Some(false),
            hermes_model_base_url: None,
            hermes_api_server_enabled: Some(true),
            hermes_api_server_key: Some(String::new()),
            hermes_api_server_cors_origins: Some("*".to_string()),
            hermes_raw_config_yaml: None,
            hermes_raw_env: None,
            hermes_apply_raw_files: Some(false),
        }
    }

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
        assert_eq!(
            env.get("OPENAI_API_KEY").map(String::as_str),
            Some("sk-test")
        );
        assert_eq!(
            env.get("API_SERVER_KEY").map(String::as_str),
            Some("secret")
        );
    }

    #[test]
    fn rejects_invalid_raw_yaml_before_writing() {
        let error = validate_raw_yaml("model:\n  provider: anthropic\nbroken")
            .expect_err("invalid yaml should be rejected");
        assert!(error.to_string().contains("Invalid Hermes raw config YAML"));
    }

    #[test]
    fn resolves_loopback_bind_values_to_localhost_for_clients() {
        assert_eq!(resolve_client_api_host("loopback"), "127.0.0.1");
        assert_eq!(resolve_client_api_host("0.0.0.0"), "127.0.0.1");
        assert_eq!(resolve_client_api_host("::"), "127.0.0.1");
        assert_eq!(resolve_client_api_host("10.0.0.8"), "10.0.0.8");
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
    fn maintenance_uninstall_uses_hermes_cli_full_uninstall() {
        assert_eq!(
            hermes_maintenance_command("uninstall").expect("uninstall should be supported"),
            HERMES_UNINSTALL_COMMAND
        );
        assert!(HERMES_UNINSTALL_COMMAND.contains("\"hermes\", \"hermes\", \"uninstall\""));
        assert!(HERMES_UNINSTALL_COMMAND.contains("--full"));
        assert!(HERMES_UNINSTALL_COMMAND.contains("--yes"));
        assert!(HERMES_UNINSTALL_COMMAND.contains("pty.fork()"));
    }

    #[test]
    fn install_command_skips_interactive_hermes_setup() {
        assert!(HERMES_INSTALL_COMMAND.contains("bash -s --"));
        assert!(HERMES_INSTALL_COMMAND.contains("--skip-setup"));
        assert!(HERMES_INSTALL_COMMAND.contains("--dir \"$HERMES_HOME/hermes-agent\""));
        assert!(!HERMES_INSTALL_COMMAND.ends_with("| bash"));
    }

    #[test]
    fn maintenance_commands_use_hermes_cli_actions() {
        assert_eq!(
            hermes_maintenance_command("repair").unwrap(),
            "hermes doctor"
        );
        assert_eq!(
            hermes_maintenance_command("audit").unwrap(),
            "hermes doctor"
        );
        assert_eq!(
            hermes_maintenance_command("update").unwrap(),
            "hermes update"
        );
        assert!(hermes_maintenance_command("destroy")
            .expect_err("unsupported action should fail")
            .contains("Unsupported Hermes maintenance action"));
    }

    #[test]
    fn gateway_service_command_starts_hermes_in_background() {
        assert!(HERMES_GATEWAY_BACKGROUND_COMMAND.contains("nohup hermes gateway"));
        assert!(HERMES_GATEWAY_BACKGROUND_COMMAND.contains("&"));
        assert!(HERMES_GATEWAY_BACKGROUND_COMMAND.contains("$HERMES_HOME/logs/gateway.log"));
        assert!(!HERMES_GATEWAY_BACKGROUND_COMMAND.contains("hermes gateway restart"));
    }

    #[test]
    fn get_config_reads_api_server_and_tokens() {
        let yaml_cmd = "export HERMES_HOME='/tmp/test-home/.hermes'; cat \"$HERMES_HOME/config.yaml\" 2>/dev/null || true".to_string();
        let env_cmd = "export HERMES_HOME='/tmp/test-home/.hermes'; cat \"$HERMES_HOME/.env\" 2>/dev/null || true".to_string();
        let executor = FakeExecutor {
            success_commands: std::collections::HashSet::new(),
            files: HashMap::from([
                (yaml_cmd, "model:\n  provider: anthropic\n  default: claude-sonnet-4\nAPI_SERVER_PORT: 9999\nAPI_SERVER_HOST: 0.0.0.0\n".to_string()),
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

    #[test]
    fn timeout_task_returns_clear_timeout_error() {
        let error =
            run_timeout_task(Duration::from_millis(10), "reading remote Hermes config over SSH", || {
                std::thread::sleep(Duration::from_millis(40));
                Ok::<_, String>(())
            })
            .expect_err("timeout should fail");

        assert!(error.contains("Timed out after 0s while reading remote Hermes config over SSH."));
    }

    #[test]
    fn apply_remote_chat_tunnel_rewrites_bootstrap_for_local_tunnel() {
        let bootstrap = GatewayChatBootstrap {
            ws_url: String::new(),
            auth_token: "secret".to_string(),
            target_environment: "local".to_string(),
            gateway_port: DEFAULT_API_PORT,
            tunnel_active: false,
            openclaw_version: "Hermes Agent".to_string(),
            platform: Some("hermes".to_string()),
            chat_transport: Some("hermes-api".to_string()),
            api_base_url: Some("http://127.0.0.1:8642/v1".to_string()),
            api_key: Some("secret".to_string()),
            supports_runs: Some(true),
            supports_agent_discovery: Some(false),
        };

        let remote_bootstrap = apply_remote_chat_tunnel(bootstrap);

        assert_eq!(remote_bootstrap.target_environment, "cloud");
        assert!(remote_bootstrap.tunnel_active);
        assert_eq!(
            remote_bootstrap.api_base_url.as_deref(),
            Some("http://127.0.0.1:28789/v1")
        );
    }

    #[test]
    fn structured_write_routes_hermes_keys_to_yaml_and_env() {
        let config = sample_agent_config();
        let existing_yaml = "platforms:\n  telegram:\n    enabled: true\n";
        let existing_env = "OPENROUTER_API_KEY=keep-me\n";

        let (rendered_yaml, rendered_env) =
            build_structured_hermes_files(&config, existing_yaml, existing_env)
                .expect("structured write should succeed");

        let parsed_yaml =
            serde_yaml::from_str::<YamlValue>(&rendered_yaml).expect("yaml should stay valid");
        let root = parsed_yaml
            .as_mapping()
            .expect("yaml root should be a mapping");
        let model = get_mapping(root, "model").expect("model mapping should exist");
        assert_eq!(
            yaml_string(model.get(YamlValue::String("provider".to_string()))).as_deref(),
            Some("gemini")
        );
        assert_eq!(
            yaml_string(model.get(YamlValue::String("default".to_string()))).as_deref(),
            Some("gemini-3.1-pro-preview")
        );

        let env = parse_dotenv(&rendered_env);
        assert_eq!(
            env.get("GEMINI_API_KEY").map(String::as_str),
            Some("gemini-secret")
        );
        assert_eq!(
            env.get("TELEGRAM_BOT_TOKEN").map(String::as_str),
            Some("bot-token")
        );
        assert_eq!(
            env.get("API_SERVER_ENABLED").map(String::as_str),
            Some("true")
        );
        assert_eq!(
            env.get("OPENROUTER_API_KEY").map(String::as_str),
            Some("keep-me")
        );
        assert!(!rendered_yaml.contains("GEMINI_API_KEY"));
        assert!(!rendered_yaml.contains("API_SERVER_ENABLED"));
    }

    #[test]
    fn structured_write_prefers_model_provider_auth_when_top_level_provider_is_stale() {
        let mut config = sample_agent_config();
        config.provider = "anthropic".to_string();
        config.api_key = "fallback-secret".to_string();
        config.provider_auths = Some(HashMap::from([(
            "google".to_string(),
            crate::types::ProviderAuthData {
                auth_method: "token".to_string(),
                token: "gemini-secret".to_string(),
                profile_key: None,
                profile: None,
                oauth_provider_id: None,
            },
        )]));

        let (_, rendered_env) = build_structured_hermes_files(&config, "", "")
            .expect("structured write should succeed");

        let env = parse_dotenv(&rendered_env);
        assert_eq!(
            env.get("GEMINI_API_KEY").map(String::as_str),
            Some("gemini-secret")
        );
    }

    #[test]
    fn get_config_maps_gemini_provider_back_to_ui_google() {
        let yaml_cmd = "export HERMES_HOME='/tmp/test-home/.hermes'; cat \"$HERMES_HOME/config.yaml\" 2>/dev/null || true".to_string();
        let env_cmd = "export HERMES_HOME='/tmp/test-home/.hermes'; cat \"$HERMES_HOME/.env\" 2>/dev/null || true".to_string();
        let executor = FakeExecutor {
            success_commands: std::collections::HashSet::new(),
            files: HashMap::from([
                (
                    yaml_cmd,
                    "model:\n  provider: gemini\n  default: gemini-3.1-pro-preview\n".to_string(),
                ),
                (env_cmd, "GEMINI_API_KEY=gemini-secret\n".to_string()),
            ]),
        };

        let current = get_config_with(&executor).expect("config should load");
        assert_eq!(current.provider, "google");
        assert_eq!(current.model, "google/gemini-3.1-pro-preview");
        assert_eq!(current.api_key, "gemini-secret");
    }
}
