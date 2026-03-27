use std::collections::HashMap;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct AgentData {
    pub id: String,
    pub name: String,
    pub model: String,
    pub fallback_models: Option<Vec<String>>,
    pub skills: Option<Vec<String>>,
    pub vibe: Option<String>,
    pub emoji: Option<String>,
    pub identity_md: Option<String>,
    pub user_md: Option<String>,
    pub soul_md: Option<String>,
    pub tools_md: Option<String>,
    pub agents_md: Option<String>,
    pub heartbeat_md: Option<String>,
    pub memory_md: Option<String>,
    pub heartbeat_mode: Option<String>,
    pub idle_timeout_ms: Option<u64>,
    pub subagents: Option<SubagentConfig>,
    pub tools: Option<AgentToolsConfig>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SubagentConfig {
    #[serde(rename = "allowAgents")]
    pub allow_agents: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct AgentToolsConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deny: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elevated: Option<ElevatedToolConfig>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ElevatedToolConfig {
    pub enabled: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct CronJobConfig {
    pub name: String,
    pub schedule: String,
    pub command: String,
    pub session: Option<String>,
}

#[derive(serde::Serialize)]
pub struct CurrentConfig {
    pub provider: String,
    pub api_key: String,
    pub auth_method: String,
    pub model: String,
    pub user_name: String,
    pub agent_name: String,
    pub agent_vibe: String,
    pub agent_emoji: String,
    pub agent_type: String,
    pub telegram_token: String,
    pub gateway_port: u16,
    pub gateway_bind: String,
    pub gateway_auth_mode: String,
    pub tailscale_mode: String,
    pub node_manager: String,
    pub skills: Vec<String>,
    pub service_keys: HashMap<String, String>,
    pub provider_auths: HashMap<String, ProviderAuthData>,
    pub sandbox_mode: String,
    pub tools_mode: String,
    pub tools_profile: Option<String>,
    pub allowed_tools: Vec<String>,
    pub denied_tools: Vec<String>,
    pub fallback_models: Vec<String>,
    pub heartbeat_mode: String,
    pub idle_timeout_ms: u64,
    pub identity_md: String,
    pub user_md: String,
    pub soul_md: String,
    pub tools_md: Option<String>,
    pub agents_md: Option<String>,
    pub heartbeat_md: Option<String>,
    pub memory_md: Option<String>,
    pub memory_enabled: bool,
    pub enable_multi_agent: bool,
    pub agent_configs: Vec<AgentData>,
    pub is_paired: bool,
    pub cron_jobs: Option<Vec<CronJobConfig>>,
    pub local_base_url: Option<String>,
    pub thinking_level: Option<String>,
    pub whatsapp_enabled: Option<bool>,
    pub whatsapp_dm_policy: Option<String>,
    pub whatsapp_phone_number: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
pub struct ProviderAuthData {
    pub auth_method: String,
    pub token: String,
    pub profile_key: Option<String>,
    pub profile: Option<serde_json::Value>,
    pub oauth_provider_id: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct AgentConfig {
    pub provider: String,
    pub api_key: String,
    pub auth_method: Option<String>,
    pub model: String,
    pub user_name: String,
    pub agent_name: String,
    #[allow(dead_code)]
    pub agent_vibe: Option<String>,
    pub telegram_token: Option<String>,
    pub gateway_port: Option<u16>,
    pub gateway_bind: Option<String>,
    pub gateway_auth_mode: Option<String>,
    pub tailscale_mode: Option<String>,
    pub node_manager: Option<String>,
    pub skills: Option<Vec<String>>,
    #[allow(dead_code)]
    pub service_keys: Option<HashMap<String, String>>,
    pub provider_auths: Option<HashMap<String, ProviderAuthData>>,
    pub sandbox_mode: Option<String>,
    pub tools_mode: Option<String>,
    pub tools_profile: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub denied_tools: Option<Vec<String>>,
    pub fallback_models: Option<Vec<String>>,
    pub heartbeat_mode: Option<String>,
    pub idle_timeout_ms: Option<u64>,
    pub identity_md: Option<String>,
    pub user_md: Option<String>,
    pub soul_md: Option<String>,
    pub agents: Option<Vec<AgentData>>,
    pub preserve_state: Option<bool>,
    pub agent_type: Option<String>,
    pub tools_md: Option<String>,
    pub agents_md: Option<String>,
    pub heartbeat_md: Option<String>,
    pub memory_md: Option<String>,
    pub memory_enabled: Option<bool>,
    pub cron_jobs: Option<Vec<CronJobConfig>>,
    pub local_base_url: Option<String>,
    pub thinking_level: Option<String>,
    pub whatsapp_enabled: Option<bool>,
    pub whatsapp_dm_policy: Option<String>,
    pub whatsapp_phone_number: Option<String>,
}

#[derive(serde::Serialize)]
pub struct PrereqCheck {
    pub node_installed: bool,
    pub docker_running: bool,
    pub openclaw_installed: bool,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub ip: String,
    pub user: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Copy)]
pub enum TerminalPlatform {
    Macos,
    Windows,
    Linux,
}

pub struct TerminalLaunchPlan {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortListenerInfo {
    pub pid: i32,
    pub command: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SavedLicenseBlob {
    pub version: u8,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayChatBootstrap {
    pub ws_url: String,
    pub auth_token: String,
    pub target_environment: String,
    pub gateway_port: u16,
    pub tunnel_active: bool,
    #[serde(rename = "openClawVersion")]
    pub openclaw_version: String,
}
