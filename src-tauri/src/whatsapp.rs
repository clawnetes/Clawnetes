use std::path::Path;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::ssh::{connect_ssh, execute_ssh};
use crate::types::RemoteInfo;

type GatewaySocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

fn read_gateway_auth_token(remote: Option<&RemoteInfo>) -> Result<Option<String>, String> {
    if let Some(remote) = remote {
        let sess = connect_ssh(remote)?;
        let home = execute_ssh(&sess, "echo $HOME").unwrap_or_default();
        let json_str = execute_ssh(
            &sess,
            &format!("cat {}/.openclaw/openclaw.json", home.trim()),
        )
        .unwrap_or_default();
        Ok(serde_json::from_str::<serde_json::Value>(&json_str)
            .ok()
            .and_then(|config| {
                config
                    .get("gateway")
                    .and_then(|gateway| gateway.get("auth"))
                    .and_then(|auth| auth.get("token"))
                    .and_then(|token| token.as_str())
                    .map(|token| token.to_string())
            }))
    } else {
        let home_dir = dirs::home_dir()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default();
        let json_str = std::fs::read_to_string(format!("{}/.openclaw/openclaw.json", home_dir))
            .unwrap_or_default();
        Ok(serde_json::from_str::<serde_json::Value>(&json_str)
            .ok()
            .and_then(|config| {
                config
                    .get("gateway")
                    .and_then(|gateway| gateway.get("auth"))
                    .and_then(|auth| auth.get("token"))
                    .and_then(|token| token.as_str())
                    .map(|token| token.to_string())
            }))
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
        let mut connect_msg = serde_json::json!({
            "type": "req",
            "id": connect_req_id,
            "method": "connect",
            "params": {
                "client": {
                    "id": "gateway-client",
                    "version": "1.0",
                    "platform": std::env::consts::OS,
                    "mode": "backend"
                },
                "minProtocol": 3,
                "maxProtocol": 3,
                "role": "operator",
                "scopes": ["operator.admin"]
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

                        if error_code == "NOT_PAIRED"
                            || detail_code == "DEVICE_IDENTITY_REQUIRED"
                        {
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
    let mut ws_stream = connect_gateway(gateway_port, auth_token.as_deref(), 5).await?;

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
                    if val.get("ok").and_then(|value| value.as_bool()).unwrap_or(false) {
                        if let Some(qr) = val
                            .get("payload")
                            .and_then(|payload| payload.get("qrDataUrl"))
                            .and_then(|value| value.as_str())
                        {
                            return Ok(qr.to_string());
                        }
                        return Err("Gateway returned ok but no QR code (already linked?)".to_string());
                    }
                    if let Some(err) = val.get("error") {
                        return Err(format!("Gateway error: {}", err));
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
    let mut ws_stream = connect_gateway(gateway_port, auth_token.as_deref(), 5).await?;

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
                        if val.get("ok").and_then(|value| value.as_bool()).unwrap_or(false) {
                            return Ok(val
                                .get("payload")
                                .and_then(|payload| payload.get("connected"))
                                .and_then(|value| value.as_bool())
                                .unwrap_or(false));
                        }
                        if let Some(err) = val.get("error") {
                            return Err(format!("Gateway error: {}", err));
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
    let home_dir = dirs::home_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let session_dir = format!("{}/.openclaw/credentials/whatsapp/default", home_dir);
    if Path::new(&session_dir).exists() {
        std::fs::remove_dir_all(&session_dir)
            .map_err(|e| format!("Failed to delete whatsapp session: {}", e))?;
    }
    Ok(())
}

pub async fn check_whatsapp_linked(gateway_port: u16) -> Result<bool, String> {
    let auth_token = read_gateway_auth_token(None)?;
    let mut ws_stream = match connect_gateway(gateway_port, auth_token.as_deref(), 1).await {
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
                        if val.get("ok").and_then(|value| value.as_bool()).unwrap_or(false) {
                            let has_qr = val
                                .get("payload")
                                .and_then(|payload| payload.get("qrDataUrl"))
                                .and_then(|value| value.as_str())
                                .is_some();
                            return Ok(!has_qr);
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
