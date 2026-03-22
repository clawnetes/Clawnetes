use ssh2::Session;
use std::fs;
use std::path::Path;

use crate::ssh::{connect_ssh, execute_ssh, get_env_prefix};
use crate::system::{shell_command, shell_single_quote};
use crate::types::RemoteInfo;

pub fn telegram_pairing_status_from_dm_policy(policy: &str) -> bool {
    policy.trim().trim_matches('"') != "pairing"
}

pub fn parse_config_string_output(output: &str) -> Option<String> {
    let value = output.trim().trim_matches('"');
    if value.is_empty() || value == "null" || value == "undefined" {
        None
    } else {
        Some(value.to_string())
    }
}

pub fn extract_telegram_dm_policy_from_config(config: &serde_json::Value) -> Option<String> {
    config
        .get("channels")
        .and_then(|c| c.get("telegram"))
        .and_then(|t| t.get("accounts"))
        .and_then(|a| a.get("default"))
        .and_then(|m| m.get("dmPolicy"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            config
                .get("channels")
                .and_then(|c| c.get("telegram"))
                .and_then(|t| t.get("dmPolicy"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
}

pub fn read_telegram_dm_policy_from_config_str(config_str: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(config_str)
        .ok()
        .and_then(|config| extract_telegram_dm_policy_from_config(&config))
}

pub fn read_telegram_dm_policy_via_cli<F>(mut run_command: F) -> Result<Option<String>, String>
where
    F: FnMut(&str) -> Result<String, String>,
{
    for cmd in [
        "openclaw config get channels.telegram.accounts.default.dmPolicy",
        "openclaw config get channels.telegram.dmPolicy",
    ] {
        match run_command(cmd) {
            Ok(output) => {
                if let Some(policy) = parse_config_string_output(&output) {
                    return Ok(Some(policy));
                }
            }
            Err(_) => continue,
        }
    }

    Ok(None)
}

pub fn telegram_allow_from_entries_from_str(content: &str) -> Option<usize> {
    serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .and_then(|json| {
            json.get("allowFrom")
                .and_then(|value| value.as_array())
                .map(|items| items.len())
        })
}

pub fn is_telegram_allow_from_filename(name: &str) -> bool {
    name.starts_with("telegram") && name.ends_with("-allowFrom.json")
}

pub fn telegram_allow_from_is_linked_local(credentials_dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(credentials_dir) else {
        return false;
    };

    entries.flatten().any(|entry| {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            return false;
        };
        if !path.is_file() || !is_telegram_allow_from_filename(name) {
            return false;
        }

        fs::read_to_string(&path)
            .ok()
            .and_then(|content| telegram_allow_from_entries_from_str(&content))
            .map(|count| count > 0)
            .unwrap_or(false)
    })
}

pub fn telegram_allow_from_is_linked_remote(sess: &Session) -> Result<bool, String> {
    let files = execute_ssh(
        sess,
        "find \"$HOME/.openclaw/credentials\" -maxdepth 1 -type f -name 'telegram*-allowFrom.json' 2>/dev/null",
    )?;

    for file in files.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let content = execute_ssh(sess, &format!("cat {}", shell_single_quote(file)))?;
        if telegram_allow_from_entries_from_str(&content).unwrap_or(0) > 0 {
            return Ok(true);
        }
    }

    Ok(false)
}

pub fn whatsapp_session_is_linked(session_dir: &Path) -> bool {
    if !session_dir.exists() {
        return false;
    }

    let mut stack = vec![session_dir.to_path_buf()];
    while let Some(path) = stack.pop() {
        let Ok(entries) = fs::read_dir(&path) else {
            continue;
        };
        for entry in entries.flatten() {
            let child = entry.path();
            if child.is_file() {
                return true;
            }
            if child.is_dir() {
                stack.push(child);
            }
        }
    }

    false
}

fn local_whatsapp_session_dir_string() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let home_dir = crate::system::wsl_home_dir()?.trim().to_string();
        Ok(format!(
            "{}/.openclaw/credentials/whatsapp/default",
            home_dir.trim_end_matches('/')
        ))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home_dir = dirs::home_dir().ok_or("Could not determine local home directory.")?;
        Ok(home_dir
            .join(".openclaw/credentials/whatsapp/default")
            .to_string_lossy()
            .to_string())
    }
}

pub fn check_whatsapp_link_status(remote: Option<&RemoteInfo>) -> Result<bool, String> {
    if let Some(r) = remote {
        let sess = connect_ssh(r)?;
        let output = execute_ssh(
            &sess,
            "if [ -d \"$HOME/.openclaw/credentials/whatsapp/default\" ] && find \"$HOME/.openclaw/credentials/whatsapp/default\" -type f 2>/dev/null | grep -q .; then printf linked; else printf unlinked; fi",
        )?;
        Ok(output.trim() == "linked")
    } else {
        let session_dir = local_whatsapp_session_dir_string()?;

        #[cfg(target_os = "windows")]
        {
            let output = crate::system::shell_command(&format!(
                "if [ -d \"{0}\" ] && find \"{0}\" -type f 2>/dev/null | grep -q .; then printf linked; else printf unlinked; fi",
                session_dir
            ))?;
            Ok(output.trim() == "linked")
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(whatsapp_session_is_linked(Path::new(&session_dir)))
        }
    }
}

pub fn check_pairing_status(remote: Option<&RemoteInfo>) -> Result<bool, String> {
    if let Some(r) = remote {
        let sess = connect_ssh(r)?;
        let os_type = execute_ssh(&sess, "uname -s")?.trim().to_string();
        let prefix = get_env_prefix(&os_type);

        if let Some(policy) = read_telegram_dm_policy_via_cli(|cmd| {
            execute_ssh(&sess, &format!("{}{}", prefix, cmd))
        })? {
            if telegram_pairing_status_from_dm_policy(&policy) {
                return Ok(true);
            }
        }

        if let Some(policy) = read_telegram_dm_policy_from_config_str(&execute_ssh(
            &sess,
            "cat ~/.openclaw/openclaw.json",
        )?) {
            if telegram_pairing_status_from_dm_policy(&policy) {
                return Ok(true);
            }
        }

        return telegram_allow_from_is_linked_remote(&sess);
    }

    if let Some(policy) = read_telegram_dm_policy_via_cli(shell_command)? {
        if telegram_pairing_status_from_dm_policy(&policy) {
            return Ok(true);
        }
    }

    let home_dir = dirs::home_dir().ok_or("Could not determine local home directory.")?;
    let config_path = home_dir.join(".openclaw").join("openclaw.json");
    if let Ok(config_str) = fs::read_to_string(&config_path) {
        if let Some(policy) = read_telegram_dm_policy_from_config_str(&config_str) {
            if telegram_pairing_status_from_dm_policy(&policy) {
                return Ok(true);
            }
        }
    }

    let credentials_dir = home_dir.join(".openclaw").join("credentials");
    Ok(telegram_allow_from_is_linked_local(&credentials_dir))
}

pub fn check_messaging_link_status(
    channel: &str,
    remote: Option<&RemoteInfo>,
) -> Result<bool, String> {
    match channel {
        "telegram" => check_pairing_status(remote),
        "whatsapp" => check_whatsapp_link_status(remote),
        "none" => Ok(true),
        _ => Err(format!("Unsupported messaging channel: {}", channel)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_telegram_pairing_status_from_dm_policy() {
        assert!(!telegram_pairing_status_from_dm_policy("pairing"));
        assert!(telegram_pairing_status_from_dm_policy("open"));
        assert!(telegram_pairing_status_from_dm_policy("closed"));
    }

    #[test]
    fn test_parse_config_string_output() {
        assert_eq!(
            parse_config_string_output("\"open\"\n"),
            Some("open".to_string())
        );
        assert_eq!(parse_config_string_output("null"), None);
        assert_eq!(parse_config_string_output(""), None);
    }

    #[test]
    fn test_extract_telegram_dm_policy_from_config_nested() {
        let config = serde_json::json!({
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
            extract_telegram_dm_policy_from_config(&config),
            Some("open".to_string())
        );
    }

    #[test]
    fn test_extract_telegram_dm_policy_from_config_flat() {
        let config = serde_json::json!({
            "channels": {
                "telegram": {
                    "dmPolicy": "pairing"
                }
            }
        });
        assert_eq!(
            extract_telegram_dm_policy_from_config(&config),
            Some("pairing".to_string())
        );
    }

    #[test]
    fn test_is_telegram_allow_from_filename() {
        assert!(is_telegram_allow_from_filename(
            "telegram-default-allowFrom.json"
        ));
        assert!(!is_telegram_allow_from_filename("whatsapp-session.json"));
    }

    #[test]
    fn test_telegram_allow_from_entries_from_str() {
        assert_eq!(
            telegram_allow_from_entries_from_str(r#"{"allowFrom":["user1","user2"]}"#),
            Some(2)
        );
        assert_eq!(
            telegram_allow_from_entries_from_str(r#"{"allowFrom":[]}"#),
            Some(0)
        );
        assert_eq!(telegram_allow_from_entries_from_str(r#"{}"#), None);
    }

    #[test]
    fn test_whatsapp_session_is_linked_nonexistent() {
        assert!(!whatsapp_session_is_linked(Path::new("/nonexistent/path")));
    }

    #[test]
    fn test_local_whatsapp_session_dir_suffix_is_correct() {
        let path = {
            #[cfg(target_os = "windows")]
            {
                "/home/testuser/.openclaw/credentials/whatsapp/default".to_string()
            }
            #[cfg(not(target_os = "windows"))]
            {
                "/tmp/testuser/.openclaw/credentials/whatsapp/default".to_string()
            }
        };

        assert!(path.ends_with(".openclaw/credentials/whatsapp/default"));
    }

    #[test]
    fn test_read_telegram_dm_policy_via_cli_finds_first() {
        let result = read_telegram_dm_policy_via_cli(|_cmd| Ok("\"open\"".to_string()));
        assert_eq!(result.unwrap(), Some("open".to_string()));
    }

    #[test]
    fn test_read_telegram_dm_policy_via_cli_all_fail() {
        let result = read_telegram_dm_policy_via_cli(|_cmd| Err("fail".to_string()));
        assert_eq!(result.unwrap(), None);
    }
}
