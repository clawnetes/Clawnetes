use rand::Rng;
use tokio::time::{sleep, Duration};

use crate::config::{apply_agent_overrides, build_agent_session_init_command};
use crate::error::ClawError;
use crate::executor::{CommandExecutor, SshExecutor};
use crate::oauth::{
    apply_model_provider_auth, auth_provider_id_for_config, build_auth_profiles_doc,
    build_effective_models_catalog, collect_required_plugin_ids, default_provider_auth,
    get_provider_auth_map, merge_enabled_plugin_entries, normalize_auth_mode, resolve_profile_name,
};
use crate::ssh::get_env_prefix;
use crate::system::shell_single_quote;
use crate::types::AgentConfig;

fn random_token() -> String {
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn read_remote_json(executor: &impl CommandExecutor, openclaw_root: &str) -> serde_json::Value {
    executor
        .read_file(&format!("{}/openclaw.json", openclaw_root))
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn write_markdown_file(
    executor: &impl CommandExecutor,
    path: &str,
    content: Option<&String>,
    fallback: impl FnOnce() -> String,
) -> Result<(), ClawError> {
    let value = content.cloned().unwrap_or_else(fallback);
    executor.write_file(path, &value)
}

pub async fn setup_remote_openclaw(
    remote: &crate::types::RemoteInfo,
    config: AgentConfig,
) -> Result<String, ClawError> {
    let executor = SshExecutor::connect(remote)?;

    let os_type = executor.run("uname -s")?.trim().to_string();
    let is_root = executor.run("id -u")?.trim() == "0";
    let sudo_prefix = if is_root { "" } else { "sudo " };
    let nvm_prefix = get_env_prefix(&os_type);

    if os_type == "Linux" && executor.run("node -v").is_err() {
        let install_curl = format!(
            "{}apt-get update && {}apt-get install -y curl",
            sudo_prefix, sudo_prefix
        );
        executor
            .run(&install_curl)
            .map_err(|e| ClawError::System(format!("Failed to install curl: {}", e)))?;

        let setup_cmd = if is_root {
            "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
        } else {
            "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
        };
        executor
            .run(setup_cmd)
            .map_err(|e| ClawError::System(format!("Failed to setup NodeSource: {}", e)))?;

        let install_node = format!("{}apt-get install -y nodejs", sudo_prefix);
        executor
            .run(&install_node)
            .map_err(|e| ClawError::System(format!("Failed to install Node.js: {}", e)))?;
    } else if os_type == "Darwin" && executor.run("node -v").is_err() {
        if executor.run("command -v brew").is_err() {
            let install_brew = "NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"";
            executor
                .run(install_brew)
                .map_err(|e| ClawError::System(format!("Failed to install Homebrew: {}", e)))?;

            let configure_shell = r#"
                (echo; echo 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"') >> $HOME/.zprofile
                (echo; echo 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"') >> $HOME/.bash_profile
             "#;
            let _ = executor.run(configure_shell);
        }

        let install_node = "eval \"$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)\"; brew install node";
        executor.run(install_node).map_err(|e| {
            ClawError::System(format!("Failed to install Node.js via Homebrew: {}", e))
        })?;
    }

    let check_claw_cmd = if os_type == "Linux" {
        "export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; openclaw --version".to_string()
    } else {
        "eval \"$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)\"; openclaw --version".to_string()
    };

    if executor.run(&check_claw_cmd).is_err() {
        let install_claw_cmd = if os_type == "Linux" {
            format!("{}npm install -g openclaw", sudo_prefix)
        } else {
            "eval \"$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)\"; npm install -g openclaw".to_string()
        };
        executor
            .run(&install_claw_cmd)
            .map_err(|e| ClawError::System(format!("Failed to install OpenClaw: {}", e)))?;
    }

    executor.run(&check_claw_cmd)?;

    let remote_home = executor.home_dir()?;
    let openclaw_root = format!("{}/.openclaw", remote_home);
    let workspace = format!("{}/workspace", openclaw_root);
    let agents_dir = format!("{}/agents/main/agent", openclaw_root);

    if config.preserve_state != Some(true) {
        let _ = executor.run(&format!("{}openclaw gateway stop || true", nvm_prefix));
        let _ = executor.run(&format!(
            "{}openclaw gateway install --force --profile messaging",
            nvm_prefix
        ));
        let _ = executor.run(&format!("{}openclaw gateway stop || true", nvm_prefix));
    }

    executor.mkdir_p(&workspace)?;
    executor.mkdir_p(&agents_dir)?;

    let existing_config = read_remote_json(&executor, &openclaw_root);
    let gateway_token = existing_config
        .get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(str::to_string)
        .unwrap_or_else(random_token);

    let telegram_default = existing_config
        .get("channels")
        .and_then(|c| c.get("telegram"))
        .and_then(|t| t.get("accounts"))
        .and_then(|a| a.get("default"))
        .cloned();
    let whatsapp_default = existing_config
        .get("channels")
        .and_then(|c| c.get("whatsapp"))
        .and_then(|t| t.get("accounts"))
        .and_then(|a| a.get("default"))
        .cloned();

    let telegram_allow_from = telegram_default
        .as_ref()
        .and_then(|d| d.get("allowFrom"))
        .cloned();
    let telegram_dm_policy = telegram_default
        .as_ref()
        .and_then(|d| d.get("dmPolicy"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let whatsapp_allow_from = whatsapp_default
        .as_ref()
        .and_then(|d| d.get("allowFrom"))
        .cloned();

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
    let gateway_bind = config
        .gateway_bind
        .unwrap_or_else(|| "loopback".to_string());
    let gateway_auth_mode = config
        .gateway_auth_mode
        .unwrap_or_else(|| "token".to_string());
    let tailscale_mode = config.tailscale_mode.unwrap_or_else(|| "off".to_string());

    let mut defaults_obj = serde_json::json!({
        "maxConcurrent": 4,
        "subagents": { "maxConcurrent": 8 },
        "compaction": { "mode": "safeguard" },
        "workspace": workspace,
        "model": { "primary": effective_primary_model },
        "models": build_effective_models_catalog(&effective_primary_model, &effective_fallback_models)
    });

    if !effective_fallback_models.is_empty() {
        if let Some(primary) = defaults_obj
            .get_mut("model")
            .and_then(|m| m.as_object_mut())
        {
            primary.insert(
                "fallbacks".to_string(),
                serde_json::to_value(&effective_fallback_models)?,
            );
        }
    }

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

    if let Some(sb_mode) = config.sandbox_mode.as_deref() {
        let mapped = match sb_mode {
            "full" => "all",
            "partial" => "non-main",
            "none" => "off",
            _ => sb_mode,
        };
        if let Some(obj) = defaults_obj.as_object_mut() {
            obj.insert("sandbox".to_string(), serde_json::json!({ "mode": mapped }));
        }
    }

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
                            serde_json::to_value(effective_agent_fallbacks)?,
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
                    serde_json::to_value(&effective_fallback_models)?,
                );
            }
        }

        agents_list.insert(0, main_obj);
    }

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

    merge_enabled_plugin_entries(&mut config_val, &required_plugin_ids);

    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            merge_enabled_plugin_entries(&mut config_val, &["telegram".to_string()]);
            if let Some(obj) = config_val.as_object_mut() {
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

    if config.whatsapp_enabled.unwrap_or(false) {
        let dm_policy = config.whatsapp_dm_policy.as_deref().unwrap_or("open");
        merge_enabled_plugin_entries(&mut config_val, &["whatsapp".to_string()]);
        if let Some(obj) = config_val.as_object_mut() {
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
            tools_obj.insert("allow".to_string(), serde_json::to_value(tools)?);
        }
        if let Some(tools) = config.denied_tools.as_ref() {
            tools_obj.insert("deny".to_string(), serde_json::to_value(tools)?);
        }
        if !tools_obj.is_empty() {
            if let Some(obj) = config_val.as_object_mut() {
                obj.insert("tools".to_string(), serde_json::Value::Object(tools_obj));
            }
        }
    }

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

    if let Some(cron_jobs) = &config.cron_jobs {
        if !cron_jobs.is_empty() {
            if let Some(obj) = config_val.as_object_mut() {
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
                    let stripped_model = stripped.to_string();
                    if !model_ids.contains(&stripped_model) {
                        model_ids.push(stripped_model);
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

    executor.write_file(
        &format!("{}/openclaw.json", openclaw_root),
        &serde_json::to_string_pretty(&config_val)?,
    )?;

    let _ = executor.run(&format!(
        "{}openclaw config set gateway.auth.token {}",
        nvm_prefix,
        shell_single_quote(&gateway_token)
    ));

    let mut meta = serde_json::Map::new();
    if let Some(agent_type) = &config.agent_type {
        meta.insert(
            "agent_type".to_string(),
            serde_json::Value::String(agent_type.clone()),
        );
    }
    if let Some(cron_jobs) = &config.cron_jobs {
        if !cron_jobs.is_empty() {
            meta.insert("cron_jobs".to_string(), serde_json::to_value(cron_jobs)?);
        }
    }
    if config.memory_enabled.unwrap_or(false) {
        meta.insert("memory_enabled".to_string(), serde_json::Value::Bool(true));
    }
    executor.write_file(
        &format!("{}/clawnetes-meta.json", openclaw_root),
        &serde_json::to_string_pretty(&meta)?,
    )?;

    let auth_profiles_val = build_auth_profiles_doc(
        &provider_auths,
        config.fallback_models.as_ref(),
        config.local_base_url.as_ref(),
        &config.provider,
    );
    executor.write_file(
        &format!("{}/auth-profiles.json", agents_dir),
        &serde_json::to_string_pretty(&auth_profiles_val)?,
    )?;

    write_markdown_file(
        &executor,
        &format!("{}/IDENTITY.md", workspace),
        config.identity_md.as_ref(),
        || {
            format!(
                "# IDENTITY.md - Who Am I?\n- **Name:** {}\n- **Emoji:** 🦞\n---\nManaged by Clawnetes.",
                config.agent_name
            )
        },
    )?;
    write_markdown_file(
        &executor,
        &format!("{}/USER.md", workspace),
        config.user_md.as_ref(),
        || {
            format!(
                "# USER.md - About Your Human\n- **Name:** {}\n---",
                config.user_name
            )
        },
    )?;
    write_markdown_file(
        &executor,
        &format!("{}/SOUL.md", workspace),
        config.soul_md.as_ref(),
        || format!("# SOUL.md\n## Mission\nServe {}.", config.user_name),
    )?;

    if let Some(ref tools_md) = config.tools_md {
        executor.write_file(&format!("{}/TOOLS.md", workspace), tools_md)?;
    }
    if let Some(ref agents_md) = config.agents_md {
        executor.write_file(&format!("{}/AGENTS.md", workspace), agents_md)?;
    }
    if let Some(ref heartbeat_md) = config.heartbeat_md {
        executor.write_file(&format!("{}/HEARTBEAT.md", workspace), heartbeat_md)?;
    }
    if let Some(ref memory_md) = config.memory_md {
        executor.write_file(&format!("{}/MEMORY.md", workspace), memory_md)?;
    }

    if let Some(nm) = config.node_manager {
        let _ = executor.run(&format!(
            "{}openclaw config set skills.nodeManager {}",
            nvm_prefix, nm
        ));
    }

    if let Some(ref token) = config.telegram_token {
        if !token.is_empty() {
            let _ = executor.run(&format!("{}openclaw plugins enable telegram", nvm_prefix));
        }
    }

    for plugin_id in &required_plugin_ids {
        let _ = executor.run(&format!(
            "{}openclaw plugins enable {}",
            nvm_prefix,
            shell_single_quote(plugin_id)
        ));
    }

    if let Some(skills) = &config.skills {
        for skill in skills {
            let _ = executor.run(&format!(
                "{}npx clawhub install {}",
                nvm_prefix,
                shell_single_quote(skill)
            ));
        }
    }

    if let Some(agents) = &config.agents {
        for agent in agents {
            let agent_workspace = format!("{}/agents/{}/workspace", openclaw_root, agent.id);
            let agent_config_dir = format!("{}/agents/{}/agent", openclaw_root, agent.id);

            executor.mkdir_p(&agent_workspace)?;
            executor.mkdir_p(&agent_config_dir)?;

            write_markdown_file(
                &executor,
                &format!("{}/IDENTITY.md", agent_workspace),
                agent.identity_md.as_ref(),
                || {
                    format!(
                        "# IDENTITY.md - Who Am I?\n- **Name:** {}\n- **Emoji:** 🦞\n---\nManaged by Clawnetes.",
                        agent.name
                    )
                },
            )?;
            write_markdown_file(
                &executor,
                &format!("{}/USER.md", agent_workspace),
                agent.user_md.as_ref(),
                || {
                    format!(
                        "# USER.md - About Your Human\n- **Name:** {}\n---",
                        config.user_name
                    )
                },
            )?;
            write_markdown_file(
                &executor,
                &format!("{}/SOUL.md", agent_workspace),
                agent.soul_md.as_ref(),
                || format!("# SOUL.md\n## Mission\nServe {}.", config.user_name),
            )?;
            executor.run(&format!(
                "cp {}/auth-profiles.json {}/auth-profiles.json",
                agents_dir, agent_config_dir
            ))?;
        }
    }

    let _ = executor.run(&format!(
        "{}openclaw doctor --fix --yes || true",
        nvm_prefix
    ));
    let _ =
        executor.run("systemctl --user reset-failed openclaw-gateway.service 2>/dev/null || true");
    executor.run(&format!("{}openclaw gateway stop || true", nvm_prefix))?;
    executor.run(&format!("{}openclaw gateway start", nvm_prefix))?;

    if let Some(agents) = &config.agents {
        sleep(Duration::from_secs(3)).await;
        for agent in agents {
            if agent.id == "main" {
                continue;
            }
            let cmd = format!(
                "{}{}",
                nvm_prefix,
                build_agent_session_init_command(&agent.id)
            );
            let _ = executor.run(&cmd);
            sleep(Duration::from_secs(1)).await;
        }
    }

    Ok(gateway_token)
}

pub async fn apply_agent_config(
    remote: &crate::types::RemoteInfo,
    config: AgentConfig,
) -> Result<String, ClawError> {
    let executor = SshExecutor::connect(remote)?;
    let home = executor.run("echo $HOME")?.trim().to_string();
    let openclaw_root = format!("{}/.openclaw", home);

    // Read existing openclaw.json
    let mut config_json = read_remote_json(&executor, &openclaw_root);

    // If config has agents, update agents list in openclaw.json
    if let Some(agents) = &config.agents {
        if let Some(obj) = config_json.as_object_mut() {
            if let Some(agents_entry) = obj.get_mut("agents") {
                if let Some(agents_obj) = agents_entry.as_object_mut() {
                    let mut agents_list = Vec::new();

                    for agent in agents {
                        let mut agent_obj = serde_json::json!({
                            "id": agent.id,
                            "name": agent.name,
                            "workspace": format!("{}/.openclaw/agents/{}/workspace", home, agent.id),
                            "agentDir": format!("{}/.openclaw/agents/{}/agent", home, agent.id),
                            "model": {
                                "primary": agent.model
                            }
                        });

                        if let Some(fb) = &agent.fallback_models {
                            if !fb.is_empty() {
                                if let Some(model_obj) =
                                    agent_obj.get_mut("model").and_then(|m| m.as_object_mut())
                                {
                                    model_obj.insert(
                                        "fallbacks".to_string(),
                                        serde_json::to_value(fb).unwrap(),
                                    );
                                }
                            }
                        }

                        // Apply per-agent overrides (tools, heartbeat, subagents)
                        apply_agent_overrides(&mut agent_obj, agent);
                        agents_list.push(agent_obj);
                    }

                    agents_obj.insert("list".to_string(), serde_json::json!(agents_list));
                }
            }
        }
    }

    // Write updated openclaw.json back to remote
    let config_json_str = serde_json::to_string_pretty(&config_json)
        .map_err(|e| ClawError::System(format!("Failed to serialize config: {}", e)))?;
    executor.write_file(&format!("{}/openclaw.json", openclaw_root), &config_json_str)?;

    Ok("Agent configuration updated on remote.".into())
}
