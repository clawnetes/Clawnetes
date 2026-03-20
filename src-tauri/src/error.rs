use std::fmt;

/// Unified error type for all Clawnetes backend operations.
#[derive(Debug)]
pub enum ClawError {
    /// Network errors (HTTP, WebSocket, connection failures)
    Network(String),
    /// Configuration errors (missing fields, invalid values, file I/O)
    Config(String),
    /// License verification/encryption errors
    License(String),
    /// SSH connection and remote execution errors
    Ssh(String),
    /// System errors (missing tools, permissions, platform issues)
    System(String),
}

impl fmt::Display for ClawError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClawError::Network(msg) => write!(f, "Network error: {}", msg),
            ClawError::Config(msg) => write!(f, "Config error: {}", msg),
            ClawError::License(msg) => write!(f, "License error: {}", msg),
            ClawError::Ssh(msg) => write!(f, "SSH error: {}", msg),
            ClawError::System(msg) => write!(f, "System error: {}", msg),
        }
    }
}

impl std::error::Error for ClawError {}

// Convert ClawError to String for Tauri command return types (Result<T, String>)
impl From<ClawError> for String {
    fn from(err: ClawError) -> String {
        err.to_string()
    }
}

impl From<std::io::Error> for ClawError {
    fn from(err: std::io::Error) -> ClawError {
        ClawError::System(err.to_string())
    }
}

impl From<serde_json::Error> for ClawError {
    fn from(err: serde_json::Error) -> ClawError {
        ClawError::Config(err.to_string())
    }
}

impl From<ssh2::Error> for ClawError {
    fn from(err: ssh2::Error) -> ClawError {
        ClawError::Ssh(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claw_error_display() {
        let err = ClawError::Network("connection refused".into());
        assert_eq!(err.to_string(), "Network error: connection refused");
    }

    #[test]
    fn test_claw_error_to_string_conversion() {
        let err = ClawError::License("invalid key".into());
        let s: String = err.into();
        assert_eq!(s, "License error: invalid key");
    }

    #[test]
    fn test_claw_error_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let claw_err: ClawError = io_err.into();
        assert!(matches!(claw_err, ClawError::System(_)));
        assert!(claw_err.to_string().contains("file not found"));
    }

    #[test]
    fn test_claw_error_from_serde_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("invalid json").unwrap_err();
        let claw_err: ClawError = json_err.into();
        assert!(matches!(claw_err, ClawError::Config(_)));
    }
}
