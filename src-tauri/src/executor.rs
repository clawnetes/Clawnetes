use std::fs;

use ssh2::Session;

use crate::error::ClawError;
use crate::ssh::{connect_ssh, execute_ssh};
use crate::system::shell_command;
use crate::types::RemoteInfo;

pub trait CommandExecutor {
    fn run(&self, cmd: &str) -> Result<String, ClawError>;

    fn read_file(&self, path: &str) -> Result<String, ClawError> {
        self.run(&format!("cat \"{}\"", path))
    }

    fn write_file(&self, path: &str, content: &str) -> Result<(), ClawError> {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_write_file(path, content).map_err(ClawError::System)?;
            return Ok(());
        }

        #[cfg(not(target_os = "windows"))]
        {
            fs::write(path, content).map_err(ClawError::from)?;
            Ok(())
        }
    }

    fn mkdir_p(&self, path: &str) -> Result<(), ClawError> {
        self.run(&format!("mkdir -p \"{}\"", path)).map(|_| ())
    }

    fn home_dir(&self) -> Result<String, ClawError>;
}

pub struct LocalExecutor;

impl CommandExecutor for LocalExecutor {
    fn run(&self, cmd: &str) -> Result<String, ClawError> {
        shell_command(cmd).map_err(ClawError::System)
    }

    fn read_file(&self, path: &str) -> Result<String, ClawError> {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_read_file(path).map_err(ClawError::System)
        }

        #[cfg(not(target_os = "windows"))]
        {
            fs::read_to_string(path).map_err(ClawError::from)
        }
    }

    fn write_file(&self, path: &str, content: &str) -> Result<(), ClawError> {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_write_file(path, content).map_err(ClawError::System)?;
            return Ok(());
        }

        #[cfg(not(target_os = "windows"))]
        {
            fs::write(path, content).map_err(ClawError::from)?;
            Ok(())
        }
    }

    fn mkdir_p(&self, path: &str) -> Result<(), ClawError> {
        #[cfg(target_os = "windows")]
        {
            crate::system::wsl_mkdir_p(path).map_err(ClawError::System)?;
            return Ok(());
        }

        #[cfg(not(target_os = "windows"))]
        {
            fs::create_dir_all(path).map_err(ClawError::from)?;
            Ok(())
        }
    }

    fn home_dir(&self) -> Result<String, ClawError> {
        #[cfg(target_os = "windows")]
        {
            return crate::system::wsl_home_dir().map_err(ClawError::System);
        }

        #[cfg(not(target_os = "windows"))]
        {
            dirs::home_dir()
                .map(|path| path.to_string_lossy().to_string())
                .ok_or_else(|| ClawError::System("Could not find home directory".to_string()))
        }
    }
}

pub struct SshExecutor {
    session: Session,
}

impl SshExecutor {
    pub fn connect(remote: &RemoteInfo) -> Result<Self, ClawError> {
        let session = connect_ssh(remote).map_err(ClawError::Ssh)?;
        Ok(Self { session })
    }
}

impl CommandExecutor for SshExecutor {
    fn run(&self, cmd: &str) -> Result<String, ClawError> {
        execute_ssh(&self.session, cmd).map_err(ClawError::Ssh)
    }

    fn read_file(&self, path: &str) -> Result<String, ClawError> {
        self.run(&format!("cat \"{}\"", path))
    }

    fn write_file(&self, path: &str, content: &str) -> Result<(), ClawError> {
        let escaped = content.replace('\'', "'\\''");
        self.run(&format!("echo '{}' > \"{}\"", escaped, path)).map(|_| ())
    }

    fn mkdir_p(&self, path: &str) -> Result<(), ClawError> {
        self.run(&format!("mkdir -p \"{}\"", path)).map(|_| ())
    }

    fn home_dir(&self) -> Result<String, ClawError> {
        self.run("echo $HOME").map(|value| value.trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeExecutor {
        outputs: std::collections::HashMap<String, String>,
    }

    impl CommandExecutor for FakeExecutor {
        fn run(&self, cmd: &str) -> Result<String, ClawError> {
            self.outputs
                .get(cmd)
                .cloned()
                .ok_or_else(|| ClawError::System(format!("missing command: {}", cmd)))
        }

        fn home_dir(&self) -> Result<String, ClawError> {
            Ok("/tmp/fake".to_string())
        }
    }

    #[test]
    fn fake_executor_read_file_uses_run() {
        let executor = FakeExecutor {
            outputs: std::collections::HashMap::from([(
                "cat \"/tmp/file.txt\"".to_string(),
                "hello".to_string(),
            )]),
        };

        assert_eq!(
            executor.read_file("/tmp/file.txt").expect("should read file"),
            "hello"
        );
    }
}
