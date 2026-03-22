use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey};
use std::path::Path;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use lazy_static::lazy_static;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
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
const GATEWAY_PAIRING_SCOPES: [&str; 2] = ["operator.admin", "operator.pairing"];
const CONNECT_CHALLENGE_WAIT: Duration = Duration::from_millis(750);

#[derive(Clone, Debug, PartialEq, Eq)]
struct GatewayDeviceIdentity {
    device_id: String,
    public_key: String,
    private_key: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct GatewayConnectDevice {
    id: String,
    public_key: String,
    signature: String,
    signed_at: u64,
    nonce: String,
}

lazy_static! {
    static ref GATEWAY_DEVICE_IDENTITY: std::sync::Mutex<Option<GatewayDeviceIdentity>> =
        std::sync::Mutex::new(None);
}

fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>()
}

fn load_or_create_gateway_device_identity() -> Result<GatewayDeviceIdentity, String> {
    let mut guard = GATEWAY_DEVICE_IDENTITY
        .lock()
        .map_err(|_| "Failed to lock gateway device identity state.".to_string())?;

    if let Some(identity) = guard.clone() {
        return Ok(identity);
    }

    let signing_key = SigningKey::generate(&mut OsRng);
    let public_key = signing_key.verifying_key().to_bytes();
    let identity = GatewayDeviceIdentity {
        device_id: sha256_hex(&public_key),
        public_key: base64url_encode(&public_key),
        private_key: signing_key.to_bytes(),
    };

    *guard = Some(identity.clone());
    Ok(identity)
}

fn current_time_millis() -> Result<u64, String> {
    Ok(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("System clock is before UNIX_EPOCH: {}", e))?
        .as_millis() as u64)
}

fn build_device_auth_payload(
    identity: &GatewayDeviceIdentity,
    auth_token: Option<&str>,
    scopes: &[&str],
    signed_at_ms: u64,
    nonce: &str,
) -> String {
    [
        "v2".to_string(),
        identity.device_id.clone(),
        GATEWAY_CLIENT_ID.to_string(),
        GATEWAY_CLIENT_MODE.to_string(),
        GATEWAY_ROLE.to_string(),
        scopes.join(","),
        signed_at_ms.to_string(),
        auth_token.unwrap_or("").to_string(),
        nonce.to_string(),
    ]
    .join("|")
}

fn build_connect_device(
    identity: &GatewayDeviceIdentity,
    auth_token: Option<&str>,
    scopes: &[&str],
    nonce: &str,
) -> Result<GatewayConnectDevice, String> {
    let signed_at = current_time_millis()?;
    let payload = build_device_auth_payload(identity, auth_token, scopes, signed_at, nonce);
    let signing_key = SigningKey::from_bytes(&identity.private_key);
    let signature = signing_key.sign(payload.as_bytes()).to_bytes();

    Ok(GatewayConnectDevice {
        id: identity.device_id.clone(),
        public_key: identity.public_key.clone(),
        signature: base64url_encode(&signature),
        signed_at,
        nonce: nonce.to_string(),
    })
}

fn build_connect_message(
    connect_req_id: &str,
    auth_token: Option<&str>,
    scopes: &[&str],
    device: Option<&GatewayConnectDevice>,
) -> serde_json::Value {
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
            "scopes": scopes
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

    if let Some(device) = device {
        if let Some(params) = connect_msg
            .get_mut("params")
            .and_then(|params| params.as_object_mut())
        {
            params.insert(
                "device".to_string(),
                serde_json::json!({
                    "id": device.id,
                    "publicKey": device.public_key,
                    "signature": device.signature,
                    "signedAt": device.signed_at,
                    "nonce": device.nonce,
                }),
            );
        }
    }

    connect_msg
}

fn read_gateway_error_text(value: &serde_json::Value) -> Option<String> {
    value
        .get("error")
        .and_then(|error| serde_json::to_string(error).ok())
}

fn parse_connect_challenge_nonce(value: &serde_json::Value) -> Option<String> {
    if value.get("type").and_then(|value| value.as_str()) != Some("event") {
        return None;
    }
    if value.get("event").and_then(|value| value.as_str()) != Some("connect.challenge") {
        return None;
    }
    value
        .get("payload")
        .and_then(|payload| payload.get("nonce"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn granted_scopes_from_connect_response(value: &serde_json::Value) -> Option<Vec<String>> {
    value
        .get("payload")
        .and_then(|payload| payload.get("auth"))
        .and_then(|auth| auth.get("scopes"))
        .and_then(|value| value.as_array())
        .map(|scopes| {
            scopes
                .iter()
                .filter_map(|scope| scope.as_str().map(|scope| scope.to_string()))
                .collect::<Vec<_>>()
        })
}

fn missing_scopes(required: &[&str], granted: &[String]) -> Vec<String> {
    required
        .iter()
        .filter(|required_scope| {
            !granted
                .iter()
                .any(|granted_scope| granted_scope == **required_scope)
        })
        .map(|scope| (*scope).to_string())
        .collect()
}

async fn send_connect_message(
    ws_stream: &mut GatewaySocket,
    connect_req_id: &str,
    auth_token: Option<&str>,
    scopes: &[&str],
    device: Option<&GatewayConnectDevice>,
) -> Result<(), String> {
    let connect_msg = build_connect_message(connect_req_id, auth_token, scopes, device);
    ws_stream
        .send(Message::Text(connect_msg.to_string()))
        .await
        .map_err(|e| format!("WebSocket send connect failed: {}", e))
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
    scopes: &[&str],
    max_attempts: u8,
) -> Result<GatewaySocket, String> {
    let url = format!("ws://127.0.0.1:{}", gateway_port);
    let device_identity = load_or_create_gateway_device_identity()?;

    for attempt in 0..max_attempts {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(10)).await;
        }

        let (mut ws_stream, _) = connect_async(&url)
            .await
            .map_err(|e| format!("WebSocket connect failed: {}", e))?;

        let connect_req_id = uuid::Uuid::new_v4().to_string();
        let mut handshake_ok = false;
        let mut needs_reconnect = false;
        let mut connect_sent = false;
        let connect_deadline = tokio::time::Instant::now() + CONNECT_CHALLENGE_WAIT;
        loop {
            if !connect_sent && tokio::time::Instant::now() >= connect_deadline {
                send_connect_message(&mut ws_stream, &connect_req_id, auth_token, scopes, None)
                    .await?;
                connect_sent = true;
                continue;
            }

            let next_message = if connect_sent {
                ws_stream.next().await
            } else {
                let wait_duration =
                    connect_deadline.saturating_duration_since(tokio::time::Instant::now());
                match tokio::time::timeout(wait_duration, ws_stream.next()).await {
                    Ok(message) => message,
                    Err(_) => {
                        send_connect_message(
                            &mut ws_stream,
                            &connect_req_id,
                            auth_token,
                            scopes,
                            None,
                        )
                        .await?;
                        connect_sent = true;
                        continue;
                    }
                }
            };

            let Some(msg) = next_message else {
                break;
            };

            match msg {
                Ok(Message::Text(text)) => {
                    let val: serde_json::Value =
                        serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                    if !connect_sent {
                        if let Some(nonce) = parse_connect_challenge_nonce(&val) {
                            let device =
                                build_connect_device(&device_identity, auth_token, scopes, &nonce)?;
                            send_connect_message(
                                &mut ws_stream,
                                &connect_req_id,
                                auth_token,
                                scopes,
                                Some(&device),
                            )
                            .await?;
                            connect_sent = true;
                            continue;
                        }
                    }
                    if val.get("id").and_then(|value| value.as_str()) == Some(&connect_req_id) {
                        if val.get("ok").and_then(|value| value.as_bool()) == Some(true) {
                            if let Some(granted_scopes) = granted_scopes_from_connect_response(&val)
                            {
                                let missing = missing_scopes(scopes, &granted_scopes);
                                if !missing.is_empty() {
                                    return Err(format!(
                                        "Gateway connect granted insufficient scopes: missing [{}], granted [{}]",
                                        missing.join(", "),
                                        granted_scopes.join(", ")
                                    ));
                                }
                            }
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
    let mut ws_stream = connect_gateway(
        gateway_port,
        Some(auth_token.as_str()),
        &GATEWAY_PAIRING_SCOPES,
        5,
    )
    .await?;

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
    let mut ws_stream = connect_gateway(
        gateway_port,
        Some(auth_token.as_str()),
        &GATEWAY_PAIRING_SCOPES,
        5,
    )
    .await?;

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
    let mut ws_stream = match connect_gateway(
        gateway_port,
        Some(auth_token.as_str()),
        &GATEWAY_PAIRING_SCOPES,
        1,
    )
    .await
    {
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
        build_connect_device, build_connect_message, build_device_auth_payload,
        granted_scopes_from_connect_response, missing_scopes, parse_connect_challenge_nonce,
        parse_connected, parse_qr_data_url, whatsapp_session_dir, GatewayConnectDevice,
        GatewayDeviceIdentity, GATEWAY_CLIENT_ID, GATEWAY_CLIENT_MODE, GATEWAY_CLIENT_VERSION,
        GATEWAY_PAIRING_SCOPES, GATEWAY_ROLE,
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
    fn build_connect_message_uses_pairing_scope_and_auth_token() {
        let message =
            build_connect_message("req-1", Some("test-token"), &GATEWAY_PAIRING_SCOPES, None);
        let params = &message["params"];

        assert_eq!(message["type"], "req");
        assert_eq!(message["id"], "req-1");
        assert_eq!(message["method"], "connect");
        assert_eq!(params["client"]["id"], GATEWAY_CLIENT_ID);
        assert_eq!(params["client"]["version"], GATEWAY_CLIENT_VERSION);
        assert_eq!(params["client"]["mode"], GATEWAY_CLIENT_MODE);
        assert_eq!(params["role"], GATEWAY_ROLE);
        assert_eq!(params["scopes"], serde_json::json!(GATEWAY_PAIRING_SCOPES));
        assert_eq!(params["auth"]["token"], "test-token");
    }

    #[test]
    fn build_connect_message_uses_backend_gateway_client_identity() {
        let message =
            build_connect_message("req-1", Some("test-token"), &GATEWAY_PAIRING_SCOPES, None);
        let client = &message["params"]["client"];

        assert_eq!(client["id"], "gateway-client");
        assert_eq!(client["mode"], "backend");
    }

    #[test]
    fn build_device_auth_payload_matches_webchat_contract() {
        let identity = GatewayDeviceIdentity {
            device_id: "device-1".to_string(),
            public_key: "public".to_string(),
            private_key: [7; 32],
        };

        let payload = build_device_auth_payload(
            &identity,
            Some("token-123"),
            &GATEWAY_PAIRING_SCOPES,
            1234,
            "nonce-123",
        );

        assert_eq!(
            payload,
            "v2|device-1|gateway-client|backend|operator|operator.admin,operator.pairing|1234|token-123|nonce-123"
        );
    }

    #[test]
    fn build_connect_message_includes_signed_device_auth() {
        let device = GatewayConnectDevice {
            id: "device-1".to_string(),
            public_key: "public".to_string(),
            signature: "signature".to_string(),
            signed_at: 1234,
            nonce: "nonce-123".to_string(),
        };

        let message = build_connect_message(
            "req-1",
            Some("test-token"),
            &GATEWAY_PAIRING_SCOPES,
            Some(&device),
        );

        assert_eq!(message["params"]["device"]["id"], "device-1");
        assert_eq!(message["params"]["device"]["publicKey"], "public");
        assert_eq!(message["params"]["device"]["signature"], "signature");
        assert_eq!(message["params"]["device"]["signedAt"], 1234);
        assert_eq!(message["params"]["device"]["nonce"], "nonce-123");
    }

    #[test]
    fn build_connect_device_uses_nonce_and_signs_payload() {
        let identity = GatewayDeviceIdentity {
            device_id: "device-1".to_string(),
            public_key: "public".to_string(),
            private_key: [7; 32],
        };

        let device = build_connect_device(
            &identity,
            Some("token-123"),
            &GATEWAY_PAIRING_SCOPES,
            "nonce-123",
        )
        .expect("device auth should build");

        assert_eq!(device.id, "device-1");
        assert_eq!(device.public_key, "public");
        assert_eq!(device.nonce, "nonce-123");
        assert!(device.signed_at > 0);
        assert!(!device.signature.is_empty());
    }

    #[test]
    fn parse_connect_challenge_nonce_reads_nonce() {
        let response = serde_json::json!({
            "type": "event",
            "event": "connect.challenge",
            "payload": {
                "nonce": "nonce-123"
            }
        });

        assert_eq!(
            parse_connect_challenge_nonce(&response).as_deref(),
            Some("nonce-123")
        );
    }

    #[test]
    fn granted_scopes_from_connect_response_reads_auth_scopes() {
        let response = serde_json::json!({
            "type": "res",
            "ok": true,
            "payload": {
                "auth": {
                    "scopes": ["operator.admin", "operator.pairing"]
                }
            }
        });

        assert_eq!(
            granted_scopes_from_connect_response(&response),
            Some(vec![
                "operator.admin".to_string(),
                "operator.pairing".to_string()
            ])
        );
    }

    #[test]
    fn missing_scopes_reports_requested_scope_gap() {
        let missing = missing_scopes(&GATEWAY_PAIRING_SCOPES, &[String::from("operator.pairing")]);

        assert_eq!(missing, vec!["operator.admin".to_string()]);
    }

    #[test]
    fn gateway_pairing_scopes_include_admin() {
        assert!(
            GATEWAY_PAIRING_SCOPES.contains(&"operator.admin"),
            "GATEWAY_PAIRING_SCOPES must include operator.admin for web.login.start/wait"
        );
        assert!(
            GATEWAY_PAIRING_SCOPES.contains(&"operator.pairing"),
            "GATEWAY_PAIRING_SCOPES must include operator.pairing for device pairing"
        );
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
