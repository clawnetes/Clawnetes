use std::path::Path;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::gateway::{get_local_gateway_token, get_remote_gateway_token};
use crate::types::RemoteInfo;

type GatewaySocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

const GATEWAY_CLIENT_ID: &str = "gateway-client";
const GATEWAY_CLIENT_VERSION: &str = "clawnetes";
const GATEWAY_CLIENT_MODE: &str = "backend";
const GATEWAY_ROLE: &str = "operator";
const GATEWAY_SCOPES: [&str; 3] = ["operator.admin", "operator.approvals", "operator.pairing"];

fn build_connect_message(connect_req_id: &str, auth_token: Option<&str>) -> serde_json::Value {
    let mut connect_msg = serde_json::json!({
        "type": "req",
        "id": connect_req_id,
        "method": "connect",
        "params": {
            "client": {
                "id": GATEWAY_CLIENT_ID,
                "version": GATEWAY_CLIENT_VERSION,
                "platform": std::env::consts::OS,
                "mode": GATEWAY_CLIENT_MODE
            },
            "minProtocol": 3,
            "maxProtocol": 3,
            "role": GATEWAY_ROLE,
            "scopes": GATEWAY_SCOPES
        }
    });

    if let Some(token) = auth_token {
        if let Some(params) = connect_msg
            .get_mut("params")
            .and_then(|params| params.as_object_mut())
        {
            params.insert("auth".to_string(), serde_json::json!({ "token": token }));
        }
    }

    connect_msg
}

fn read_gateway_error_text(value: &serde_json::Value) -> Option<String> {
    value
        .get("error")
        .and_then(|error| serde_json::to_string(error).ok())
}

fn parse_qr_data_url(value: &serde_json::Value) -> Result<Option<String>, String> {
    if value
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return Ok(value
            .get("payload")
            .and_then(|payload| payload.get("qrDataUrl"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()));
    }

    if let Some(error_text) = read_gateway_error_text(value) {
        return Err(format!("Gateway error: {}", error_text));
    }

    Ok(None)
}

fn parse_connected(value: &serde_json::Value) -> Result<Option<bool>, String> {
    if value
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return Ok(Some(
            value
                .get("payload")
                .and_then(|payload| payload.get("connected"))
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
        ));
    }

    if let Some(error_text) = read_gateway_error_text(value) {
        return Err(format!("Gateway error: {}", error_text));
    }

    Ok(None)
}

fn local_openclaw_home_dir() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        crate::system::wsl_home_dir().map(|path| path.trim().to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        dirs::home_dir()
            .map(|path| path.to_string_lossy().to_string())
            .ok_or("Could not determine local home directory.".to_string())
    }
}

fn whatsapp_session_dir(home_dir: &str) -> String {
    format!(
        "{}/.openclaw/credentials/whatsapp/default",
        home_dir.trim_end_matches('/')
    )
}

fn read_gateway_auth_token(remote: Option<&RemoteInfo>) -> Result<String, String> {
    if let Some(remote) = remote {
        get_remote_gateway_token(remote)
    } else {
        get_local_gateway_token()
    }
}

async fn connect_gateway(
    gateway_port: u16,
    auth_token: Option<&str>,
    max_attempts: u8,
) -> Result<GatewaySocket, String> {
    let url = format!("ws://127.0.0.1:{}", gateway_port);

    for attempt in 0..max_attempts {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(10)).await;
        }

        let (mut ws_stream, _) = connect_async(&url)
            .await
            .map_err(|e| format!("WebSocket connect failed: {}", e))?;

        let connect_req_id = uuid::Uuid::new_v4().to_string();
        let connect_msg = build_connect_message(&connect_req_id, auth_token);

        ws_stream
            .send(Message::Text(connect_msg.to_string()))
            .await
            .map_err(|e| format!("WebSocket send connect failed: {}", e))?;

        let mut handshake_ok = false;
        let mut needs_reconnect = false;
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let val: serde_json::Value =
                        serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                    if val.get("id").and_then(|value| value.as_str()) == Some(&connect_req_id) {
                        if val.get("ok").and_then(|value| value.as_bool()) == Some(true) {
                            handshake_ok = true;
                            break;
                        }

                        let error_code = val
                            .get("error")
                            .and_then(|error| error.get("code"))
                            .and_then(|code| code.as_str())
                            .unwrap_or("");
                        let detail_code = val
                            .get("error")
                            .and_then(|error| error.get("details"))
                            .and_then(|details| details.get("code"))
                            .and_then(|code| code.as_str())
                            .unwrap_or("");

                        if error_code == "NOT_PAIRED" || detail_code == "DEVICE_IDENTITY_REQUIRED" {
                            needs_reconnect = true;
                            break;
                        }

                        return Err(format!("Gateway connect handshake failed: {}", text));
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => return Err(format!("WebSocket error during handshake: {}", e)),
                _ => {}
            }
        }

        if needs_reconnect {
            continue;
        }
        if handshake_ok {
            return Ok(ws_stream);
        }
        return Err("Gateway connect handshake timed out".to_string());
    }

    Err("Gateway connect handshake failed after retries".to_string())
}

pub async fn start_whatsapp_login(
    gateway_port: u16,
    remote: Option<&RemoteInfo>,
) -> Result<String, String> {
    let auth_token = read_gateway_auth_token(remote)?;
    let mut ws_stream = connect_gateway(gateway_port, Some(auth_token.as_str()), 5).await?;

    let request_id = uuid::Uuid::new_v4().to_string();
    let rpc_msg = serde_json::json!({
        "type": "req",
        "id": request_id,
        "method": "web.login.start",
        "params": { "timeoutMs": 30000, "force": true }
    });

    ws_stream
        .send(Message::Text(rpc_msg.to_string()))
        .await
        .map_err(|e| format!("WebSocket send failed: {}", e))?;

    while let Some(msg) = ws_stream.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let val: serde_json::Value =
                    serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                if val.get("id").and_then(|value| value.as_str()) == Some(&request_id) {
                    match parse_qr_data_url(&val)? {
                        Some(qr) => return Ok(qr),
                        None => {
                            if val
                                .get("ok")
                                .and_then(|value| value.as_bool())
                                .unwrap_or(false)
                            {
                                return Err("Gateway returned ok but no QR code (already linked?)"
                                    .to_string());
                            }
                        }
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Err(e) => return Err(format!("WebSocket error: {}", e)),
            _ => {}
        }
    }

    Err("No QR code received from gateway after retries".to_string())
}

pub async fn wait_whatsapp_login(
    gateway_port: u16,
    remote: Option<&RemoteInfo>,
) -> Result<bool, String> {
    let auth_token = read_gateway_auth_token(remote)?;
    let mut ws_stream = connect_gateway(gateway_port, Some(auth_token.as_str()), 5).await?;

    let request_id = uuid::Uuid::new_v4().to_string();
    let rpc_msg = serde_json::json!({
        "type": "req",
        "id": request_id,
        "method": "web.login.wait",
        "params": { "timeoutMs": 120000 }
    });

    ws_stream
        .send(Message::Text(rpc_msg.to_string()))
        .await
        .map_err(|e| format!("WebSocket send failed: {}", e))?;

    match tokio::time::timeout(Duration::from_secs(130), async {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let val: serde_json::Value =
                        serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                    if val.get("id").and_then(|value| value.as_str()) == Some(&request_id) {
                        if let Some(connected) = parse_connected(&val)? {
                            return Ok(connected);
                        }
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => return Err(format!("WebSocket error: {}", e)),
                _ => {}
            }
        }
        Ok(false)
    })
    .await
    {
        Ok(result) => result,
        Err(_) => Err("WhatsApp login wait timed out".to_string()),
    }
}

pub fn wipe_whatsapp_session() -> Result<(), String> {
    let home_dir = local_openclaw_home_dir()?;
    let session_dir = whatsapp_session_dir(&home_dir);

    #[cfg(target_os = "windows")]
    {
        crate::system::wsl_remove_dir(&session_dir)
            .map_err(|e| format!("Failed to delete whatsapp session: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        if Path::new(&session_dir).exists() {
            std::fs::remove_dir_all(&session_dir)
                .map_err(|e| format!("Failed to delete whatsapp session: {}", e))?;
        }
    }

    Ok(())
}

pub async fn check_whatsapp_linked(gateway_port: u16) -> Result<bool, String> {
    let auth_token = read_gateway_auth_token(None)?;
    let mut ws_stream = match connect_gateway(gateway_port, Some(auth_token.as_str()), 1).await {
        Ok(stream) => stream,
        Err(err) if err.contains("NOT_PAIRED") || err.contains("DEVICE_IDENTITY_REQUIRED") => {
            return Ok(false)
        }
        Err(err) => return Err(err),
    };

    let request_id = uuid::Uuid::new_v4().to_string();
    let rpc_msg = serde_json::json!({
        "type": "req",
        "id": request_id,
        "method": "web.login.start",
        "params": { "timeoutMs": 10000 }
    });

    ws_stream
        .send(Message::Text(rpc_msg.to_string()))
        .await
        .map_err(|e| format!("WebSocket send failed: {}", e))?;

    match tokio::time::timeout(Duration::from_secs(15), async {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let val: serde_json::Value =
                        serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                    if val.get("id").and_then(|value| value.as_str()) == Some(&request_id) {
                        match parse_qr_data_url(&val)? {
                            Some(_) => return Ok(false),
                            None => {
                                if val
                                    .get("ok")
                                    .and_then(|value| value.as_bool())
                                    .unwrap_or(false)
                                {
                                    return Ok(true);
                                }
                            }
                        }
                        return Ok(false);
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => return Err(format!("WebSocket error: {}", e)),
                _ => {}
            }
        }
        Ok(false)
    })
    .await
    {
        Ok(result) => result,
        Err(_) => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_connect_message, parse_connected, parse_qr_data_url, whatsapp_session_dir,
        GATEWAY_CLIENT_ID, GATEWAY_CLIENT_MODE, GATEWAY_CLIENT_VERSION, GATEWAY_ROLE,
        GATEWAY_SCOPES,
    };

    #[test]
    fn test_whatsapp_session_dir_uses_unix_style_credentials_location() {
        assert_eq!(
            whatsapp_session_dir("/home/testuser"),
            "/home/testuser/.openclaw/credentials/whatsapp/default"
        );
    }

    #[test]
    fn test_whatsapp_session_dir_trims_trailing_slash() {
        assert_eq!(
            whatsapp_session_dir("/home/testuser/"),
            "/home/testuser/.openclaw/credentials/whatsapp/default"
        );
    }

    #[test]
    fn build_connect_message_includes_operator_scopes_and_auth_token() {
        let message = build_connect_message("req-1", Some("test-token"));
        let params = &message["params"];

        assert_eq!(message["type"], "req");
        assert_eq!(message["id"], "req-1");
        assert_eq!(message["method"], "connect");
        assert_eq!(params["client"]["id"], GATEWAY_CLIENT_ID);
        assert_eq!(params["client"]["version"], GATEWAY_CLIENT_VERSION);
        assert_eq!(params["client"]["mode"], GATEWAY_CLIENT_MODE);
        assert_eq!(params["role"], GATEWAY_ROLE);
        assert_eq!(params["scopes"], serde_json::json!(GATEWAY_SCOPES));
        assert_eq!(params["auth"]["token"], "test-token");
    }

    #[test]
    fn parse_qr_data_url_returns_gateway_error_text() {
        let response = serde_json::json!({
            "ok": false,
            "error": {
                "code": "INVALID_REQUEST",
                "message": "missing scope: operator.admin"
            }
        });

        let error = parse_qr_data_url(&response).unwrap_err();

        assert_eq!(
            error,
            "Gateway error: {\"code\":\"INVALID_REQUEST\",\"message\":\"missing scope: operator.admin\"}"
        );
    }

    #[test]
    fn parse_qr_data_url_returns_qr_when_present() {
        let response = serde_json::json!({
            "ok": true,
            "payload": {
                "qrDataUrl": "data:image/png;base64,abc123"
            }
        });

        let qr = parse_qr_data_url(&response).unwrap();

        assert_eq!(qr.as_deref(), Some("data:image/png;base64,abc123"));
    }

    #[test]
    fn parse_connected_returns_connected_state() {
        let response = serde_json::json!({
            "ok": true,
            "payload": {
                "connected": true
            }
        });

        let connected = parse_connected(&response).unwrap();

        assert_eq!(connected, Some(true));
    }
}
