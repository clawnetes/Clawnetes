use rand::Rng;
use std::fs;
use std::path::Path;

use crate::oauth::{
    apply_model_provider_auth, auth_provider_id_for_config, build_auth_profiles_doc,
    build_effective_models_catalog, collect_required_plugin_ids, default_provider_auth,
    get_provider_auth_map, merge_enabled_plugin_entries, normalize_auth_mode,
    normalize_model_ref_for_ui, normalize_provider_for_ui, resolve_profile_name,
    resolve_provider_auth_data,
};
use crate::pairing::{
    extract_telegram_dm_policy_from_config, telegram_allow_from_is_linked_local,
    telegram_pairing_status_from_dm_policy,
};
use crate::system::shell_command;
use crate::types::{AgentConfig, AgentData, CronJobConfig, CurrentConfig};

fn profile_has_usable_credential(profile: &serde_json::Value) -> bool {
    profile
        .get("token")
        .and_then(|value| value.as_str())
        .map(|value| !value.is_empty())
        .unwrap_or(false)
        || profile
            .get("access")
            .and_then(|value| value.as_str())
            .map(|value| !value.is_empty())
            .unwrap_or(false)
}

fn provider_auth_is_usable(auth: &crate::types::ProviderAuthData) -> bool {
    if !auth.token.is_empty() {
        return true;
    }

    auth.profile
        .as_ref()
        .map(profile_has_usable_credential)
        .unwrap_or(false)
}

fn is_remote_provider(provider: &str) -> bool {
    !matches!(provider, "ollama" | "lmstudio" | "local")
}

fn is_known_model_provider(provider: &str) -> bool {
    matches!(
        provider,
        "anthropic"
            | "openai"
            | "openai-codex"
            | "google"
            | "google-vertex"
            | "openrouter"
            | "xai"
            | "ollama"
            | "lmstudio"
            | "local"
    )
}

fn normalize_openai_base_url(base_url: &str) -> String {
    if base_url.ends_with("/v1") {
        base_url.to_string()
    } else {
        format!("{}/v1", base_url.trim_end_matches('/'))
    }
}

fn strip_openai_base_url_suffix(base_url: &str) -> String {
    base_url
        .trim_end_matches('/')
        .strip_suffix("/v1")
        .unwrap_or(base_url.trim_end_matches('/'))
        .to_string()
}

fn persist_local_model_ref(model_ref: &str) -> String {
    if let Some(stripped) = model_ref.strip_prefix("local/") {
        format!("llamacpp/{}", stripped)
    } else {
        model_ref.to_string()
    }
}

fn local_catalog_model_id(model_ref: &str) -> String {
    model_ref
        .strip_prefix("local/")
        .or_else(|| model_ref.strip_prefix("llamacpp/"))
        .unwrap_or(model_ref)
        .to_string()
}

fn normalize_model_ref_for_loaded_ui(model_ref: &str, infer_local: bool) -> String {
    let normalized = normalize_model_ref_for_ui(model_ref);
    if !infer_local {
        return normalized;
    }

    if let Some((provider, _)) = normalized.split_once('/') {
        if !is_known_model_provider(provider) {
            return format!("local/{}", normalized);
        }
    }

    normalized
}

fn collect_referenced_remote_providers(config: &AgentConfig) -> std::collections::BTreeSet<String> {
    let mut providers = std::collections::BTreeSet::new();

    let mut collect_from_model = |model_ref: &str| {
        if let Some(provider) = model_ref.split('/').next() {
            let normalized = normalize_provider_for_ui(provider);
            if is_remote_provider(&normalized) {
                providers.insert(normalized);
            }
        }
    };

    collect_from_model(&config.model);
    for fallback in config.fallback_models.as_ref().into_iter().flatten() {
        collect_from_model(fallback);
    }
    for agent in config.agents.as_ref().into_iter().flatten() {
        collect_from_model(&agent.model);
        for fallback in agent.fallback_models.as_ref().into_iter().flatten() {
            collect_from_model(fallback);
        }
    }

    if providers.is_empty() && is_remote_provider(&config.provider) {
        providers.insert(config.provider.clone());
    }

    providers
}

fn parse_auth_profiles_doc(contents: &str) -> serde_json::Value {
    serde_json::from_str(contents).unwrap_or_else(|_| serde_json::json!({}))
}

fn merge_auth_profiles_doc(
    generated: &serde_json::Value,
    existing: Option<&serde_json::Value>,
) -> serde_json::Value {
    let mut result = existing.cloned().unwrap_or_else(|| serde_json::json!({}));

    if let Some(existing_obj) = result.as_object_mut() {
        existing_obj.insert("version".to_string(), serde_json::json!(1));
    } else {
        result = serde_json::json!({ "version": 1 });
    }

    let result_obj = result
        .as_object_mut()
        .expect("auth profile document should be an object");

    let mut merged_profiles = existing
        .and_then(|value| value.get("profiles"))
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    if let Some(profiles) = generated
        .get("profiles")
        .and_then(|value| value.as_object())
    {
        for (key, value) in profiles {
            merged_profiles.insert(key.clone(), value.clone());
        }
    }

    let mut merged_last_good = existing
        .and_then(|value| value.get("lastGood"))
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    if let Some(last_good) = generated
        .get("lastGood")
        .and_then(|value| value.as_object())
    {
        for (key, value) in last_good {
            merged_last_good.insert(key.clone(), value.clone());
        }
    }

    let merged_usage_stats = existing
        .and_then(|value| value.get("usageStats"))
        .cloned()
        .or_else(|| generated.get("usageStats").cloned())
        .unwrap_or_else(|| serde_json::json!({}));

    result_obj.insert(
        "profiles".to_string(),
        serde_json::Value::Object(merged_profiles),
    );
    result_obj.insert(
        "lastGood".to_string(),
        serde_json::Value::Object(merged_last_good),
    );
    result_obj.insert("usageStats".to_string(), merged_usage_stats);

    result
}

fn recover_provider_auths_from_doc(
    provider_auths: &mut std::collections::HashMap<String, crate::types::ProviderAuthData>,
    referenced_providers: &std::collections::BTreeSet<String>,
    auth_config: &serde_json::Value,
) {
    for provider in referenced_providers {
        let needs_recovery = provider_auths
            .get(provider)
            .map(|auth| !provider_auth_is_usable(auth))
            .unwrap_or(true);
        if !needs_recovery {
            continue;
        }

        if let Some(auth) = resolve_provider_auth_data(provider, auth_config) {
            if provider_auth_is_usable(&auth) {
                provider_auths.insert(provider.clone(), auth);
            }
        }
    }
}

pub fn apply_agent_overrides(agent_obj: &mut serde_json::Value, agent: &AgentData) {
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

    // Add per-agent heartbeat if specified
    if let Some(heartbeat_mode) = &agent.heartbeat_mode {
        let heartbeat_value = match heartbeat_mode.as_str() {
            "never" => serde_json::json!({ "enabled": false }),
            "idle" => {
                let timeout = agent.idle_timeout_ms.unwrap_or(300000); // 5 minutes default
                serde_json::json!({ "mode": "idle", "timeout": timeout })
            }
            interval => serde_json::json!({ "every": interval }),
        };

        if let Some(agent_obj_map) = agent_obj.as_object_mut() {
            agent_obj_map.insert("heartbeat".to_string(), heartbeat_value);
        }
    }
}

fn sync_agent_skills(
    agent_id: &str,
    enabled_skills: Option<&Vec<String>>,
    home: &str,
) -> Result<(), String> {
    let agent_skills_dir = format!("{}/.openclaw/agents/{}/workspace/skills", home, agent_id);

    // Create skills directory if it doesn't exist
    let _ = fs::create_dir_all(&agent_skills_dir);

    // Get list of currently installed skill directories
    let installed_skills = match fs::read_dir(&agent_skills_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect::<Vec<_>>(),
        Err(_) => vec![],
    };

    let enabled = enabled_skills.cloned().unwrap_or_default();

    // Remove skills that are no longer enabled
    for skill in &installed_skills {
        if !enabled.contains(skill) {
            let skill_path = format!("{}/{}", agent_skills_dir, skill);
            let _ = fs::remove_dir_all(&skill_path);
        }
    }

    // For now, skills installation would be handled by openclaw CLI
    // Future: integrate with skill registry to copy/install skill files
    // For each enabled skill not yet installed:
    // let _ = shell_command(&format!("openclaw skills install --agent {} {}", agent_id, skill));

    Ok(())
}

pub fn build_agent_session_init_command(agent_id: &str) -> String {
    format!(
        "openclaw agent --agent {} --message \"hello\" 2>/dev/null || true",
        agent_id
    )
}

fn map_loaded_sandbox_mode(mode: Option<&str>) -> &'static str {
    match mode {
        Some("all") | Some("full") => "full",
        Some("non-main") | Some("partial") => "partial",
        Some("off") | Some("none") => "none",
        Some(_) | None => "none",
    }
}

pub fn read_workspace_files(
    remote: Option<&crate::types::RemoteInfo>,
) -> Result<serde_json::Value, String> {
    let session = if let Some(r) = remote {
        Some(crate::ssh::connect_ssh(r)?)
    } else {
        None
    };

    let home_dir = if let Some(sess) = &session {
        crate::ssh::execute_ssh(sess, "echo $HOME")
            .map_err(|e| format!("Failed to get remote home: {}", e))?
            .trim()
            .to_string()
    } else {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_home_dir()?
        }
        #[cfg(not(target_os = "windows"))]
        {
            dirs::home_dir()
                .ok_or("Could not find local home directory")?
                .to_string_lossy()
                .to_string()
        }
    };

    let read_file_content = |path: &str| -> String {
        if let Some(sess) = &session {
            crate::ssh::execute_ssh(sess, &format!("cat \"{}\"", path)).unwrap_or_default()
        } else {
            #[cfg(target_os = "windows")]
            {
                crate::system::wsl_read_file(path).unwrap_or_default()
            }
            #[cfg(not(target_os = "windows"))]
            {
                fs::read_to_string(path).unwrap_or_default()
            }
        }
    };

    let workspace = format!("{}/.openclaw/workspace", home_dir);
    let identity = read_file_content(&format!("{}/IDENTITY.md", workspace));
    let user = read_file_content(&format!("{}/USER.md", workspace));
    let soul = read_file_content(&format!("{}/SOUL.md", workspace));

    Ok(serde_json::json!({
        "identity": identity,
        "user": user,
        "soul": soul
    }))
}

pub fn save_workspace_files(
    remote: Option<&crate::types::RemoteInfo>,
    agent_id: Option<&str>,
    identity: &str,
    user: &str,
    soul: &str,
) -> Result<String, String> {
    let session = if let Some(r) = remote {
        Some(crate::ssh::connect_ssh(r)?)
    } else {
        None
    };

    let home_dir = if let Some(sess) = &session {
        crate::ssh::execute_ssh(sess, "echo $HOME")
            .map_err(|e| format!("Failed to get remote home: {}", e))?
            .trim()
            .to_string()
    } else {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_home_dir()?
        }
        #[cfg(not(target_os = "windows"))]
        {
            dirs::home_dir()
                .ok_or("Could not find local home directory")?
                .to_string_lossy()
                .to_string()
        }
    };

    let mkdir_p_fn = |path: &str| -> Result<(), String> {
        if let Some(sess) = &session {
            crate::ssh::execute_ssh(sess, &format!("mkdir -p \"{}\"", path))?;
            Ok(())
        } else {
            #[cfg(target_os = "windows")]
            {
                crate::system::wsl_mkdir_p(path)
            }
            #[cfg(not(target_os = "windows"))]
            {
                fs::create_dir_all(path).map_err(|e| e.to_string())
            }
        }
    };

    let write_file_fn = |path: &str, content: &str| -> Result<(), String> {
        if let Some(sess) = &session {
            crate::ssh::execute_ssh(
                sess,
                &format!("cat << 'EOF_WRITE' > \"{}\"\n{}\nEOF_WRITE", path, content),
            )?;
            Ok(())
        } else {
            #[cfg(target_os = "windows")]
            {
                crate::system::wsl_write_file(path, content)
            }
            #[cfg(not(target_os = "windows"))]
            {
                fs::write(path, content).map_err(|e| e.to_string())
            }
        }
    };

    let workspace = if let Some(id) = agent_id {
        format!("{}/.openclaw/agents/{}/workspace", home_dir, id)
    } else {
        format!("{}/.openclaw/workspace", home_dir)
    };

    mkdir_p_fn(&workspace)?;

    write_file_fn(&format!("{}/IDENTITY.md", workspace), identity)?;
    write_file_fn(&format!("{}/USER.md", workspace), user)?;
    write_file_fn(&format!("{}/SOUL.md", workspace), soul)?;

    Ok("Workspace files saved successfully".to_string())
}

pub fn create_custom_skill(
    remote: Option<&crate::types::RemoteInfo>,
    name: &str,
    content: &str,
) -> Result<String, String> {
    let session = if let Some(r) = remote {
        Some(crate::ssh::connect_ssh(r)?)
    } else {
        None
    };

    let home_dir = if let Some(sess) = &session {
        crate::ssh::execute_ssh(sess, "echo $HOME")
            .map_err(|e| format!("Failed to get remote home: {}", e))?
            .trim()
            .to_string()
    } else {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_home_dir()?
        }
        #[cfg(not(target_os = "windows"))]
        {
            dirs::home_dir()
                .ok_or("Could not find local home directory")?
                .to_string_lossy()
                .to_string()
        }
    };

    let mkdir_p_fn = |path: &str| -> Result<(), String> {
        if let Some(sess) = &session {
            crate::ssh::execute_ssh(sess, &format!("mkdir -p \"{}\"", path))?;
            Ok(())
        } else {
            #[cfg(target_os = "windows")]
            {
                crate::system::wsl_mkdir_p(path)
            }
            #[cfg(not(target_os = "windows"))]
            {
                fs::create_dir_all(path).map_err(|e| e.to_string())
            }
        }
    };

    let write_file_fn = |path: &str, content: &str| -> Result<(), String> {
        if let Some(sess) = &session {
            crate::ssh::execute_ssh(
                sess,
                &format!("cat << 'EOF_WRITE' > \"{}\"\n{}\nEOF_WRITE", path, content),
            )?;
            Ok(())
        } else {
            #[cfg(target_os = "windows")]
            {
                crate::system::wsl_write_file(path, content)
            }
            #[cfg(not(target_os = "windows"))]
            {
                fs::write(path, content).map_err(|e| e.to_string())
            }
        }
    };

    let skill_dir = format!("{}/.openclaw/workspace/skills/{}", home_dir, name);
    mkdir_p_fn(&skill_dir)?;

    let skill_path = format!("{}/SKILL.md", skill_dir);
    write_file_fn(&skill_path, content)?;

    Ok(format!("Custom skill '{}' created successfully", name))
}

pub fn validate_openclaw_config(
    remote: Option<&crate::types::RemoteInfo>,
    is_wsl: Option<bool>,
) -> Result<String, String> {
    use crate::system::shell_command;
    if let Some(r) = remote {
        let sess = crate::ssh::connect_ssh(r).map_err(|e| format!("SSH connect failed: {}", e))?;
        let os_type = crate::ssh::execute_ssh(&sess, "uname -s")
            .unwrap_or_default()
            .trim()
            .to_string();
        let prefix = crate::ssh::get_env_prefix(&os_type);
        crate::ssh::execute_ssh(&sess, &format!("{}openclaw config validate 2>&1", prefix))
    } else if is_wsl.unwrap_or(false) {
        shell_command("wsl -- openclaw config validate 2>&1")
    } else {
        shell_command("openclaw config validate 2>&1")
    }
}

pub fn configure_agent(config: AgentConfig) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let home: String = crate::system::wsl_home_dir()?;

    #[cfg(not(target_os = "windows"))]
    let home: String = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .to_string_lossy()
        .to_string();

    let mkdir_p_fn = |path: &str| -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_mkdir_p(path)
        }
        #[cfg(not(target_os = "windows"))]
        {
            fs::create_dir_all(path).map_err(|e| e.to_string())
        }
    };

    let write_file_fn = |path: &str, content: &str| -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_write_file(path, content)
        }
        #[cfg(not(target_os = "windows"))]
        {
            fs::write(path, content).map_err(|e| e.to_string())
        }
    };

    let read_file_fn = |path: &str| -> String {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_read_file(path).unwrap_or_default()
        }
        #[cfg(not(target_os = "windows"))]
        {
            fs::read_to_string(path).unwrap_or_default()
        }
    };

    if config.preserve_state != Some(true) {
        let _ = shell_command("openclaw gateway stop");
        let _ = shell_command("openclaw gateway install --force --profile messaging");
    }

    let openclaw_root = format!("{}/.openclaw", home);
    let workspace = format!("{}/workspace", openclaw_root);
    let agents_dir = format!("{}/agents/main/agent", openclaw_root);

    mkdir_p_fn(&workspace)?;
    mkdir_p_fn(&agents_dir)?;

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

    let existing_main_auth_config = {
        let existing_auth_profiles_path = format!("{}/auth-profiles.json", agents_dir);
        let contents = read_file_fn(&existing_auth_profiles_path);
        if contents.is_empty() {
            serde_json::json!({})
        } else {
            parse_auth_profiles_doc(&contents)
        }
    };

    let mut provider_auths = get_provider_auth_map(&config);
    let referenced_remote_providers = collect_referenced_remote_providers(&config);
    recover_provider_auths_from_doc(
        &mut provider_auths,
        &referenced_remote_providers,
        &existing_main_auth_config,
    );

    let all_agent_dirs = {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_list_dirs(&format!("{}/agents", openclaw_root))
        }
        #[cfg(not(target_os = "windows"))]
        {
            fs::read_dir(format!("{}/agents", openclaw_root))
                .map(|entries| {
                    entries
                        .filter_map(|entry| entry.ok())
                        .filter(|entry| entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
                        .filter_map(|entry| entry.file_name().into_string().ok())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        }
    };

    for agent_dir_name in all_agent_dirs {
        let agent_auth_path = format!(
            "{}/agents/{}/agent/auth-profiles.json",
            openclaw_root, agent_dir_name
        );
        let contents = read_file_fn(&agent_auth_path);
        if contents.is_empty() {
            continue;
        }
        let auth_config = parse_auth_profiles_doc(&contents);
        recover_provider_auths_from_doc(
            &mut provider_auths,
            &referenced_remote_providers,
            &auth_config,
        );
    }

    let missing_providers = referenced_remote_providers
        .iter()
        .filter(|provider| {
            provider_auths
                .get(*provider)
                .map(|auth| !provider_auth_is_usable(auth))
                .unwrap_or(true)
        })
        .cloned()
        .collect::<Vec<_>>();
    if !missing_providers.is_empty() {
        return Err(format!(
            "Missing authentication for provider(s): {}. Configure auth for those providers before saving this model selection.",
            missing_providers.join(", ")
        ));
    }

    let primary_provider = config
        .model
        .split('/')
        .next()
        .map(normalize_provider_for_ui)
        .unwrap_or_else(|| config.provider.clone());
    let effective_primary_model = apply_model_provider_auth(&config.model, &provider_auths);
    let persisted_primary_model = persist_local_model_ref(&effective_primary_model);
    let effective_fallback_models = config
        .fallback_models
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|model| apply_model_provider_auth(&model, &provider_auths))
        .collect::<Vec<_>>();
    let persisted_fallback_models = effective_fallback_models
        .iter()
        .map(|model| persist_local_model_ref(model))
        .collect::<Vec<_>>();
    let required_plugin_ids = collect_required_plugin_ids(&provider_auths, config.skills.as_ref());

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
                    "primary": persist_local_model_ref(&apply_model_provider_auth(&agent.model, &provider_auths))
                }
            });

            if let Some(fb) = &agent.fallback_models {
                let persisted_agent_fallbacks = fb
                    .iter()
                    .map(|model| apply_model_provider_auth(model, &provider_auths))
                    .map(|model| persist_local_model_ref(&model))
                    .collect::<Vec<_>>();
                if !fb.is_empty() {
                    if let Some(model_obj) =
                        agent_obj.get_mut("model").and_then(|m| m.as_object_mut())
                    {
                        model_obj.insert(
                            "fallbacks".to_string(),
                            serde_json::to_value(persisted_agent_fallbacks).unwrap(),
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
                "primary": persisted_primary_model
            }
        });

        if !persisted_fallback_models.is_empty() {
            if let Some(model_obj) = main_obj.get_mut("model").and_then(|m| m.as_object_mut()) {
                model_obj.insert(
                    "fallbacks".to_string(),
                    serde_json::to_value(&persisted_fallback_models).unwrap(),
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

    if let Some(obj) = config_json.as_object_mut() {
        let messages_entry = obj
            .entry("messages".to_string())
            .or_insert(serde_json::json!({}));
        if let Some(m) = messages_entry.as_object_mut() {
            m.insert(
                "ackReactionScope".to_string(),
                serde_json::json!("group-mentions"),
            );
        }

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
                    serde_json::json!({ "primary": persisted_primary_model }),
                );
            }
            a.insert("list".to_string(), serde_json::json!(agents_list));
        }

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

        let auth_entry = obj
            .entry("auth".to_string())
            .or_insert(serde_json::json!({}));
        if let Some(a) = auth_entry.as_object_mut() {
            a.entry("profiles".to_string())
                .or_insert(serde_json::json!({}));
        }

        let commands_entry = obj
            .entry("commands".to_string())
            .or_insert(serde_json::json!({}));
        if let Some(c) = commands_entry.as_object_mut() {
            c.insert("native".to_string(), serde_json::json!("auto"));
            c.insert("nativeSkills".to_string(), serde_json::json!("auto"));
        }
    }

    merge_enabled_plugin_entries(&mut config_json, &required_plugin_ids);

    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            merge_enabled_plugin_entries(&mut config_json, &["telegram".to_string()]);
            if let Some(obj) = config_json.as_object_mut() {
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

    if config.whatsapp_enabled.unwrap_or(false) {
        let dm_policy = config.whatsapp_dm_policy.as_deref().unwrap_or("open");
        merge_enabled_plugin_entries(&mut config_json, &["whatsapp".to_string()]);
        if let Some(obj) = config_json.as_object_mut() {
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

    if let Some(profiles) = config_json
        .get_mut("auth")
        .and_then(|a| a.get_mut("profiles"))
        .and_then(|p| p.as_object_mut())
    {
        for (provider, provider_auth) in &provider_auths {
            let auth_profile_provider =
                auth_provider_id_for_config(provider, provider_auth, &provider_auths);
            let auth_profile_name = resolve_profile_name(provider, provider_auth);
            let auth_profile_mode = normalize_auth_mode(&provider_auth.auth_method);

            profiles.insert(
                auth_profile_name,
                serde_json::json!({
                "provider": auth_profile_provider,
                "mode": auth_profile_mode
                    }),
            );
        }
    }

    if let Some(defaults) = config_json
        .get_mut("agents")
        .and_then(|a| a.get_mut("defaults"))
        .and_then(|d| d.as_object_mut())
    {
        defaults.insert(
            "models".to_string(),
            serde_json::Value::Object(build_effective_models_catalog(
                &persisted_primary_model,
                &persisted_fallback_models,
            )),
        );

        if !persisted_fallback_models.is_empty() {
            if let Some(primary_model_config) =
                defaults.get_mut("model").and_then(|m| m.as_object_mut())
            {
                primary_model_config.insert(
                    "fallbacks".to_string(),
                    serde_json::to_value(&persisted_fallback_models).unwrap(),
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

    if let Some(cron_jobs) = &config.cron_jobs {
        if !cron_jobs.is_empty() {
            if let Some(obj) = config_json.as_object_mut() {
                obj.insert("cron".to_string(), serde_json::json!({ "enabled": true }));
            }
        }
    }

    if config.provider == "lmstudio" {
        let base_url = config
            .local_base_url
            .as_deref()
            .unwrap_or("http://localhost:1234");
        let base_url_v1 = normalize_openai_base_url(base_url);
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

    if config.provider == "local" {
        let base_url = config
            .local_base_url
            .as_deref()
            .unwrap_or("http://localhost:8080");
        let mut model_ids = Vec::new();
        if matches!(
            effective_primary_model.split('/').next(),
            Some("local" | "llamacpp")
        ) {
            let catalog_model = local_catalog_model_id(&effective_primary_model);
            if !catalog_model.is_empty() {
                model_ids.push(catalog_model);
            }
        }
        for model in &effective_fallback_models {
            if matches!(model.split('/').next(), Some("local" | "llamacpp")) {
                let catalog_model = local_catalog_model_id(model);
                if !model_ids.contains(&catalog_model) {
                    model_ids.push(catalog_model);
                }
            }
        }
        if let Some(agents) = &config.agents {
            for agent in agents {
                let effective_agent_model =
                    apply_model_provider_auth(&agent.model, &provider_auths);
                if matches!(
                    effective_agent_model.split('/').next(),
                    Some("local" | "llamacpp")
                ) {
                    let catalog_model = local_catalog_model_id(&effective_agent_model);
                    if !model_ids.contains(&catalog_model) {
                        model_ids.push(catalog_model);
                    }
                }
                if let Some(fallbacks) = &agent.fallback_models {
                    for fallback in fallbacks {
                        let effective_fallback =
                            apply_model_provider_auth(fallback, &provider_auths);
                        if matches!(
                            effective_fallback.split('/').next(),
                            Some("local" | "llamacpp")
                        ) {
                            let catalog_model = local_catalog_model_id(&effective_fallback);
                            if !model_ids.contains(&catalog_model) {
                                model_ids.push(catalog_model);
                            }
                        }
                    }
                }
            }
        }
        let local_models: Vec<serde_json::Value> = model_ids
            .iter()
            .map(|id| {
                serde_json::json!({
                    "id": id,
                    "name": id,
                    "api": "openai-completions",
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
                        "llamacpp": {
                            "baseUrl": normalize_openai_base_url(base_url),
                            "api": "openai-completions",
                            "models": local_models
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
                &agent
                    .model
                    .split('/')
                    .next()
                    .map(normalize_provider_for_ui)
                    .unwrap_or_else(|| primary_provider.clone()),
            );
            let existing_agent_auth_config = {
                let contents = read_file_fn(&format!("{}/auth-profiles.json", agent_config_dir));
                if contents.is_empty() {
                    None
                } else {
                    Some(parse_auth_profiles_doc(&contents))
                }
            };
            let merged_agent_auth_profiles =
                merge_auth_profiles_doc(&agent_auth_profiles, existing_agent_auth_config.as_ref());

            let agent_auth_json = serde_json::to_string_pretty(&merged_agent_auth_profiles)
                .map_err(|e| e.to_string())?;
            write_file_fn(
                &format!("{}/auth-profiles.json", agent_config_dir),
                &agent_auth_json,
            )?;

            // Sync agent skills
            sync_agent_skills(&agent.id, agent.skills.as_ref(), &home)?;
        }
    }

    if let Some(nm) = config.node_manager {
        let _ = shell_command(&format!("openclaw config set skills.nodeManager {}", nm));
    }

    let auth_profiles_val = build_auth_profiles_doc(
        &provider_auths,
        config.fallback_models.as_ref(),
        config.local_base_url.as_ref(),
        &primary_provider,
    );
    let merged_auth_profiles_val =
        merge_auth_profiles_doc(&auth_profiles_val, Some(&existing_main_auth_config));

    let auth_profiles_json =
        serde_json::to_string_pretty(&merged_auth_profiles_val).map_err(|e| e.to_string())?;
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

pub fn get_current_config(
    remote: Option<&crate::types::RemoteInfo>,
) -> Result<CurrentConfig, String> {
    fn extract_md_value(content: &str, key: &str) -> String {
        let pattern = format!("**{}:**", key);

        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(pattern_pos) = trimmed.find(&pattern) {
                let value_start = pattern_pos + pattern.len();
                let value = &trimmed[value_start..];
                return value.trim().to_string();
            }
        }
        String::new()
    }

    let session = if let Some(r) = remote {
        Some(crate::ssh::connect_ssh(r)?)
    } else {
        None
    };

    let home_dir = if let Some(sess) = &session {
        crate::ssh::execute_ssh(sess, "echo $HOME")
            .map_err(|e| format!("Failed to get remote home: {}", e))?
            .trim()
            .to_string()
    } else {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_home_dir()?
        }
        #[cfg(not(target_os = "windows"))]
        {
            dirs::home_dir()
                .ok_or("Could not find local home directory")?
                .to_string_lossy()
                .to_string()
        }
    };

    let read_file_content = |path: &str| -> String {
        if let Some(sess) = &session {
            crate::ssh::execute_ssh(sess, &format!("cat \"{}\"", path)).unwrap_or_default()
        } else {
            #[cfg(target_os = "windows")]
            {
                crate::system::wsl_read_file(path).unwrap_or_default()
            }
            #[cfg(not(target_os = "windows"))]
            {
                fs::read_to_string(path).unwrap_or_default()
            }
        }
    };

    let list_directories = |base_path: &str| -> Vec<String> {
        let mut dirs_found = Vec::new();
        if let Some(sess) = &session {
            if let Ok(output) =
                crate::ssh::execute_ssh(sess, &format!("ls -1 -F \"{}\"", base_path))
            {
                for line in output.lines() {
                    if line.trim().ends_with('/') {
                        dirs_found.push(line.trim().trim_matches('/').to_string());
                    }
                }
            }
        } else {
            #[cfg(target_os = "windows")]
            {
                dirs_found = crate::system::wsl_list_dirs(base_path);
            }
            #[cfg(not(target_os = "windows"))]
            {
                let path = Path::new(base_path);
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

    let defaults = oc_config
        .get("agents")
        .and_then(|a| a.get("defaults"))
        .unwrap_or(&empty_json);
    let has_local_provider = oc_config
        .get("models")
        .and_then(|m| m.get("providers"))
        .and_then(|p| p.get("llamacpp"))
        .is_some();
    let model_primary_raw = defaults
        .get("model")
        .and_then(|m| m.get("primary"))
        .and_then(|v| v.as_str())
        .unwrap_or("anthropic/claude-opus-4-6")
        .to_string();
    let raw_primary_provider = model_primary_raw
        .split('/')
        .next()
        .map(normalize_provider_for_ui)
        .unwrap_or_else(|| "anthropic".to_string());
    let inferred_local_primary =
        has_local_provider && !is_known_model_provider(&raw_primary_provider);
    let model_primary =
        normalize_model_ref_for_loaded_ui(&model_primary_raw, inferred_local_primary);
    let fallback_models_raw: Vec<String> = defaults
        .get("model")
        .and_then(|m| m.get("fallbacks"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let fallback_models: Vec<String> = fallback_models_raw
        .iter()
        .map(|model| normalize_model_ref_for_loaded_ui(model, has_local_provider))
        .collect();

    let base_provider = if inferred_local_primary {
        "local".to_string()
    } else {
        raw_primary_provider.clone()
    };
    let main_provider_auth = resolve_provider_auth_data(&base_provider, &auth_config)
        .unwrap_or_else(|| default_provider_auth(&base_provider, "", "token", None));
    let profile = main_provider_auth
        .profile
        .clone()
        .unwrap_or(serde_json::json!({}));
    let provider = base_provider.clone();
    let api_key = main_provider_auth.token.clone();
    let auth_method = main_provider_auth.auth_method.clone();

    let agent_name = extract_md_value(&identity_str, "Name");
    let agent_vibe = extract_md_value(&identity_str, "Vibe");
    let agent_emoji = extract_md_value(&identity_str, "Emoji");
    let user_name = extract_md_value(&user_str, "Name");

    let telegram_token = oc_config
        .get("channels")
        .and_then(|c| c.get("telegram"))
        .and_then(|t| t.get("accounts"))
        .and_then(|a| a.get("default"))
        .and_then(|m| m.get("botToken"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let skills = list_directories(&format!("{}/.openclaw/workspace/skills", home_dir));

    let mut referenced_providers = std::collections::BTreeSet::new();
    referenced_providers.insert(base_provider.clone());
    for model in &fallback_models_raw {
        if let Some(p) = model.split('/').next() {
            referenced_providers.insert(normalize_provider_for_ui(p));
        }
    }

    let mapped_sandbox = map_loaded_sandbox_mode(
        defaults
            .get("sandbox")
            .and_then(|s| s.get("mode"))
            .and_then(|v| v.as_str()),
    );

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

    let empty_vec = vec![];
    let agent_list = oc_config
        .get("agents")
        .and_then(|a| a.get("list"))
        .and_then(|v| v.as_array())
        .unwrap_or(&empty_vec);
    let mut agent_configs = Vec::new();

    for agent_val in agent_list {
        let aid = agent_val
            .get("id")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();
        if aid.is_empty() || aid == "main" {
            continue;
        }

        let mut name = agent_val
            .get("name")
            .and_then(|s| s.as_str())
            .unwrap_or("Agent")
            .to_string();

        let amodel_raw = if let Some(m_obj) = agent_val.get("model").and_then(|m| m.as_object()) {
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
        let amodel = normalize_model_ref_for_loaded_ui(&amodel_raw, has_local_provider);

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
            .map(|model| normalize_model_ref_for_loaded_ui(model, has_local_provider))
            .collect();

        let agent_workspace_base = format!("{}/.openclaw/agents/{}/workspace", home_dir, aid);

        let aid_md = read_file_content(&format!("{}/IDENTITY.md", agent_workspace_base));
        let au_md = read_file_content(&format!("{}/USER.md", agent_workspace_base));
        let as_md = read_file_content(&format!("{}/SOUL.md", agent_workspace_base));

        let extracted_name = extract_md_value(&aid_md, "Name");
        if !extracted_name.is_empty() {
            name = extracted_name;
        }

        let avibe = extract_md_value(&aid_md, "Vibe");
        let aemoji = extract_md_value(&aid_md, "Emoji");
        let askills = list_directories(&format!("{}/skills", agent_workspace_base));
        let askills_opt = if askills.is_empty() {
            None
        } else {
            Some(askills)
        };

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
        let a_heartbeat_md_s = read_file_content(&format!("{}/HEARTBEAT.md", agent_workspace_base));
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

        // Extract per-agent heartbeat settings
        let (a_heartbeat_mode, a_idle_timeout_ms) =
            if let Some(heartbeat) = agent_val.get("heartbeat") {
                let mode = if let Some(enabled) = heartbeat.get("enabled") {
                    if enabled.as_bool() == Some(false) {
                        Some("never".to_string())
                    } else {
                        None
                    }
                } else if let Some(hb_mode) = heartbeat.get("mode").and_then(|m| m.as_str()) {
                    Some(hb_mode.to_string())
                } else if let Some(every) = heartbeat.get("every").and_then(|e| e.as_str()) {
                    Some(every.to_string())
                } else {
                    None
                };

                let timeout = heartbeat.get("timeout").and_then(|t| t.as_u64());

                (mode, timeout)
            } else {
                (None, None)
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
            heartbeat_mode: a_heartbeat_mode,
            idle_timeout_ms: a_idle_timeout_ms,
            subagents: None,
            tools: agent_val
                .get("tools")
                .and_then(|value| serde_json::from_value(value.clone()).ok()),
        });
        if let Some(agent_provider) = agent_configs.last().and_then(|a| a.model.split('/').next()) {
            referenced_providers.insert(normalize_provider_for_ui(agent_provider));
        }
        if let Some(agent_fallbacks) = agent_configs.last().and_then(|a| a.fallback_models.clone())
        {
            for fallback in agent_fallbacks {
                if let Some(fallback_provider) = fallback.split('/').next() {
                    referenced_providers.insert(normalize_provider_for_ui(fallback_provider));
                }
            }
        }
    }

    let enable_multi_agent = !agent_configs.is_empty();

    let mut provider_auths = std::collections::HashMap::new();
    for referenced_provider in &referenced_providers {
        if let Some(auth) = resolve_provider_auth_data(referenced_provider, &auth_config) {
            provider_auths.insert(referenced_provider.clone(), auth);
        }
    }

    let credentials_dir = std::path::PathBuf::from(&home_dir)
        .join(".openclaw")
        .join("credentials");
    let is_paired = extract_telegram_dm_policy_from_config(&oc_config)
        .map(|policy| telegram_pairing_status_from_dm_policy(&policy))
        .unwrap_or(false)
        || telegram_allow_from_is_linked_local(&credentials_dir);

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

    let memory_enabled = defaults
        .get("compaction")
        .and_then(|c| c.get("memoryFlush"))
        .and_then(|v| {
            if v.is_boolean() {
                v.as_bool()
            } else {
                v.get("enabled").and_then(|e| e.as_bool())
            }
        })
        .unwrap_or(false);

    let meta_str = read_file_content(&format!("{}/.openclaw/clawnetes-meta.json", home_dir));
    let meta: serde_json::Value = serde_json::from_str(&meta_str).unwrap_or(serde_json::json!({}));

    let cron_jobs: Option<Vec<CronJobConfig>> = meta
        .get("cron_jobs")
        .and_then(|c| serde_json::from_value(c.clone()).ok());

    let agent_type = meta
        .get("agent_type")
        .and_then(|v| v.as_str())
        .unwrap_or("custom")
        .to_string();

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
        platform: "openclaw".to_string(),
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
            .or_else(|| {
                oc_config
                    .get("models")
                    .and_then(|m| m.get("providers"))
                    .and_then(|p| p.get("llamacpp"))
                    .and_then(|p| p.get("baseUrl"))
                    .and_then(|v| v.as_str())
            })
            .map(strip_openai_base_url_suffix),
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
        hermes_max_turns: None,
        hermes_reasoning_effort: None,
        hermes_personality: None,
        hermes_terminal_backend: None,
        hermes_memory_enabled: None,
        hermes_verbose: None,
        hermes_smart_routing: None,
        hermes_model_base_url: None,
        hermes_api_server_enabled: None,
        hermes_api_server_key: None,
        hermes_api_server_cors_origins: None,
        hermes_raw_config_yaml: None,
        hermes_raw_env: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AgentData, AgentToolsConfig, ElevatedToolConfig, SubagentConfig};
    use lazy_static::lazy_static;
    use std::sync::Mutex;

    lazy_static! {
        static ref COMPAT_FIXTURE_LOCK: Mutex<()> = Mutex::new(());
    }

    const COMPAT_OPENCLAW_JSON: &str =
        include_str!("../tests/fixtures/openclaw_compat/openclaw.json");
    const COMPAT_MAIN_AUTH_PROFILES: &str =
        include_str!("../tests/fixtures/openclaw_compat/auth-profiles.main.json");
    const COMPAT_SUB_AUTH_PROFILES: &str =
        include_str!("../tests/fixtures/openclaw_compat/auth-profiles.subagent.json");
    const COMPAT_MAIN_IDENTITY: &str =
        include_str!("../tests/fixtures/openclaw_compat/IDENTITY.main.md");
    const COMPAT_MAIN_USER: &str = include_str!("../tests/fixtures/openclaw_compat/USER.main.md");
    const COMPAT_MAIN_SOUL: &str = include_str!("../tests/fixtures/openclaw_compat/SOUL.main.md");
    const COMPAT_SUB_IDENTITY: &str =
        include_str!("../tests/fixtures/openclaw_compat/IDENTITY.sub.md");
    const COMPAT_SUB_USER: &str = include_str!("../tests/fixtures/openclaw_compat/USER.sub.md");
    const COMPAT_SUB_SOUL: &str = include_str!("../tests/fixtures/openclaw_compat/SOUL.sub.md");

    struct CompatEnvGuard {
        original_home: Option<String>,
        original_path: Option<String>,
        root: std::path::PathBuf,
    }

    impl Drop for CompatEnvGuard {
        fn drop(&mut self) {
            if let Some(home) = &self.original_home {
                std::env::set_var("HOME", home);
            } else {
                std::env::remove_var("HOME");
            }

            if let Some(path) = &self.original_path {
                std::env::set_var("PATH", path);
            } else {
                std::env::remove_var("PATH");
            }

            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn replace_fixture_home(input: &str, home: &str) -> String {
        input.replace("__HOME__", home)
    }

    fn write_compat_fixture_tree() -> Result<(std::path::PathBuf, CompatEnvGuard), String> {
        let root = std::env::temp_dir().join(format!(
            "clawnetes-openclaw-compat-{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let openclaw_root = home.join(".openclaw");
        let workspace = openclaw_root.join("workspace");
        let main_agent_dir = openclaw_root.join("agents/main/agent");
        let sub_agent_dir = openclaw_root.join("agents/agent-compat-1/agent");
        let sub_workspace = openclaw_root.join("agents/agent-compat-1/workspace");
        let fake_bin_dir = root.join("bin");

        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&main_agent_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&sub_agent_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&sub_workspace).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(fake_bin_dir.clone()).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(workspace.join("skills/github")).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(sub_workspace.join("skills/web-search"))
            .map_err(|e| e.to_string())?;

        let home_str = home.to_string_lossy().to_string();
        std::fs::write(
            openclaw_root.join("openclaw.json"),
            replace_fixture_home(COMPAT_OPENCLAW_JSON, &home_str),
        )
        .map_err(|e| e.to_string())?;
        std::fs::write(
            main_agent_dir.join("auth-profiles.json"),
            COMPAT_MAIN_AUTH_PROFILES,
        )
        .map_err(|e| e.to_string())?;
        std::fs::write(
            sub_agent_dir.join("auth-profiles.json"),
            COMPAT_SUB_AUTH_PROFILES,
        )
        .map_err(|e| e.to_string())?;
        std::fs::write(workspace.join("IDENTITY.md"), COMPAT_MAIN_IDENTITY)
            .map_err(|e| e.to_string())?;
        std::fs::write(workspace.join("USER.md"), COMPAT_MAIN_USER).map_err(|e| e.to_string())?;
        std::fs::write(workspace.join("SOUL.md"), COMPAT_MAIN_SOUL).map_err(|e| e.to_string())?;
        std::fs::write(sub_workspace.join("IDENTITY.md"), COMPAT_SUB_IDENTITY)
            .map_err(|e| e.to_string())?;
        std::fs::write(sub_workspace.join("USER.md"), COMPAT_SUB_USER)
            .map_err(|e| e.to_string())?;
        std::fs::write(sub_workspace.join("SOUL.md"), COMPAT_SUB_SOUL)
            .map_err(|e| e.to_string())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let fake_openclaw = fake_bin_dir.join("openclaw");
            std::fs::write(&fake_openclaw, "#!/bin/sh\nexit 0\n").map_err(|e| e.to_string())?;
            let mut perms = std::fs::metadata(&fake_openclaw)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&fake_openclaw, perms).map_err(|e| e.to_string())?;
        }

        let original_home = std::env::var("HOME").ok();
        let original_path = std::env::var("PATH").ok();
        let mut new_path = fake_bin_dir.to_string_lossy().to_string();
        if let Some(existing_path) = &original_path {
            new_path.push(':');
            new_path.push_str(existing_path);
        }
        std::env::set_var("HOME", &home_str);
        std::env::set_var("PATH", new_path);

        Ok((
            home,
            CompatEnvGuard {
                original_home,
                original_path,
                root,
            },
        ))
    }

    fn compat_agent_config() -> crate::types::AgentConfig {
        crate::types::AgentConfig {
            platform: Some("openclaw".to_string()),
            provider: "google".to_string(),
            api_key: "".to_string(),
            auth_method: Some("token".to_string()),
            model: "google/gemini-3.1-pro-preview".to_string(),
            user_name: "Compat User".to_string(),
            agent_name: "Compat Main".to_string(),
            agent_vibe: Some("Compatibility first".to_string()),
            telegram_token: Some("fixture-bot-token".to_string()),
            gateway_port: Some(18789),
            gateway_bind: Some("loopback".to_string()),
            gateway_auth_mode: Some("token".to_string()),
            tailscale_mode: Some("off".to_string()),
            node_manager: None,
            skills: Some(vec!["github".to_string()]),
            service_keys: None,
            provider_auths: Some(std::collections::HashMap::from([
                (
                    "google".to_string(),
                    crate::types::ProviderAuthData {
                        auth_method: "token".to_string(),
                        token: "AIza-compat-google".to_string(),
                        profile_key: Some("google:default".to_string()),
                        profile: Some(serde_json::json!({
                            "provider": "google",
                            "token": "AIza-compat-google",
                            "type": "token"
                        })),
                        oauth_provider_id: None,
                    },
                ),
                (
                    "openai".to_string(),
                    crate::types::ProviderAuthData {
                        auth_method: "openai-codex".to_string(),
                        token: "compat-openai-access".to_string(),
                        profile_key: Some("openai-codex:default".to_string()),
                        profile: Some(serde_json::json!({
                            "provider": "openai-codex",
                            "access": "compat-openai-access",
                            "type": "oauth"
                        })),
                        oauth_provider_id: Some("openai-codex".to_string()),
                    },
                ),
            ])),
            sandbox_mode: Some("off".to_string()),
            tools_mode: Some("all".to_string()),
            tools_profile: Some("full".to_string()),
            allowed_tools: Some(vec![]),
            denied_tools: Some(vec![]),
            fallback_models: Some(vec!["openai/gpt-5.4".to_string()]),
            heartbeat_mode: Some("1h".to_string()),
            idle_timeout_ms: None,
            identity_md: Some(COMPAT_MAIN_IDENTITY.to_string()),
            user_md: Some(COMPAT_MAIN_USER.to_string()),
            soul_md: Some(COMPAT_MAIN_SOUL.to_string()),
            agents: Some(vec![crate::types::AgentData {
                id: "agent-compat-1".to_string(),
                name: "Compat Sub".to_string(),
                model: "openai/gpt-5.4".to_string(),
                fallback_models: Some(vec!["google/gemini-3.1-pro-preview".to_string()]),
                skills: Some(vec!["web-search".to_string()]),
                vibe: None,
                emoji: Some("🛠".to_string()),
                identity_md: Some(COMPAT_SUB_IDENTITY.to_string()),
                user_md: Some(COMPAT_SUB_USER.to_string()),
                soul_md: Some(COMPAT_SUB_SOUL.to_string()),
                tools_md: None,
                agents_md: None,
                heartbeat_md: None,
                memory_md: None,
                heartbeat_mode: Some("30m".to_string()),
                idle_timeout_ms: None,
                subagents: None,
                tools: None,
            }]),
            preserve_state: Some(true),
            agent_type: Some("custom".to_string()),
            tools_md: None,
            agents_md: None,
            heartbeat_md: None,
            memory_md: None,
            memory_enabled: Some(false),
            cron_jobs: None,
            local_base_url: None,
            thinking_level: None,
            whatsapp_enabled: Some(false),
            whatsapp_dm_policy: None,
            whatsapp_phone_number: None,
            hermes_max_turns: None,
            hermes_reasoning_effort: None,
            hermes_personality: None,
            hermes_terminal_backend: None,
            hermes_memory_enabled: None,
            hermes_verbose: None,
            hermes_smart_routing: None,
            hermes_model_base_url: None,
            hermes_api_server_enabled: None,
            hermes_api_server_key: None,
            hermes_api_server_cors_origins: None,
            hermes_raw_config_yaml: None,
            hermes_raw_env: None,
            hermes_apply_raw_files: None,
        }
    }

    #[test]
    fn test_apply_agent_overrides_with_tools() {
        let mut agent_obj = serde_json::json!({});
        let agent = AgentData {
            id: "test".to_string(),
            name: "Test".to_string(),
            model: "m".to_string(),
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
            heartbeat_mode: None,
            idle_timeout_ms: None,
            subagents: None,
            tools: Some(AgentToolsConfig {
                profile: Some("custom".to_string()),
                allow: Some(vec!["tool1".to_string()]),
                deny: None,
                elevated: Some(ElevatedToolConfig { enabled: true }),
            }),
        };
        apply_agent_overrides(&mut agent_obj, &agent);
        assert!(agent_obj.get("tools").is_some());
    }

    #[test]
    fn test_apply_agent_overrides_with_subagents() {
        let mut agent_obj = serde_json::json!({});
        let agent = AgentData {
            id: "test".to_string(),
            name: "Test".to_string(),
            model: "m".to_string(),
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
            heartbeat_mode: None,
            idle_timeout_ms: None,
            subagents: Some(SubagentConfig {
                allow_agents: vec!["agent1".to_string()],
            }),
            tools: None,
        };
        apply_agent_overrides(&mut agent_obj, &agent);
        assert!(agent_obj.get("subagents").is_some());
    }

    #[test]
    fn test_merge_auth_profiles_doc_preserves_existing_profiles() {
        let existing = serde_json::json!({
            "version": 1,
            "profiles": {
                "google:default": {
                    "provider": "google",
                    "token": "google-key",
                    "type": "token"
                }
            },
            "lastGood": {
                "google": "google:default"
            },
            "usageStats": {
                "google:default": {
                    "lastUsed": 123
                }
            }
        });
        let generated = serde_json::json!({
            "version": 1,
            "profiles": {
                "openai-codex:default": {
                    "provider": "openai-codex",
                    "type": "oauth",
                    "access": "token"
                }
            },
            "lastGood": {
                "openai": "openai-codex:default"
            },
            "usageStats": {}
        });

        let merged = merge_auth_profiles_doc(&generated, Some(&existing));

        assert!(merged
            .get("profiles")
            .and_then(|value| value.get("google:default"))
            .is_some());
        assert!(merged
            .get("profiles")
            .and_then(|value| value.get("openai-codex:default"))
            .is_some());
        assert_eq!(
            merged
                .get("lastGood")
                .and_then(|value| value.get("google"))
                .and_then(|value| value.as_str()),
            Some("google:default")
        );
        assert_eq!(
            merged
                .get("usageStats")
                .and_then(|value| value.get("google:default"))
                .and_then(|value| value.get("lastUsed"))
                .and_then(|value| value.as_u64()),
            Some(123)
        );
    }

    #[test]
    fn test_recover_provider_auths_from_doc_uses_referenced_provider_profile() {
        let mut provider_auths = std::collections::HashMap::new();
        provider_auths.insert(
            "google".to_string(),
            crate::types::ProviderAuthData {
                auth_method: "token".to_string(),
                token: "".to_string(),
                profile_key: None,
                profile: Some(serde_json::json!({
                    "provider": "google",
                    "type": "token",
                    "token": ""
                })),
                oauth_provider_id: None,
            },
        );
        let referenced_providers =
            std::collections::BTreeSet::from(["google".to_string(), "openai".to_string()]);
        let auth_doc = serde_json::json!({
            "version": 1,
            "profiles": {
                "google:default": {
                    "provider": "google",
                    "type": "token",
                    "token": "AIza-test"
                }
            },
            "lastGood": {
                "google": "google:default"
            }
        });

        recover_provider_auths_from_doc(&mut provider_auths, &referenced_providers, &auth_doc);

        assert_eq!(
            provider_auths.get("google").map(|auth| auth.token.as_str()),
            Some("AIza-test")
        );
        assert!(provider_auths.get("openai").is_none());
    }

    #[test]
    fn test_collect_referenced_remote_providers_prefers_model_refs() {
        let config: AgentConfig = serde_json::from_value(serde_json::json!({
            "provider": "openai",
            "api_key": "",
            "auth_method": "token",
            "model": "google/gemini-3.1-pro-preview",
            "user_name": "User",
            "agent_name": "Agent",
            "agents": [
                {
                    "id": "agent-1",
                    "name": "Sub",
                    "model": "openai/gpt-5.4",
                    "fallback_models": ["ollama/llama3.2"]
                }
            ]
        }))
        .expect("config should deserialize");

        let providers = collect_referenced_remote_providers(&config);

        assert_eq!(
            providers.into_iter().collect::<Vec<_>>(),
            vec!["google".to_string(), "openai".to_string()]
        );
    }

    #[test]
    fn test_openclaw_fixture_loads_with_current_config_parser() {
        let _lock = COMPAT_FIXTURE_LOCK.lock().unwrap();
        let (_home, _guard) = write_compat_fixture_tree().expect("fixture tree should be created");

        let current = get_current_config(None).expect("fixture config should load");

        assert_eq!(current.provider, "google");
        assert_eq!(current.model, "google/gemini-3.1-pro-preview");
        assert_eq!(current.fallback_models, vec!["openai/gpt-5.4".to_string()]);
        assert!(current.enable_multi_agent);
        assert_eq!(current.agent_configs.len(), 1);
        assert_eq!(current.agent_configs[0].model, "openai/gpt-5.4");
        assert_eq!(
            current
                .provider_auths
                .get("google")
                .map(|auth| auth.token.as_str()),
            Some("AIza-compat-google")
        );
        assert_eq!(
            current
                .provider_auths
                .get("openai")
                .and_then(|auth| auth.oauth_provider_id.as_deref()),
            Some("openai-codex")
        );
    }

    #[test]
    fn test_openclaw_fixture_round_trips_without_losing_auth_contract() {
        let _lock = COMPAT_FIXTURE_LOCK.lock().unwrap();
        let (home, _guard) = write_compat_fixture_tree().expect("fixture tree should be created");

        configure_agent(compat_agent_config()).expect("fixture config should be writable");

        let written_openclaw_json = std::fs::read_to_string(home.join(".openclaw/openclaw.json"))
            .expect("openclaw.json should exist");
        let written_openclaw: serde_json::Value =
            serde_json::from_str(&written_openclaw_json).expect("openclaw.json should parse");
        let written_main_auth_json =
            std::fs::read_to_string(home.join(".openclaw/agents/main/agent/auth-profiles.json"))
                .expect("main auth profiles should exist");
        let written_main_auth: serde_json::Value =
            serde_json::from_str(&written_main_auth_json).expect("auth-profiles should parse");
        let written_sub_auth_json = std::fs::read_to_string(
            home.join(".openclaw/agents/agent-compat-1/agent/auth-profiles.json"),
        )
        .expect("subagent auth profiles should exist");
        let written_sub_auth: serde_json::Value =
            serde_json::from_str(&written_sub_auth_json).expect("sub auth should parse");
        let reloaded = get_current_config(None).expect("round-tripped config should still load");

        assert_eq!(
            written_openclaw
                .get("auth")
                .and_then(|value| value.get("profiles"))
                .and_then(|value| value.get("google:default"))
                .and_then(|value| value.get("provider"))
                .and_then(|value| value.as_str()),
            Some("google")
        );
        assert_eq!(
            written_openclaw
                .get("auth")
                .and_then(|value| value.get("profiles"))
                .and_then(|value| value.get("openai-codex:default"))
                .and_then(|value| value.get("provider"))
                .and_then(|value| value.as_str()),
            Some("openai-codex")
        );
        assert_eq!(
            written_main_auth
                .get("profiles")
                .and_then(|value| value.get("google:default"))
                .and_then(|value| value.get("token"))
                .and_then(|value| value.as_str()),
            Some("AIza-compat-google")
        );
        assert_eq!(
            written_main_auth
                .get("lastGood")
                .and_then(|value| value.get("openai"))
                .and_then(|value| value.as_str()),
            Some("openai-codex:default")
        );
        assert_eq!(
            written_sub_auth
                .get("profiles")
                .and_then(|value| value.get("google:default"))
                .and_then(|value| value.get("provider"))
                .and_then(|value| value.as_str()),
            Some("google")
        );
        assert_eq!(reloaded.provider, "google");
        assert_eq!(reloaded.agent_configs[0].model, "openai/gpt-5.4");
        assert_eq!(
            reloaded
                .provider_auths
                .get("openai")
                .and_then(|auth| auth.oauth_provider_id.as_deref()),
            Some("openai-codex")
        );
    }

    #[test]
    fn test_get_current_config_loads_backup_style_custom_local_provider() {
        let _lock = COMPAT_FIXTURE_LOCK.lock().unwrap();
        let (home, _guard) = write_compat_fixture_tree().expect("fixture tree should be created");

        let home_str = home.to_string_lossy().to_string();
        let openclaw_root = home.join(".openclaw");
        let local_fixture = serde_json::json!({
            "auth": {
                "profiles": {
                    "local:default": {
                        "provider": "local",
                        "mode": "token"
                    }
                }
            },
            "models": {
                "providers": {
                    "llamacpp": {
                        "baseUrl": "http://127.0.0.1:8080/v1",
                        "api": "openai-completions",
                        "models": [
                            { "id": "unsloth/gemma-4-e4b-it-gguf:Q4_K_XL", "name": "Gemma" }
                        ]
                    }
                }
            },
            "agents": {
                "defaults": {
                    "workspace": format!("{}/.openclaw/workspace", home_str),
                    "model": {
                        "primary": "unsloth/gemma-4-e4b-it-gguf:Q4_K_XL",
                        "fallbacks": ["google/gemini-3.1-pro-preview"]
                    },
                    "models": {
                        "unsloth/gemma-4-e4b-it-gguf:Q4_K_XL": {},
                        "google/gemini-3.1-pro-preview": {}
                    }
                },
                "list": [
                    {
                        "id": "main",
                        "name": "Local Main",
                        "workspace": format!("{}/.openclaw/workspace", home_str),
                        "agentDir": format!("{}/.openclaw/agents/main/agent", home_str),
                        "model": {
                            "primary": "unsloth/gemma-4-e4b-it-gguf:Q4_K_XL"
                        }
                    }
                ]
            }
        });

        std::fs::write(
            openclaw_root.join("openclaw.json"),
            serde_json::to_string_pretty(&local_fixture).expect("fixture json"),
        )
        .expect("should write local fixture");
        std::fs::write(
            openclaw_root.join("agents/main/agent/auth-profiles.json"),
            serde_json::json!({
                "version": 1,
                "profiles": {
                    "local:default": {
                        "provider": "local",
                        "token": "dummy-token",
                        "type": "token",
                        "api": "openai",
                        "baseUrl": "http://127.0.0.1:8080"
                    }
                },
                "lastGood": {
                    "local": "local:default"
                }
            })
            .to_string(),
        )
        .expect("should write local auth profiles");

        let current = get_current_config(None).expect("local fixture should load");

        assert_eq!(current.provider, "local");
        assert_eq!(current.model, "local/unsloth/gemma-4-e4b-it-gguf:Q4_K_XL");
        assert_eq!(
            current.fallback_models,
            vec!["google/gemini-3.1-pro-preview".to_string()]
        );
        assert_eq!(
            current.local_base_url.as_deref(),
            Some("http://127.0.0.1:8080")
        );
    }

    #[test]
    fn test_configure_agent_writes_custom_local_provider_in_backup_style_shape() {
        let _lock = COMPAT_FIXTURE_LOCK.lock().unwrap();
        let (home, _guard) = write_compat_fixture_tree().expect("fixture tree should be created");

        let local_config = crate::types::AgentConfig {
            platform: Some("openclaw".to_string()),
            provider: "local".to_string(),
            api_key: "".to_string(),
            auth_method: Some("token".to_string()),
            model: "local/unsloth/gemma-4-e4b-it-gguf:Q4_K_XL".to_string(),
            user_name: "Local User".to_string(),
            agent_name: "Local Main".to_string(),
            agent_vibe: Some("Local first".to_string()),
            telegram_token: None,
            gateway_port: Some(18789),
            gateway_bind: Some("loopback".to_string()),
            gateway_auth_mode: Some("token".to_string()),
            tailscale_mode: Some("off".to_string()),
            node_manager: None,
            skills: Some(vec![]),
            service_keys: None,
            provider_auths: Some(std::collections::HashMap::from([(
                "local".to_string(),
                crate::types::ProviderAuthData {
                    auth_method: "token".to_string(),
                    token: "dummy-token".to_string(),
                    profile_key: Some("local:default".to_string()),
                    profile: Some(serde_json::json!({
                        "provider": "local",
                        "token": "dummy-token",
                        "type": "token",
                        "api": "openai",
                        "baseUrl": "http://localhost:8080"
                    })),
                    oauth_provider_id: None,
                },
            )])),
            sandbox_mode: Some("off".to_string()),
            tools_mode: Some("all".to_string()),
            tools_profile: Some("full".to_string()),
            allowed_tools: Some(vec![]),
            denied_tools: Some(vec![]),
            fallback_models: Some(vec!["google/gemini-3.1-pro-preview".to_string()]),
            heartbeat_mode: Some("1h".to_string()),
            idle_timeout_ms: None,
            identity_md: Some("# IDENTITY.md - Who Am I?\n- **Name:** Local Main\n- **Emoji:** 🦞\n---\nManaged by Clawnetes.".to_string()),
            user_md: Some("# USER.md - About Your Human\n- **Name:** Local User\n---".to_string()),
            soul_md: Some("# SOUL.md\n## Mission\nServe Local User.".to_string()),
            agents: None,
            preserve_state: Some(true),
            agent_type: Some("custom".to_string()),
            tools_md: None,
            agents_md: None,
            heartbeat_md: None,
            memory_md: None,
            memory_enabled: Some(false),
            cron_jobs: None,
            local_base_url: Some("http://localhost:8080".to_string()),
            thinking_level: None,
            whatsapp_enabled: Some(false),
            whatsapp_dm_policy: None,
            whatsapp_phone_number: None,
            hermes_max_turns: None,
            hermes_reasoning_effort: None,
            hermes_personality: None,
            hermes_terminal_backend: None,
            hermes_memory_enabled: None,
            hermes_verbose: None,
            hermes_smart_routing: None,
            hermes_model_base_url: None,
            hermes_api_server_enabled: None,
            hermes_api_server_key: None,
            hermes_api_server_cors_origins: None,
            hermes_raw_config_yaml: None,
            hermes_raw_env: None,
            hermes_apply_raw_files: None,
        };

        configure_agent(local_config).expect("local config should be writable");

        let written_openclaw_json = std::fs::read_to_string(home.join(".openclaw/openclaw.json"))
            .expect("openclaw.json should exist");
        let written_openclaw: serde_json::Value =
            serde_json::from_str(&written_openclaw_json).expect("openclaw.json should parse");
        let reloaded = get_current_config(None).expect("round-tripped local config should load");

        assert_eq!(
            written_openclaw
                .get("agents")
                .and_then(|value| value.get("defaults"))
                .and_then(|value| value.get("model"))
                .and_then(|value| value.get("primary"))
                .and_then(|value| value.as_str()),
            Some("llamacpp/unsloth/gemma-4-e4b-it-gguf:Q4_K_XL")
        );
        assert_eq!(
            written_openclaw
                .get("models")
                .and_then(|value| value.get("providers"))
                .and_then(|value| value.get("llamacpp"))
                .and_then(|value| value.get("baseUrl"))
                .and_then(|value| value.as_str()),
            Some("http://localhost:8080/v1")
        );
        assert_eq!(
            written_openclaw
                .get("models")
                .and_then(|value| value.get("providers"))
                .and_then(|value| value.get("llamacpp"))
                .and_then(|value| value.get("models"))
                .and_then(|value| value.as_array())
                .and_then(|value| value.first())
                .and_then(|value| value.get("id"))
                .and_then(|value| value.as_str()),
            Some("unsloth/gemma-4-e4b-it-gguf:Q4_K_XL")
        );

        let written_auth_profiles =
            std::fs::read_to_string(home.join(".openclaw/agents/main/agent/auth-profiles.json"))
                .expect("auth-profiles.json should exist");
        let written_auth_profiles: serde_json::Value =
            serde_json::from_str(&written_auth_profiles).expect("auth profiles should parse");
        assert!(written_auth_profiles
            .get("profiles")
            .and_then(|value| value.get("llamacpp:default"))
            .is_some());
        assert!(written_auth_profiles
            .get("profiles")
            .and_then(|value| value.get("google:default"))
            .and_then(|value| value.get("baseUrl"))
            .is_none());

        assert_eq!(reloaded.provider, "local");
        assert_eq!(reloaded.model, "local/unsloth/gemma-4-e4b-it-gguf:Q4_K_XL");
        assert_eq!(
            reloaded.local_base_url.as_deref(),
            Some("http://localhost:8080")
        );
    }

    #[test]
    fn test_configure_agent_does_not_shell_mutate_openclaw_json_after_write() {
        let _lock = COMPAT_FIXTURE_LOCK.lock().unwrap();
        let (home, _guard) = write_compat_fixture_tree().expect("fixture tree should be created");

        let fake_bin_dir = home
            .parent()
            .expect("home should have test root")
            .join("bin");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let fake_openclaw = fake_bin_dir.join("openclaw");
            std::fs::write(
                &fake_openclaw,
                format!(
                    "#!/bin/sh\nif [ \"$1\" = \"config\" ] && [ \"$2\" = \"set\" ]; then printf '\\n}}' >> \"$HOME/.openclaw/openclaw.json\"; fi\nexit 0\n"
                ),
            )
            .expect("should overwrite fake openclaw");
            let mut perms = std::fs::metadata(&fake_openclaw)
                .expect("fake openclaw metadata")
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&fake_openclaw, perms).expect("should chmod fake openclaw");
        }

        configure_agent(compat_agent_config()).expect("fixture config should still be writable");

        let written_openclaw_json = std::fs::read_to_string(home.join(".openclaw/openclaw.json"))
            .expect("openclaw.json should exist");
        serde_json::from_str::<serde_json::Value>(&written_openclaw_json)
            .expect("openclaw.json should remain valid JSON");
    }

    #[test]
    fn test_get_current_config_loads_provider_auths_referenced_only_by_subagent_models() {
        let _lock = COMPAT_FIXTURE_LOCK.lock().unwrap();
        let (home, _guard) = write_compat_fixture_tree().expect("fixture tree should be created");

        let home_str = home.to_string_lossy().to_string();
        let openclaw_root = home.join(".openclaw");
        let main_agent_dir = openclaw_root.join("agents/main/agent");

        let subagent_only_provider_fixture = serde_json::json!({
            "auth": {
                "profiles": {
                    "google:default": {
                        "provider": "google",
                        "mode": "token"
                    },
                    "openai-codex:default": {
                        "provider": "openai-codex",
                        "mode": "oauth"
                    }
                }
            },
            "agents": {
                "defaults": {
                    "workspace": format!("{}/.openclaw/workspace", home_str),
                    "model": {
                        "primary": "openai/gpt-5.4"
                    },
                    "models": {
                        "openai/gpt-5.4": {}
                    }
                },
                "list": [
                    {
                        "id": "main",
                        "name": "Compat Main",
                        "workspace": format!("{}/.openclaw/workspace", home_str),
                        "agentDir": format!("{}/.openclaw/agents/main/agent", home_str),
                        "model": {
                            "primary": "openai/gpt-5.4"
                        }
                    },
                    {
                        "id": "agent-compat-1",
                        "name": "Compat Sub",
                        "workspace": format!("{}/.openclaw/agents/agent-compat-1/workspace", home_str),
                        "agentDir": format!("{}/.openclaw/agents/agent-compat-1/agent", home_str),
                        "model": {
                            "primary": "google/gemini-3.1-pro-preview"
                        }
                    }
                ]
            }
        });
        std::fs::write(
            openclaw_root.join("openclaw.json"),
            serde_json::to_string_pretty(&subagent_only_provider_fixture).expect("fixture json"),
        )
        .expect("should write fixture openclaw.json");
        std::fs::write(
            main_agent_dir.join("auth-profiles.json"),
            serde_json::json!({
                "version": 1,
                "profiles": {
                    "google:default": {
                        "provider": "google",
                        "token": "AIza-subagent-only",
                        "type": "token"
                    },
                    "openai-codex:default": {
                        "provider": "openai-codex",
                        "access": "openai-access",
                        "type": "oauth"
                    }
                },
                "lastGood": {
                    "google": "google:default",
                    "openai": "openai-codex:default"
                }
            })
            .to_string(),
        )
        .expect("should write auth profiles");

        let current = get_current_config(None).expect("fixture config should load");

        assert_eq!(current.provider, "openai");
        assert_eq!(current.model, "openai/gpt-5.4");
        assert_eq!(
            current.agent_configs[0].model,
            "google/gemini-3.1-pro-preview"
        );
        assert_eq!(
            current
                .provider_auths
                .get("google")
                .map(|auth| auth.token.as_str()),
            Some("AIza-subagent-only")
        );
    }

    #[test]
    fn test_build_agent_session_init_command() {
        let cmd = build_agent_session_init_command("agent-1");
        assert!(cmd.contains("--agent agent-1"));
        assert!(cmd.contains("--message"));
    }

    #[test]
    fn test_map_loaded_sandbox_mode_preserves_explicit_values() {
        assert_eq!(map_loaded_sandbox_mode(Some("all")), "full");
        assert_eq!(map_loaded_sandbox_mode(Some("non-main")), "partial");
        assert_eq!(map_loaded_sandbox_mode(Some("off")), "none");
        assert_eq!(map_loaded_sandbox_mode(Some("full")), "full");
        assert_eq!(map_loaded_sandbox_mode(Some("partial")), "partial");
        assert_eq!(map_loaded_sandbox_mode(Some("none")), "none");
    }

    #[test]
    fn test_map_loaded_sandbox_mode_defaults_missing_and_unknown_to_none() {
        assert_eq!(map_loaded_sandbox_mode(None), "none");
        assert_eq!(map_loaded_sandbox_mode(Some("unexpected")), "none");
    }
}
