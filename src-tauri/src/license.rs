use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use sha2::{Digest, Sha256};
#[cfg(any(target_os = "linux", test))]
use std::path::PathBuf;
use std::process::Command;

use crate::types::SavedLicenseBlob;

pub const ADVANCED_LICENSE_PRODUCT_ID: &str = "gsFyrV978DfW2ZYp5pzetQ==";
pub const ADVANCED_LICENSE_KEY_LABEL: &[u8] = b"clawnetes:advanced-license:v1";

pub fn verify_license_with_gumroad(key: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::new();
    let res = client
        .post("https://api.gumroad.com/v2/licenses/verify")
        .form(&[
            ("product_id", ADVANCED_LICENSE_PRODUCT_ID),
            ("license_key", key),
        ])
        .send()
        .map_err(|e| format!("Network error: {}", e))?;

    if !res.status().is_success() {
        return Err("License verification failed (Invalid key or network error)".to_string());
    }

    let json: serde_json::Value = res
        .json()
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    validate_license_response(&json)
}

pub fn validate_license_response(json: &serde_json::Value) -> Result<(), String> {
    if let Some(success) = json.get("success").and_then(|v| v.as_bool()) {
        if success {
            if let Some(purchase) = json.get("purchase") {
                if purchase
                    .get("refunded")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    return Err("License has been refunded.".to_string());
                }
                if purchase
                    .get("chargebacked")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    return Err("License has been chargebacked.".to_string());
                }
            }
            return Ok(());
        }
    }

    Err("Invalid license key.".to_string())
}

pub fn derive_license_encryption_key(machine_id: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(ADVANCED_LICENSE_KEY_LABEL);
    hasher.update(machine_id.as_bytes());
    let digest = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest[..32]);
    key
}

pub fn encrypt_saved_license_value(
    license_key: &str,
    encryption_key: &[u8; 32],
) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(encryption_key)
        .map_err(|e| format!("Failed to initialize license encryption: {}", e))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, license_key.as_bytes())
        .map_err(|e| format!("Failed to encrypt saved license: {}", e))?;

    serde_json::to_string(&SavedLicenseBlob {
        version: 1,
        nonce: BASE64_STANDARD.encode(nonce_bytes),
        ciphertext: BASE64_STANDARD.encode(ciphertext),
    })
    .map_err(|e| format!("Failed to serialize saved license: {}", e))
}

pub fn decrypt_saved_license_value(
    serialized: &str,
    encryption_key: &[u8; 32],
) -> Result<String, String> {
    let blob: SavedLicenseBlob = serde_json::from_str(serialized)
        .map_err(|e| format!("Saved license file is invalid JSON: {}", e))?;
    if blob.version != 1 {
        return Err("Saved license file has an unsupported version.".to_string());
    }

    let nonce_bytes = BASE64_STANDARD
        .decode(blob.nonce)
        .map_err(|e| format!("Saved license nonce is invalid: {}", e))?;
    if nonce_bytes.len() != 12 {
        return Err("Saved license nonce has an invalid length.".to_string());
    }
    let ciphertext = BASE64_STANDARD
        .decode(blob.ciphertext)
        .map_err(|e| format!("Saved license ciphertext is invalid: {}", e))?;
    let cipher = Aes256Gcm::new_from_slice(encryption_key)
        .map_err(|e| format!("Failed to initialize saved license decryption: {}", e))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| "Saved license cannot be decrypted on this machine.".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("Saved license contains invalid UTF-8: {}", e))
}

use rand::Rng;

#[cfg(any(target_os = "linux", test))]
pub fn read_first_nonempty_file(paths: &[PathBuf]) -> Result<Option<String>, String> {
    for path in paths {
        if !path.exists() {
            continue;
        }

        let content = std::fs::read_to_string(path).map_err(|e| {
            format!(
                "Failed to read machine identifier {}: {}",
                path.display(),
                e
            )
        })?;
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }

    Ok(None)
}

#[cfg(any(target_os = "windows", test))]
pub fn parse_windows_machine_guid(output: &str) -> Option<String> {
    output
        .lines()
        .find(|line| line.contains("MachineGuid"))
        .and_then(|line| line.split_whitespace().last())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(target_os = "linux")]
pub fn get_machine_identifier() -> Result<String, String> {
    let candidates = vec![
        PathBuf::from("/etc/machine-id"),
        PathBuf::from("/var/lib/dbus/machine-id"),
    ];
    read_first_nonempty_file(&candidates)?
        .ok_or("Could not determine Linux machine identifier.".to_string())
}

#[cfg(target_os = "windows")]
pub fn get_machine_identifier() -> Result<String, String> {
    let output = Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .map_err(|e| format!("Failed to read Windows machine identifier: {}", e))?;
    if !output.status.success() {
        return Err("Failed to read Windows machine identifier.".to_string());
    }
    parse_windows_machine_guid(&String::from_utf8_lossy(&output.stdout))
        .ok_or("Could not parse Windows machine identifier.".to_string())
}

#[cfg(target_os = "macos")]
pub fn get_machine_identifier() -> Result<String, String> {
    let output = Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .map_err(|e| format!("Failed to read macOS machine identifier: {}", e))?;
    if !output.status.success() {
        return Err("Failed to read macOS machine identifier.".to_string());
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| line.contains("IOPlatformUUID"))
        .and_then(|line| line.split('"').nth(3))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or("Could not parse macOS machine identifier.".to_string())
}

/// Write encrypted license to disk. Requires Tauri AppHandle for path resolution.
pub fn write_saved_license(
    storage_path: &std::path::Path,
    license_key: &str,
) -> Result<(), String> {
    if let Some(parent) = storage_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create license storage directory: {}", e))?;
    }

    let machine_id = get_machine_identifier()?;
    let encryption_key = derive_license_encryption_key(&machine_id);
    let encrypted = encrypt_saved_license_value(license_key, &encryption_key)?;
    std::fs::write(storage_path, encrypted)
        .map_err(|e| format!("Failed to write saved license file: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(storage_path, permissions)
            .map_err(|e| format!("Failed to secure saved license file permissions: {}", e))?;
    }

    Ok(())
}

/// Read encrypted license from disk.
pub fn read_saved_license(storage_path: &std::path::Path) -> Result<Option<String>, String> {
    if !storage_path.exists() {
        return Ok(None);
    }

    let serialized = std::fs::read_to_string(storage_path)
        .map_err(|e| format!("Failed to read saved license file: {}", e))?;
    let machine_id = get_machine_identifier()?;
    let encryption_key = derive_license_encryption_key(&machine_id);
    let license_key = decrypt_saved_license_value(&serialized, &encryption_key)?;

    if license_key.trim().is_empty() {
        return Err("Saved license file contains an empty license key.".to_string());
    }

    Ok(Some(license_key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_license_response_accepts_clean_purchase() {
        let response = serde_json::json!({
            "success": true,
            "purchase": {
                "refunded": false,
                "chargebacked": false
            }
        });
        assert!(validate_license_response(&response).is_ok());
    }

    #[test]
    fn test_validate_license_response_rejects_refunded_purchase() {
        let response = serde_json::json!({
            "success": true,
            "purchase": {
                "refunded": true,
                "chargebacked": false
            }
        });
        assert_eq!(
            validate_license_response(&response).unwrap_err(),
            "License has been refunded."
        );
    }

    #[test]
    fn test_validate_license_response_rejects_chargebacked_purchase() {
        let response = serde_json::json!({
            "success": true,
            "purchase": {
                "refunded": false,
                "chargebacked": true
            }
        });
        assert_eq!(
            validate_license_response(&response).unwrap_err(),
            "License has been chargebacked."
        );
    }

    #[test]
    fn test_validate_license_response_rejects_unsuccessful_response() {
        let response = serde_json::json!({
            "success": false
        });
        assert_eq!(
            validate_license_response(&response).unwrap_err(),
            "Invalid license key."
        );
    }

    #[test]
    fn test_encrypt_saved_license_round_trip() {
        let key = derive_license_encryption_key("machine-a");
        let encrypted =
            encrypt_saved_license_value("LICENSE-123", &key).expect("license should encrypt");
        let decrypted =
            decrypt_saved_license_value(&encrypted, &key).expect("license should decrypt");
        assert_eq!(decrypted, "LICENSE-123");
    }

    #[test]
    fn test_saved_license_decrypt_fails_with_different_machine_key() {
        let key = derive_license_encryption_key("machine-a");
        let wrong_key = derive_license_encryption_key("machine-b");
        let encrypted =
            encrypt_saved_license_value("LICENSE-123", &key).expect("license should encrypt");
        assert_eq!(
            decrypt_saved_license_value(&encrypted, &wrong_key).unwrap_err(),
            "Saved license cannot be decrypted on this machine."
        );
    }

    #[test]
    fn test_decrypt_saved_license_rejects_corrupt_payload() {
        let key = derive_license_encryption_key("machine-a");
        assert!(decrypt_saved_license_value(
            "{\"version\":1,\"nonce\":\"bad\",\"ciphertext\":\"bad\"}",
            &key
        )
        .is_err());
    }

    #[test]
    fn test_parse_windows_machine_guid_extracts_value() {
        let output = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    1234-5678\r\n";
        assert_eq!(
            parse_windows_machine_guid(output).as_deref(),
            Some("1234-5678")
        );
    }

    #[test]
    fn test_read_first_nonempty_file_prefers_first_nonempty_candidate() {
        let temp_dir =
            std::env::temp_dir().join(format!("clawnetes-license-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("temp dir should be created");
        let first = temp_dir.join("first");
        let second = temp_dir.join("second");
        std::fs::write(&first, "   ").expect("first file should be written");
        std::fs::write(&second, "machine-id-123\n").expect("second file should be written");

        let result = read_first_nonempty_file(&[first.clone(), second.clone()])
            .expect("machine id lookup should succeed");
        assert_eq!(result.as_deref(), Some("machine-id-123"));

        let _ = std::fs::remove_file(first);
        let _ = std::fs::remove_file(second);
        let _ = std::fs::remove_dir(temp_dir);
    }

    #[test]
    fn test_derive_license_encryption_key_deterministic() {
        let key1 = derive_license_encryption_key("test-machine");
        let key2 = derive_license_encryption_key("test-machine");
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_derive_license_encryption_key_different_machines_produce_different_keys() {
        let key1 = derive_license_encryption_key("machine-a");
        let key2 = derive_license_encryption_key("machine-b");
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_encrypt_produces_different_ciphertext_each_time() {
        let key = derive_license_encryption_key("machine-a");
        let enc1 = encrypt_saved_license_value("LICENSE-123", &key).unwrap();
        let enc2 = encrypt_saved_license_value("LICENSE-123", &key).unwrap();
        // Random nonce means different ciphertext each time
        assert_ne!(enc1, enc2);
        // Both should decrypt to the same value
        assert_eq!(decrypt_saved_license_value(&enc1, &key).unwrap(), "LICENSE-123");
        assert_eq!(decrypt_saved_license_value(&enc2, &key).unwrap(), "LICENSE-123");
    }

    #[test]
    fn test_decrypt_rejects_unsupported_version() {
        let result = decrypt_saved_license_value(
            r#"{"version":2,"nonce":"AAAAAAAAAAAAAAAA","ciphertext":"AAAA"}"#,
            &derive_license_encryption_key("machine-a"),
        );
        assert_eq!(
            result.unwrap_err(),
            "Saved license file has an unsupported version."
        );
    }

    #[test]
    fn test_decrypt_rejects_invalid_nonce_length() {
        // Valid base64 but wrong length (only 4 bytes, not 12)
        let key = derive_license_encryption_key("machine-a");
        let result = decrypt_saved_license_value(
            r#"{"version":1,"nonce":"AQID","ciphertext":"AAAA"}"#,
            &key,
        );
        assert_eq!(
            result.unwrap_err(),
            "Saved license nonce has an invalid length."
        );
    }
}
