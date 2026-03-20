use crate::ssh::{connect_ssh, execute_ssh};
use crate::types::RemoteInfo;

pub fn get_ollama_models(remote: Option<&RemoteInfo>) -> Result<Vec<String>, String> {
    if let Some(r) = remote {
        let sess = connect_ssh(r).map_err(|e| format!("SSH connect failed: {}", e))?;
        let output = execute_ssh(
            &sess,
            "curl -sf http://localhost:11434/api/tags 2>/dev/null || echo '{}'",
        );
        match output {
            Ok(json_str) => {
                let val: serde_json::Value =
                    serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));
                let models: Vec<String> = val
                    .get("models")
                    .and_then(|m| m.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| {
                                m.get("name")
                                    .and_then(|n| n.as_str())
                                    .map(|s| s.to_string())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![]),
        }
    } else {
        match reqwest::blocking::get("http://localhost:11434/api/tags") {
            Ok(resp) => {
                let json: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
                let models: Vec<String> = json
                    .get("models")
                    .and_then(|m| m.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| {
                                m.get("name")
                                    .and_then(|n| n.as_str())
                                    .map(|s| s.to_string())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![]),
        }
    }
}

pub fn get_lmstudio_models(
    base_url: Option<&str>,
    remote: Option<&RemoteInfo>,
) -> Result<Vec<String>, String> {
    let url_base = base_url.unwrap_or("http://localhost:1234");
    let models_url = format!("{}/v1/models", url_base);

    if let Some(r) = remote {
        let sess = connect_ssh(r).map_err(|e| format!("SSH connect failed: {}", e))?;
        let output = execute_ssh(
            &sess,
            &format!(
                "curl -sf {}/v1/models 2>/dev/null || echo '{{}}'",
                url_base
            ),
        );
        match output {
            Ok(json_str) => {
                let val: serde_json::Value =
                    serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));
                let models: Vec<String> = val
                    .get("data")
                    .and_then(|d| d.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| {
                                m.get("id").and_then(|n| n.as_str()).map(|s| s.to_string())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![]),
        }
    } else {
        match reqwest::blocking::get(&models_url) {
            Ok(resp) => {
                let json: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
                let models: Vec<String> = json
                    .get("data")
                    .and_then(|d| d.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| {
                                m.get("id").and_then(|n| n.as_str()).map(|s| s.to_string())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            Err(_) => Ok(vec![]),
        }
    }
}
