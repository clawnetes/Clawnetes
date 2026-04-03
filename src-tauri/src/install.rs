use crate::error::ClawError;
use crate::executor::{CommandExecutor, LocalExecutor, SshExecutor};
use crate::system::shell_command;
use crate::types::{PrereqCheck, RemoteInfo};

fn check_prerequisites_with<E: CommandExecutor>(executor: &E) -> Result<PrereqCheck, ClawError> {
    let node_installed = executor.run("node -v").is_ok();
    let openclaw_installed = executor.run("openclaw --version").is_ok();

    Ok(PrereqCheck {
        node_installed,
        docker_running: true,
        openclaw_installed,
    })
}

pub fn check_prerequisites() -> PrereqCheck {
    #[cfg(target_os = "windows")]
    {
        use crate::system::check_wsl2_installed;
        let wsl2_ok = check_wsl2_installed();
        if !wsl2_ok {
            return PrereqCheck {
                node_installed: false,
                docker_running: true,
                openclaw_installed: false,
            };
        }
    }

    check_prerequisites_with(&LocalExecutor).unwrap_or(PrereqCheck {
        node_installed: false,
        docker_running: true,
        openclaw_installed: false,
    })
}

pub fn install_openclaw() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::system::{ensure_wsl2_installed, wsl_root_command};
        ensure_wsl2_installed()?;
        wsl_root_command("npm install -g openclaw@2026.3.24")?;
        shell_command("openclaw --version")?;
        Ok("OpenClaw installed successfully in WSL2.".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        shell_command("npm install -g openclaw@2026.3.24")?;
        shell_command("openclaw --version")?;
        Ok("OpenClaw installed successfully.".to_string())
    }
}

pub fn install_local_nodejs() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::system::{ensure_wsl2_installed, wait_for_wsl_ready, wsl_root_command};
        ensure_wsl2_installed()?;
        wait_for_wsl_ready(30)
            .map_err(|e| format!("WSL not ready for Node.js installation: {}", e))?;
        wsl_root_command("curl -fsSL https://deb.nodesource.com/setup_22.x | bash -")
            .map_err(|e| format!("Failed to add NodeSource repository: {}", e))?;
        wsl_root_command("apt-get install -y nodejs")
            .map_err(|e| format!("Failed to install Node.js in WSL2: {}", e))?;
        return Ok("Node.js installed successfully in WSL2.".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        if shell_command("brew --version").is_ok() {
            return shell_command("brew install node");
        }

        let install_nvm_cmd =
            "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash";
        shell_command(install_nvm_cmd).map_err(|e| format!("Failed to install nvm: {}", e))?;

        let install_node_cmd = "export NVM_DIR=\"$HOME/.nvm\"; \
            [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; \
            nvm install node && nvm use node && nvm alias default node";

        shell_command(install_node_cmd)
            .map_err(|e| format!("Failed to install Node.js via nvm: {}", e))
    }
}

pub fn install_skill(name: &str) -> Result<String, String> {
    install_skill_with(&LocalExecutor, name).map_err(String::from)
}

pub fn install_remote_skill(remote: &RemoteInfo, name: &str) -> Result<String, String> {
    let executor = SshExecutor::connect(remote).map_err(String::from)?;
    install_skill_with(&executor, name).map_err(String::from)
}

pub fn check_remote_prerequisites(remote: &RemoteInfo) -> Result<PrereqCheck, String> {
    let executor = SshExecutor::connect(remote).map_err(String::from)?;
    check_prerequisites_with(&executor).map_err(String::from)
}

fn install_skill_with<E: CommandExecutor>(executor: &E, name: &str) -> Result<String, ClawError> {
    executor.run(&format!("npx clawhub install {}", name))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeExecutor {
        success_commands: std::collections::HashSet<String>,
    }

    impl CommandExecutor for FakeExecutor {
        fn run(&self, cmd: &str) -> Result<String, ClawError> {
            if self.success_commands.contains(cmd) {
                Ok("ok".to_string())
            } else {
                Err(ClawError::System("command failed".to_string()))
            }
        }

        fn home_dir(&self) -> Result<String, ClawError> {
            Ok("/tmp/fake".to_string())
        }
    }

    #[test]
    fn check_prerequisites_with_detects_available_commands() {
        let executor = FakeExecutor {
            success_commands: std::collections::HashSet::from([
                "node -v".to_string(),
                "openclaw --version".to_string(),
            ]),
        };

        let prereqs = check_prerequisites_with(&executor).expect("should build prereqs");
        assert!(prereqs.node_installed);
        assert!(prereqs.openclaw_installed);
    }

    #[test]
    fn install_skill_with_runs_clawhub_install() {
        let executor = FakeExecutor {
            success_commands: std::collections::HashSet::from([
                "npx clawhub install web-search".to_string()
            ]),
        };

        assert!(install_skill_with(&executor, "web-search").is_ok());
    }
}
