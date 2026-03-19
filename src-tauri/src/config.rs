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
use crate::system::{shell_command, shell_single_quote};
use crate::types::{AgentConfig, AgentData, CronJobConfig, CurrentConfig};

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
}

pub fn build_agent_session_init_command(agent_id: &str) -> String {
    format!(
        "openclaw agent --agent {} --message \"hello\" 2>/dev/null || true",
        agent_id
    )
}

pub fn read_workspace_files() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::system::{wsl_home_dir, wsl_read_file};
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

pub fn save_workspace_files(
    agent_id: Option<&str>,
    identity: &str,
    user: &str,
    soul: &str,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::system::{wsl_home_dir, wsl_mkdir_p, wsl_write_file};
        let home = wsl_home_dir()?.trim().to_string();
        let workspace = if let Some(id) = agent_id {
            format!("{}/.openclaw/agents/{}/workspace", home, id)
        } else {
            format!("{}/.openclaw/workspace", home)
        };

        wsl_mkdir_p(&workspace)?;

        wsl_write_file(&format!("{}/IDENTITY.md", workspace), identity)?;
        wsl_write_file(&format!("{}/USER.md", workspace), user)?;
        wsl_write_file(&format!("{}/SOUL.md", workspace), soul)?;

        Ok("Workspace files saved successfully".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = dirs::home_dir().ok_or("Could not find home directory")?;

        let workspace = if let Some(id) = agent_id {
            home.join(".openclaw")
                .join("agents")
                .join(id)
                .join("workspace")
        } else {
            home.join(".openclaw").join("workspace")
        };

        fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;

        fs::write(workspace.join("IDENTITY.md"), identity).map_err(|e| e.to_string())?;
        fs::write(workspace.join("USER.md"), user).map_err(|e| e.to_string())?;
        fs::write(workspace.join("SOUL.md"), soul).map_err(|e| e.to_string())?;

        Ok("Workspace files saved successfully".to_string())
    }
}

pub fn create_custom_skill(name: &str, content: &str) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::system::{wsl_home_dir, wsl_mkdir_p, wsl_write_file};
        let home = wsl_home_dir()?.trim().to_string();
        let skill_dir = format!("{}/.openclaw/workspace/skills/{}", home, name);

        wsl_mkdir_p(&skill_dir)?;
        wsl_write_file(&format!("{}/SKILL.md", skill_dir), content)?;

        Ok(format!("Custom skill '{}' created successfully", name))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = dirs::home_dir().ok_or("Could not find home directory")?;
        let skill_dir = home
            .join(".openclaw")
            .join("workspace")
            .join("skills")
            .join(name);

        fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
        fs::write(skill_dir.join("SKILL.md"), content).map_err(|e| e.to_string())?;

        Ok(format!("Custom skill '{}' created successfully", name))
    }
}

pub fn validate_openclaw_config(
    remote: Option<&crate::types::RemoteInfo>,
    is_wsl: Option<bool>,
) -> Result<String, String> {
    use crate::system::shell_command;
    if let Some(r) = remote {
        let sess =
            crate::ssh::connect_ssh(r).map_err(|e| format!("SSH connect failed: {}", e))?;
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
                    serde_json::json!({ "primary": effective_primary_model }),
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
        let profile = serde_json::json!({
            "provider": primary_auth_provider,
            "mode": auth_mode
        });

        profiles.insert(profile_name.clone(), profile);
    }

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

    let _ = shell_command(&format!(
        "openclaw config set gateway.auth.token {}",
        shell_single_quote(&gateway_token)
    ));

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

pub fn get_current_config(remote: Option<&crate::types::RemoteInfo>) -> Result<CurrentConfig, String> {
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
            if let Ok(output) = crate::ssh::execute_ssh(sess, &format!("ls -1 -F \"{}\"", base_path)) {
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

            let mut name = agent_val
                .get("name")
                .and_then(|s| s.as_str())
                .unwrap_or("Agent")
                .to_string();

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
                .and_then(|m| if m.is_object() { m.get("fallbacks") } else { None })
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let afallbacks: Vec<String> = afallbacks_raw
                .iter()
                .map(|model| normalize_model_ref_for_ui(model))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AgentData, AgentToolsConfig, ElevatedToolConfig, SubagentConfig};

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
            subagents: Some(SubagentConfig {
                allow_agents: vec!["agent1".to_string()],
            }),
            tools: None,
        };
        apply_agent_overrides(&mut agent_obj, &agent);
        assert!(agent_obj.get("subagents").is_some());
    }

    #[test]
    fn test_build_agent_session_init_command() {
        let cmd = build_agent_session_init_command("agent-1");
        assert!(cmd.contains("--agent agent-1"));
        assert!(cmd.contains("--message"));
    }
}
