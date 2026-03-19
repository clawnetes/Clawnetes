use crate::ssh::{connect_ssh, execute_ssh};
use crate::system::shell_command;
use crate::types::{PrereqCheck, RemoteInfo};

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

    let node = shell_command("node -v").is_ok();
    let openclaw = shell_command("openclaw --version").is_ok();

    PrereqCheck {
        node_installed: node,
        docker_running: true,
        openclaw_installed: openclaw,
    }
}

pub fn install_openclaw() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::system::{ensure_wsl2_installed, wsl_root_command};
        ensure_wsl2_installed()?;
        wsl_root_command("npm install -g openclaw")?;
        shell_command("openclaw --version")?;
        Ok("OpenClaw installed successfully in WSL2.".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        shell_command("npm install -g openclaw")?;
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
    shell_command(&format!("npx clawhub install {}", name))
}

pub fn install_remote_skill(remote: &RemoteInfo, name: &str) -> Result<String, String> {
    let sess = connect_ssh(remote)?;
    execute_ssh(&sess, &format!("npx clawhub install {}", name))
}

pub fn check_remote_prerequisites(remote: &RemoteInfo) -> Result<PrereqCheck, String> {
    let sess = connect_ssh(remote)?;
    let node = execute_ssh(&sess, "node -v").is_ok();
    let openclaw = execute_ssh(&sess, "openclaw --version").is_ok();

    Ok(PrereqCheck {
        node_installed: node,
        docker_running: true,
        openclaw_installed: openclaw,
    })
}
