use std::process::Command;
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::Duration;

pub fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn shell_command(cmd: &str) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let (shell, args) = ("/bin/zsh", vec!["-l", "-c"]);

    #[cfg(target_os = "windows")]
    let (shell, args) = ("wsl", vec!["--", "/bin/bash", "-c"]);

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (shell, args) = ("sh", vec!["-c"]);

    let output = Command::new(shell)
        .args(&args)
        .arg(cmd)
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        // If stderr is populated, return it.
        if !stderr.is_empty() {
            Err(stderr)
        } else if !stdout.is_empty() {
            Err(stdout) // sometimes error messages are in stdout
        } else {
            Err(format!(
                "Command failed with exit code: {}",
                output.status.code().unwrap_or(-1)
            ))
        }
    }
}

// WSL2 Helper Functions

#[cfg(target_os = "windows")]
pub fn check_wsl2_installed() -> bool {
    let output = Command::new("powershell")
        .args(["-Command", "wsl -l -v 2>$null; exit $LASTEXITCODE"])
        .output();

    output.map(|o| o.status.success()).unwrap_or(false)
}

/// Poll WSL Ubuntu until it responds, with a configurable timeout.
/// Used after installing WSL or before running commands that need WSL to be ready.
#[cfg(target_os = "windows")]
pub fn wait_for_wsl_ready(timeout_secs: u64) -> Result<(), String> {
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);
    while start.elapsed() < timeout {
        let output = Command::new("wsl")
            .args(["-d", "Ubuntu", "-u", "root", "--", "echo", "ready"])
            .output();
        if let Ok(o) = output {
            if o.status.success() {
                let stdout = String::from_utf8_lossy(&o.stdout);
                if stdout.trim() == "ready" {
                    return Ok(());
                }
            }
        }
        thread::sleep(Duration::from_secs(3));
    }
    Err(format!(
        "WSL Ubuntu not ready after {} seconds",
        timeout_secs
    ))
}

#[cfg(target_os = "windows")]
pub fn ensure_wsl2_installed() -> Result<(), String> {
    // Check if WSL2 is already installed
    if check_wsl2_installed() {
        return Ok(());
    }

    // Install WSL2 using elevated PowerShell (triggers UAC admin prompt)
    let output = Command::new("powershell")
        .args([
            "-Command",
            "Start-Process -FilePath 'wsl.exe' -ArgumentList '--install --distribution Ubuntu' -Verb RunAs -Wait"
        ])
        .output()
        .map_err(|e| format!("Failed to execute WSL2 installation: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("canceled")
            || stderr.contains("denied")
            || stderr.contains("not have permission")
        {
            return Err("WSL2 installation requires administrator approval. Please click 'Yes' on the admin dialog when prompted.".to_string());
        }
        return Err(format!(
            "WSL2 installation failed. Please ensure virtualization is enabled in BIOS. Error: {}",
            stderr
        ));
    }

    // Wait for WSL Ubuntu to become responsive (first-time init can be slow)
    wait_for_wsl_ready(90).map_err(|e| {
        format!("WSL2 was installed but Ubuntu is not responding. You may need to restart your computer. Error: {}", e)
    })?;

    // Verify WSL2 is now available
    if !check_wsl2_installed() {
        return Err("WSL2 was installed but may require a system restart. Please restart your computer and run this setup again.".to_string());
    }

    // Configure Ubuntu with a default user non-interactively.
    let user_setup = Command::new("wsl")
        .args(["-d", "Ubuntu", "-u", "root", "--", "/bin/bash", "-c",
            "id openclaw >/dev/null 2>&1 || (useradd -m -s /bin/bash openclaw && echo 'openclaw:openclaw' | chpasswd && usermod -aG sudo openclaw)"
        ])
        .output()
        .map_err(|e| format!("Failed to create openclaw user: {}", e))?;

    if !user_setup.status.success() {
        let stderr = String::from_utf8_lossy(&user_setup.stderr);
        eprintln!(
            "Warning: user setup returned error (may be harmless if user exists): {}",
            stderr
        );
    }

    // Write /etc/wsl.conf to set default user
    let wsl_conf = Command::new("wsl")
        .args([
            "-d",
            "Ubuntu",
            "-u",
            "root",
            "--",
            "/bin/bash",
            "-c",
            "printf '[user]\\ndefault=openclaw\\n' > /etc/wsl.conf",
        ])
        .output()
        .map_err(|e| format!("Failed to write /etc/wsl.conf: {}", e))?;

    if !wsl_conf.status.success() {
        let stderr = String::from_utf8_lossy(&wsl_conf.stderr);
        eprintln!("Warning: failed to write wsl.conf: {}", stderr);
    }

    // Terminate Ubuntu so wsl.conf takes effect on next launch
    let _ = Command::new("wsl").args(["--terminate", "Ubuntu"]).output();

    thread::sleep(Duration::from_secs(2));

    // Wait for Ubuntu to come back with the new default user
    wait_for_wsl_ready(30).map_err(|e| {
        format!(
            "WSL Ubuntu failed to restart after user configuration: {}",
            e
        )
    })?;

    Ok(())
}

/// Run a command as root inside WSL (for apt-get, system setup, etc.)
#[cfg(target_os = "windows")]
pub fn wsl_root_command(cmd: &str) -> Result<String, String> {
    let output = Command::new("wsl")
        .args([
            "-d",
            "Ubuntu",
            "--user",
            "root",
            "--",
            "/bin/bash",
            "-c",
            cmd,
        ])
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("{}\n{}", stdout, stderr))
    }
}

// --- WSL filesystem helpers (Windows only) ---

#[cfg(target_os = "windows")]
pub fn wsl_home_dir() -> Result<String, String> {
    shell_command("echo $HOME").map(|s| s.trim().to_string())
}

#[cfg(target_os = "windows")]
pub fn wsl_write_file(path: &str, content: &str) -> Result<(), String> {
    let escaped = content.replace('\'', "'\\''");
    let cmd = format!("printf '%s' '{}' > \"{}\"", escaped, path);
    shell_command(&cmd)?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn wsl_read_file(path: &str) -> Result<String, String> {
    shell_command(&format!("cat \"{}\" 2>/dev/null", path))
}

#[cfg(target_os = "windows")]
pub fn wsl_mkdir_p(path: &str) -> Result<(), String> {
    shell_command(&format!("mkdir -p \"{}\"", path))?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn wsl_list_dirs(base_path: &str) -> Vec<String> {
    let mut dirs_found = Vec::new();
    if let Ok(output) = shell_command(&format!("ls -1 -F \"{}\" 2>/dev/null", base_path)) {
        for line in output.lines() {
            if line.trim().ends_with('/') {
                dirs_found.push(line.trim().trim_matches('/').to_string());
            }
        }
    }
    dirs_found
}

#[cfg(target_os = "windows")]
pub fn wsl_remove_dir(path: &str) -> Result<(), String> {
    let cmd = if path.starts_with("~/") {
        format!("rm -rf \"$HOME/{}\"", &path[2..])
    } else {
        format!("rm -rf \"{}\"", path)
    };
    shell_command(&cmd)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_single_quote_simple() {
        assert_eq!(shell_single_quote("hello"), "'hello'");
    }

    #[test]
    fn test_shell_single_quote_with_single_quotes() {
        assert_eq!(shell_single_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn test_shell_single_quote_empty() {
        assert_eq!(shell_single_quote(""), "''");
    }

    #[test]
    fn test_shell_command_echo() {
        let result = shell_command("echo hello");
        assert!(result.is_ok());
        assert_eq!(result.unwrap().trim(), "hello");
    }

    #[test]
    fn test_shell_command_failure() {
        let result = shell_command("false");
        assert!(result.is_err());
    }
}
