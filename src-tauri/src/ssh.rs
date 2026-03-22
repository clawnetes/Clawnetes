use ssh2::Session;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use crate::types::RemoteInfo;

lazy_static! {
    pub static ref TUNNEL_RUNNING: AtomicBool = AtomicBool::new(false);
}

pub const GATEWAY_TUNNEL_PORT: u16 = 18789;

pub fn get_env_prefix(os_type: &str) -> String {
    if os_type == "Darwin" {
        "eval \"$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)\"; export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; ".to_string()
    } else if os_type == "Windows" {
        // WSL2: Source profile and try to load NVM explicitly
        "export PATH=\"$PATH:/usr/local/bin\"; . ~/.profile 2>/dev/null; export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; ".to_string()
    } else {
        // Linux: Source profile and try to load NVM explicitly
        "export PATH=\"$PATH:/usr/local/bin\"; . ~/.profile 2>/dev/null; export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\"; ".to_string()
    }
}

pub fn authenticate_with_key(sess: &Session, user: &str, key_path: &Path) -> Result<(), String> {
    // Strategy 1: Try with None for public key (modern libssh2 often handles this)
    if sess
        .userauth_pubkey_file(user, None, key_path, None)
        .is_ok()
    {
        return Ok(());
    }

    // Strategy 2: Try with an explicit .pub file if it exists
    let mut pubkey_path = key_path.to_path_buf();
    pubkey_path.set_extension("pub");
    if pubkey_path.exists() {
        if sess
            .userauth_pubkey_file(user, Some(&pubkey_path), key_path, None)
            .is_ok()
        {
            return Ok(());
        }
    }

    // Strategy 3: Try generating the public key on the fly using ssh-keygen
    let output = Command::new("ssh-keygen")
        .args(["-y", "-P", "", "-f", &key_path.to_string_lossy()])
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            let pubkey_content = String::from_utf8_lossy(&out.stdout);
            let temp_dir = std::env::temp_dir();
            let temp_pubkey = temp_dir.join(format!("temp_ssh_key_{}.pub", rand::random::<u32>()));

            if fs::write(&temp_pubkey, pubkey_content.as_bytes()).is_ok() {
                let res = sess.userauth_pubkey_file(user, Some(&temp_pubkey), key_path, None);
                let _ = fs::remove_file(temp_pubkey);
                if res.is_ok() {
                    return Ok(());
                }
            }
        }
    }

    // If all failed, return a informative error
    Err("Key authentication failed. libssh2 reported an error. Please ensure the key is a valid OpenSSH format, matches the remote user, and is not passphrase-protected.".to_string())
}

pub fn connect_ssh(remote: &RemoteInfo) -> Result<Session, String> {
    let tcp = TcpStream::connect(format!("{}:22", remote.ip))
        .map_err(|e| format!("Failed to connect to port 22: {}", e))?;
    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH handshake failed: {}", e))?;

    // 1. Try provided private key path if it exists
    // If a key is explicitly provided, ONLY use that key and don't fallback
    if let Some(ref path) = remote.private_key_path {
        let key_path = Path::new(path);
        if !key_path.exists() {
            return Err(format!(
                "The provided private key file does not exist at: {}",
                path
            ));
        }

        // Use the improved authentication helper - fail if it doesn't work
        authenticate_with_key(&sess, &remote.user, key_path)?;
        return Ok(sess);
    }

    // 2. Try SSH agent
    if sess.userauth_agent(&remote.user).is_ok() {
        return Ok(sess);
    }

    // 3. Try default keys
    if let Some(home) = dirs::home_dir() {
        let keys = [
            home.join(".ssh").join("id_rsa"),
            home.join(".ssh").join("id_ed25519"),
        ];
        for key in keys {
            if key.exists() {
                if sess
                    .userauth_pubkey_file(&remote.user, None, &key, None)
                    .is_ok()
                {
                    return Ok(sess);
                }
            }
        }
    }

    // 4. Try password
    if let Some(ref pw) = remote.password {
        if sess.userauth_password(&remote.user, pw).is_ok() {
            return Ok(sess);
        }
    }

    Err("SSH Authentication failed".to_string())
}

pub fn execute_ssh(sess: &Session, cmd: &str) -> Result<String, String> {
    let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
    channel.exec(cmd).map_err(|e| e.to_string())?;
    let mut s = String::new();
    channel.read_to_string(&mut s).map_err(|e| e.to_string())?;
    let mut stderr = String::new();
    channel
        .stderr()
        .read_to_string(&mut stderr)
        .map_err(|e| e.to_string())?;
    let _ = channel.wait_close();

    if channel.exit_status().unwrap_or(0) != 0 {
        return Err(format!("Command failed: {}\nStderr: {}", cmd, stderr));
    }
    Ok(s)
}

pub fn is_tunnel_listener_reachable(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn should_reset_stale_tunnel_state(tunnel_running: bool, listener_reachable: bool) -> bool {
    tunnel_running && !listener_reachable
}

pub fn start_ssh_tunnel(remote: &RemoteInfo) -> Result<String, String> {
    if should_reset_stale_tunnel_state(
        TUNNEL_RUNNING.load(Ordering::Relaxed),
        is_tunnel_listener_reachable(GATEWAY_TUNNEL_PORT),
    ) {
        TUNNEL_RUNNING.store(false, Ordering::Relaxed);
        thread::sleep(Duration::from_millis(100));
    }

    if TUNNEL_RUNNING.load(Ordering::Relaxed) {
        return Err("SSH tunnel is already running".to_string());
    }

    TUNNEL_RUNNING.store(true, Ordering::Relaxed);
    let remote_info = remote.clone();

    thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", GATEWAY_TUNNEL_PORT)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("Failed to bind local port {}: {}", GATEWAY_TUNNEL_PORT, e);
                TUNNEL_RUNNING.store(false, Ordering::Relaxed);
                return;
            }
        };

        let _ = listener.set_nonblocking(true);

        while TUNNEL_RUNNING.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let remote_clone = remote_info.clone();
                    thread::spawn(move || {
                        let sess = match connect_ssh(&remote_clone) {
                            Ok(s) => s,
                            Err(e) => {
                                eprintln!("Failed to connect SSH for tunnel: {}", e);
                                return;
                            }
                        };

                        let mut remote_channel =
                            match sess.channel_direct_tcpip("127.0.0.1", GATEWAY_TUNNEL_PORT, None)
                            {
                                Ok(c) => c,
                                Err(e) => {
                                    eprintln!("Failed to open SSH channel for tunnel: {}", e);
                                    return;
                                }
                            };

                        let _ = stream.set_nonblocking(true);
                        sess.set_blocking(false);

                        let mut buf1 = [0; 16384];
                        let mut buf2 = [0; 16384];

                        loop {
                            if !TUNNEL_RUNNING.load(Ordering::Relaxed) {
                                break;
                            }
                            let mut active = false;

                            match stream.read(&mut buf1) {
                                Ok(0) => break,
                                Ok(n) => {
                                    active = true;
                                    let mut sent = 0;
                                    while sent < n {
                                        match remote_channel.write(&buf1[sent..n]) {
                                            Ok(m) => sent += m,
                                            Err(e)
                                                if e.kind() == std::io::ErrorKind::WouldBlock =>
                                            {
                                                thread::sleep(Duration::from_millis(5));
                                            }
                                            Err(_) => break,
                                        }
                                    }
                                }
                                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                Err(_) => break,
                            }

                            match remote_channel.read(&mut buf2) {
                                Ok(0) => break,
                                Ok(n) => {
                                    active = true;
                                    let mut sent = 0;
                                    while sent < n {
                                        match stream.write(&buf2[sent..n]) {
                                            Ok(m) => sent += m,
                                            Err(e)
                                                if e.kind() == std::io::ErrorKind::WouldBlock =>
                                            {
                                                thread::sleep(Duration::from_millis(5));
                                            }
                                            Err(_) => break,
                                        }
                                    }
                                }
                                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                Err(_) => break,
                            }

                            if !active {
                                thread::sleep(Duration::from_millis(10));
                            }
                        }
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
        TUNNEL_RUNNING.store(false, Ordering::Relaxed);
    });

    Ok("SSH tunnel started".to_string())
}

pub fn stop_ssh_tunnel() {
    TUNNEL_RUNNING.store(false, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_reset_stale_tunnel_state_only_when_flag_is_stale() {
        assert!(should_reset_stale_tunnel_state(true, false));
        assert!(!should_reset_stale_tunnel_state(true, true));
        assert!(!should_reset_stale_tunnel_state(false, false));
    }
}
