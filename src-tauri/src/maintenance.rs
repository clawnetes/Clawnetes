use crate::ssh::{connect_ssh, execute_ssh};
use crate::system::shell_command;
use crate::types::RemoteInfo;

pub fn get_openclaw_version() -> String {
    match shell_command("openclaw --version") {
        Ok(v) => v.trim().to_string(),
        Err(_) => "v2026.2.8".to_string(),
    }
}

pub fn uninstall_openclaw() -> Result<String, String> {
    let _ = shell_command("openclaw gateway stop");

    #[cfg(target_os = "windows")]
    {
        use crate::system::{wsl_remove_dir, wsl_root_command};
        wsl_root_command("npm uninstall -g openclaw")?;
        wsl_remove_dir("~/.openclaw")?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        shell_command("npm uninstall -g openclaw")?;
        let home = dirs::home_dir().ok_or("Could not find home directory")?;
        let openclaw_root = home.join(".openclaw");
        if openclaw_root.exists() {
            std::fs::remove_dir_all(openclaw_root).map_err(|e| e.to_string())?;
        }
    }

    Ok("OpenClaw has been completely uninstalled.".to_string())
}

pub fn run_doctor_repair() -> Result<String, String> {
    shell_command("openclaw doctor --repair --yes")
}

pub fn run_security_audit_fix() -> Result<String, String> {
    shell_command("openclaw security audit --fix")
}

pub fn get_remote_openclaw_version(remote: &RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(remote)?;
    match execute_ssh(&sess, "openclaw --version") {
        Ok(v) => Ok(v.trim().to_string()),
        Err(_) => Ok("Not installed".to_string()),
    }
}

pub fn run_remote_doctor_repair(remote: &RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(remote)?;
    execute_ssh(&sess, "openclaw doctor --repair --yes")
}

pub fn run_remote_security_audit_fix(remote: &RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(remote)?;
    execute_ssh(&sess, "openclaw security audit --fix")
}

pub fn uninstall_remote_openclaw(remote: &RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(remote)?;
    let _ = execute_ssh(&sess, "openclaw gateway stop");
    execute_ssh(&sess, "sudo npm uninstall -g openclaw")?;
    execute_ssh(&sess, "rm -rf ~/.openclaw")?;
    Ok("OpenClaw has been completely uninstalled from the remote server.".to_string())
}

pub fn update_remote_openclaw(remote: &RemoteInfo) -> Result<String, String> {
    let sess = connect_ssh(remote)?;
    execute_ssh(&sess, "sudo npm install -g openclaw@2026.3.24")?;
    execute_ssh(&sess, "openclaw gateway restart")?;
    Ok("OpenClaw has been updated on the remote server.".to_string())
}
