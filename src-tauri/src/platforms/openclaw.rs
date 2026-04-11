use crate::config;
use crate::gateway;
use crate::install;
use crate::maintenance;
use crate::remote;
use crate::types::{AgentConfig, CurrentConfig, GatewayChatBootstrap, RemoteInfo};

use super::types::PlatformPrereqCheck;

pub fn check_prerequisites(remote: Option<&RemoteInfo>) -> Result<PlatformPrereqCheck, String> {
    if let Some(remote_info) = remote {
        let base = install::check_remote_prerequisites(remote_info)?;
        return Ok(PlatformPrereqCheck {
            node_installed: base.node_installed,
            docker_running: base.docker_running,
            platform_installed: base.openclaw_installed,
            git_installed: true,
            wsl2_installed: None,
        });
    }

    let base = install::check_prerequisites();
    Ok(PlatformPrereqCheck {
        node_installed: base.node_installed,
        docker_running: base.docker_running,
        platform_installed: base.openclaw_installed,
        git_installed: true,
        wsl2_installed: None,
    })
}

pub fn install(remote: Option<&RemoteInfo>) -> Result<String, String> {
    if remote.is_some() {
        return Err("Remote OpenClaw install must go through setup_remote_openclaw.".to_string());
    }
    install::install_openclaw()
}

pub fn get_version(remote: Option<&RemoteInfo>) -> Result<String, String> {
    if let Some(remote) = remote {
        maintenance::get_remote_openclaw_version(remote)
    } else {
        Ok(maintenance::get_openclaw_version())
    }
}

pub fn get_config(remote: Option<&RemoteInfo>) -> Result<CurrentConfig, String> {
    config::get_current_config(remote)
}

pub async fn configure(
    config_payload: AgentConfig,
    remote: Option<&RemoteInfo>,
) -> Result<String, String> {
    if let Some(remote_info) = remote {
        remote::apply_agent_config(remote_info, config_payload)
            .await
            .map_err(|e| e.to_string())
    } else {
        config::configure_agent(config_payload)
    }
}

pub async fn prepare_chat_bootstrap(
    gateway_port: Option<u16>,
    remote: Option<&RemoteInfo>,
) -> Result<GatewayChatBootstrap, String> {
    gateway::prepare_gateway_chat_connection(gateway_port.unwrap_or(18789), remote).await
}

pub async fn start_service(remote: Option<&RemoteInfo>) -> Result<String, String> {
    if let Some(remote_info) = remote {
        gateway::restart_openclaw_gateway(remote_info).await
    } else {
        gateway::start_gateway().await
    }
}

pub async fn restart_service(remote: Option<&RemoteInfo>) -> Result<String, String> {
    if let Some(remote_info) = remote {
        gateway::restart_openclaw_gateway(remote_info).await
    } else {
        gateway::start_gateway().await
    }
}

pub fn run_maintenance(action: &str, remote: Option<&RemoteInfo>) -> Result<String, String> {
    match (action, remote) {
        ("repair", Some(remote)) => maintenance::run_remote_doctor_repair(remote),
        ("repair", None) => maintenance::run_doctor_repair(),
        ("audit", Some(remote)) => maintenance::run_remote_security_audit_fix(remote),
        ("audit", None) => maintenance::run_security_audit_fix(),
        ("update", Some(remote)) => maintenance::update_remote_openclaw(remote),
        ("update", None) => install::install_openclaw(),
        ("uninstall", Some(remote)) => maintenance::uninstall_remote_openclaw(remote),
        ("uninstall", None) => maintenance::uninstall_openclaw(),
        _ => Err(format!(
            "Unsupported OpenClaw maintenance action: {}",
            action
        )),
    }
}
