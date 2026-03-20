use std::net::TcpStream;
use std::time::Duration;
use tokio::time::sleep;

use crate::ssh::{connect_ssh, execute_ssh, get_env_prefix};
use crate::system::shell_command;
use crate::types::{GatewayChatBootstrap, RemoteInfo};

pub fn parse_gateway_token_cli_output(output: &str) -> Option<String> {
    let token = output.trim().trim_matches('"').to_string();
    if token.is_empty()
        || token == "null"
        || token == "undefined"
        || token == "__OPENCLAW_REDACTED__"
    {
        None
    } else {
        Some(token)
    }
}

pub fn parse_dashboard_url_cli_output(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("Dashboard URL: ")
            .map(|url| url.trim().to_string())
            .filter(|url| !url.is_empty())
    })
}

pub fn extract_gateway_token_from_config(config_str: &str, context: &str) -> Result<String, String> {
    let json: serde_json::Value = serde_json::from_str(config_str).map_err(|e| e.to_string())?;
    json.get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(|token| token.to_string())
        .ok_or_else(|| format!("Could not find gateway token in {}", context))
}

pub fn get_remote_gateway_token(remote: &RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(remote)?;
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

pub fn get_local_gateway_token() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::system::{wsl_home_dir, wsl_read_file, wsl_root_command};

        if let Some(token) = wsl_root_command("openclaw config get gateway.auth.token")
            .ok()
            .and_then(|output| parse_gateway_token_cli_output(&output))
        {
            return Ok(token);
        }

        let home = wsl_home_dir()?.trim().to_string();
        let config_path = format!("{}/.openclaw/openclaw.json", home);
        let config_str = wsl_read_file(&config_path)?;
        return extract_gateway_token_from_config(&config_str, "config");
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(token) = shell_command("openclaw config get gateway.auth.token")
            .ok()
            .and_then(|output| parse_gateway_token_cli_output(&output))
        {
            return Ok(token);
        }

        let home = dirs::home_dir().ok_or("Could not find home directory")?;
        let config_path = home.join(".openclaw").join("openclaw.json");
        let config_str = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        extract_gateway_token_from_config(&config_str, "config")
    }
}

pub async fn start_gateway() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let home = dirs::home_dir().ok_or("Could not find home directory")?;

    let _ = shell_command("openclaw gateway stop");
    sleep(Duration::from_secs(2)).await;

    #[cfg(target_os = "macos")]
    {
        let plist_path = home.join("Library/LaunchAgents/ai.openclaw.gateway.plist");
        if plist_path.exists() {
            let _ = shell_command(&format!(
                "launchctl bootstrap gui/$(id -u) \"{}\"",
                plist_path.to_string_lossy()
            ));
        }
    }

    let _ = shell_command("openclaw doctor --fix --yes || true");

    let start_output = shell_command("openclaw gateway start")?;

    if start_output.to_lowercase().contains("error")
        || start_output.to_lowercase().contains("failed")
    {
        return Err(format!("Gateway start may have failed: {}", start_output));
    }

    sleep(Duration::from_secs(5)).await;

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
            sleep(Duration::from_secs(3)).await;
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

pub async fn initialize_agent_sessions(agent_ids: &[String]) -> Result<String, String> {
    let mut initialized = 0;
    for id in agent_ids {
        if id == "main" {
            continue;
        }
        let _ = shell_command(&crate::config::build_agent_session_init_command(id));
        sleep(Duration::from_millis(500)).await;
        initialized += 1;
    }
    Ok(format!("Initialized {} agent sessions", initialized))
}

pub async fn generate_pairing_code() -> Result<String, String> {
    sleep(Duration::from_secs(2)).await;
    let _ = shell_command("openclaw gateway status");
    Ok("Ready! Send any message to your Telegram bot to start pairing. The bot will respond automatically with a code.".to_string())
}

pub fn approve_pairing(
    code: &str,
    remote: Option<&RemoteInfo>,
) -> Result<String, String> {
    let cmd_raw = format!("openclaw pairing approve {} --channel telegram", code);

    let output = if let Some(r) = remote {
        let sess = connect_ssh(r)?;
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

pub fn get_dashboard_url(
    is_remote: bool,
    remote: Option<&RemoteInfo>,
) -> Result<String, String> {
    let token = if is_remote && remote.is_some() {
        let r = remote.unwrap();
        let sess = connect_ssh(r)?;
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
            use crate::system::{wsl_home_dir, wsl_read_file, wsl_root_command};
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

            get_local_gateway_token()?
        }
    };

    Ok(format!("http://127.0.0.1:18789/#token={}", token))
}

pub async fn prepare_gateway_chat_connection(
    gateway_port: u16,
    remote: Option<&RemoteInfo>,
) -> Result<GatewayChatBootstrap, String> {
    let ws_url = format!("ws://127.0.0.1:{}", gateway_port);

    if let Some(remote) = remote {
        match crate::ssh::start_ssh_tunnel(remote) {
            Ok(_) => {}
            Err(err) if err.contains("already running") => {}
            Err(err) => return Err(err),
        }

        verify_tunnel_connectivity(remote)?;

        return Ok(GatewayChatBootstrap {
            ws_url,
            auth_token: get_remote_gateway_token(remote)?,
            target_environment: "cloud".to_string(),
            gateway_port,
            tunnel_active: true,
            openclaw_version: crate::maintenance::get_remote_openclaw_version(remote)?,
        });
    }

    if TcpStream::connect(("127.0.0.1", gateway_port)).is_err() {
        start_gateway().await?;
    }

    Ok(GatewayChatBootstrap {
        ws_url,
        auth_token: get_local_gateway_token()?,
        target_environment: "local".to_string(),
        gateway_port,
        tunnel_active: false,
        openclaw_version: crate::maintenance::get_openclaw_version(),
    })
}

pub fn verify_tunnel_connectivity(remote: &RemoteInfo) -> Result<bool, String> {
    let mut last_error = String::from("No attempts made");

    for i in 0..30 {
        if i > 0 {
            std::thread::sleep(Duration::from_secs(2));
        }

        if let Err(e) = TcpStream::connect("127.0.0.1:18789") {
            last_error = format!("Local tunnel port 18789 not reachable: {}", e);
            continue;
        }

        let sess = match connect_ssh(remote) {
            Ok(s) => s,
            Err(e) => {
                last_error = format!("SSH connection failed during verification: {}", e);
                continue;
            }
        };

        let check_process = execute_ssh(&sess, "ps aux | grep openclaw | grep -v grep");
        if let Ok(output) = check_process {
            if output.trim().is_empty() {
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

    Err(format!(
        "Tunnel verification failed after 60s. Last error: {}",
        last_error
    ))
}

pub async fn restart_openclaw_gateway(remote: &RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(remote)?;
    let os_type = execute_ssh(&sess, "uname -s")?.trim().to_string();
    let prefix = get_env_prefix(&os_type);
    let _ = execute_ssh(&sess, &format!("{}openclaw gateway stop", prefix));
    sleep(Duration::from_secs(2)).await;
    execute_ssh(&sess, &format!("{}openclaw gateway start", prefix))?;
    Ok("Gateway restarted successfully.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gateway_token_cli_output_valid() {
        assert_eq!(
            parse_gateway_token_cli_output("\"abc123\"\n"),
            Some("abc123".to_string())
        );
    }

    #[test]
    fn test_parse_gateway_token_cli_output_null() {
        assert_eq!(parse_gateway_token_cli_output("null\n"), None);
    }

    #[test]
    fn test_parse_gateway_token_cli_output_empty() {
        assert_eq!(parse_gateway_token_cli_output(""), None);
    }

    #[test]
    fn test_parse_dashboard_url_cli_output_found() {
        let output = "Starting server...\nDashboard URL: http://localhost:18789/#token=abc\n";
        assert_eq!(
            parse_dashboard_url_cli_output(output),
            Some("http://localhost:18789/#token=abc".to_string())
        );
    }

    #[test]
    fn test_parse_dashboard_url_cli_output_not_found() {
        assert_eq!(parse_dashboard_url_cli_output("no url here"), None);
    }

    #[test]
    fn test_extract_gateway_token_from_config_valid() {
        let config = r#"{"gateway":{"auth":{"token":"my-token"}}}"#;
        assert_eq!(
            extract_gateway_token_from_config(config, "test").unwrap(),
            "my-token"
        );
    }

    #[test]
    fn test_extract_gateway_token_from_config_missing() {
        let config = r#"{"gateway":{}}"#;
        assert!(extract_gateway_token_from_config(config, "test").is_err());
    }
}
