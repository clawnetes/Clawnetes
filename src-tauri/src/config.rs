use std::fs;

use crate::types::AgentData;

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
