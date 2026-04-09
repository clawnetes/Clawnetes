#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentPlatform {
    Openclaw,
    Hermes,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPrereqCheck {
    pub node_installed: bool,
    pub docker_running: bool,
    pub platform_installed: bool,
    pub git_installed: bool,
    pub wsl2_installed: Option<bool>,
}
