//! LAN multiplayer plumbing (idea: Online Games, phase 1 — the fork's
//! first backend layer). A tiny newline-delimited JSON pipe over TCP:
//! one device HOSTS (listens), the other CONNECTS (dial). The frontend
//! never touches sockets directly — it talks to this module through
//! Tauri commands and receives peer traffic as Tauri events:
//!
//! - `lan://peer-joined` { name }        the client completed the join
//! - `lan://peer-message` { message }    a JSON message from the peer
//! - `lan://peer-left` { reason }        the peer disconnected
//! - `lan://client-error` { error }      client-side socket error
//!
//! Only ONE live connection is supported (two players, one match).
//! Messages are size-capped and must be JSON objects. No persistence.

use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};

const LAN_PORT_DEFAULT: u16 = 51987;
const MAX_MESSAGE_BYTES: usize = 64 * 1024;
/// unambiguous alphabet for the 4-char join code (no 0/O/1/I/L)
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

pub struct LanState {
    pub host: Mutex<Option<HostHandle>>,
    pub client: Mutex<Option<mpsc::UnboundedSender<String>>>,
}

#[allow(dead_code)] //session_id/code/port: read by the discovery beacon (phase 3)
pub struct HostHandle {
    session_id: String,
    code: String,
    port: u16,
    shutdown: oneshot::Sender<()>,
    to_client: mpsc::UnboundedSender<String>,
}

fn nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u128 + d.as_secs() as u128 * 1_000_000_000)
        .unwrap_or(12345)
}

fn gen_code(nanos: u128) -> String {
    let mut seed = (nanos % 1_000_000_007) as usize;
    let mut out = String::new();
    for _ in 0..4 {
        seed = seed.wrapping_mul(48271).wrapping_add(11);
        out.push(CODE_ALPHABET[seed % CODE_ALPHABET.len()] as char);
    }
    out
}

fn local_ip() -> String {
    // the routing-table trick: no packet is sent, only the local endpoint
    // of a would-be connection is resolved
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".into()
}

fn emit(app: &AppHandle, event: &str, payload: Value) {
    let _ = app.emit(event, payload);
}

/// starts the host: binds a TCP listener (OS-assigned port), waits for
/// ONE client, validates its join code, then relays messages. The host
/// stays up until `lan_stop_host` or the peer leaves.
#[tauri::command]
pub async fn lan_start_host(
    app: AppHandle,
    state: State<'_, LanState>,
    name: String,
) -> Result<Value, String> {
    if state.host.lock().map_err(|_| "lan state poisoned")?.is_some() {
        return Err("lan: already hosting".into());
    }
    let code = gen_code(nanos());
    let session_id = format!("lan-{}/{}", nanos() % 1_000_000, code);
    let listener = TcpListener::bind(format!("0.0.0.0:{LAN_PORT_DEFAULT}"))
        .await
        .map_err(|e| format!("lan: bind failed ({e})"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("lan: local addr failed ({e})"))?
        .port();
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let (to_client, client_rx) = mpsc::unbounded_channel::<String>();

    let app2 = app.clone();
    let code2 = code.clone();
    let session2 = session_id.clone();
    let name2 = name.clone();
    tauri::async_runtime::spawn(async move {
        run_host(app2, session2, code2, name2, listener, shutdown_rx, client_rx).await;
    });

    let mut guard = state.host.lock().map_err(|_| "lan state poisoned")?;
    if guard.is_some() {
        return Err("lan: already hosting".into()); //a race with a parallel start
    }
    let handle = HostHandle {
        session_id: session_id.clone(),
        code: code.clone(),
        port,
        shutdown: shutdown_tx,
        to_client,
    };
    *guard = Some(handle);

    Ok(serde_json::json!({
        "sessionId": session_id,
        "code": code,
        "port": port,
        "ip": local_ip(),
        "name": name,
    }))
}

/// stops the host (drops the listener and the peer connection)
#[tauri::command]
pub fn lan_stop_host(state: State<'_, LanState>) -> Result<(), String> {
    let mut guard = state.host.lock().map_err(|_| "lan state poisoned")?;
    if let Some(handle) = guard.take() {
        let _ = handle.shutdown.send(());
    }
    Ok(())
}

/// sends a JSON message to the connected peer (host side)
#[tauri::command]
pub fn lan_send_message(state: State<'_, LanState>, message: Value) -> Result<(), String> {
    if let Value::Object(_) = &message {
    } else {
        return Err("lan: message must be a JSON object".into());
    }
    let mut text = message.to_string();
    if text.len() > MAX_MESSAGE_BYTES {
        return Err("lan: message too large".into());
    }
    text.push('\n');
    let guard = state.host.lock().map_err(|_| "lan state poisoned")?;
    match &guard.as_ref().ok_or("lan: not hosting")?.to_client {
        tx => tx.send(text).map_err(|_| "lan: peer gone".into()),
    }
}

/// connects this device to a host (the client side): validates the join
/// code, then relays host messages as `lan://peer-message` events
#[tauri::command]
pub async fn lan_connect_client(
    app: AppHandle,
    state: State<'_, LanState>,
    addr: String,
    name: String,
    code: String,
) -> Result<Value, String> {
    if state
        .client
        .lock()
        .map_err(|_| "lan state poisoned")?
        .is_some()
    {
        return Err("lan: already connected".into());
    }
    let stream = tokio::net::TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("lan: connect failed ({e})"))?;
    let (read, mut write) = tokio::io::split(stream);
    let join = serde_json::json!({ "type": "join", "name": name, "code": code });
    write
        .write_all(format!("{}\n", join).as_bytes())
        .await
        .map_err(|e| format!("lan: join failed ({e})"))?;
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(read).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.len() > MAX_MESSAGE_BYTES {
                        continue;
                    }
                    if let Ok(message) = serde_json::from_str::<Value>(&line) {
                        emit(&app2, "lan://peer-message", serde_json::json!({ "message": message }));
                    }
                }
                _ => {
                    emit(&app2, "lan://client-error", serde_json::json!({ "error": "disconnected" }));
                    break;
                }
            }
        }
    });

    // the client's own sends flow through here
    tauri::async_runtime::spawn(async move {
        while let Some(text) = rx.recv().await {
            if write.write_all(text.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    let mut guard = state.client.lock().map_err(|_| "lan state poisoned")?;
    if guard.is_some() {
        return Err("lan: already connected".into()); //a race with a parallel connect
    }
    *guard = Some(tx);
    emit(&app, "lan://peer-joined", serde_json::json!({ "name": name }));
    Ok(serde_json::json!({ "connected": true, "addr": addr }))
}

/// sends a JSON message to the host (client side)
#[tauri::command]
pub fn lan_client_send(state: State<'_, LanState>, message: Value) -> Result<(), String> {
    let mut text = message.to_string();
    if text.len() > MAX_MESSAGE_BYTES {
        return Err("lan: message too large".into());
    }
    text.push('\n');
    let guard = state.client.lock().map_err(|_| "lan state poisoned")?;
    match &guard.as_ref().ok_or("lan: not connected")? {
        tx => tx.send(text).map_err(|_| "lan: not connected".into()),
    }
}

/// drops the client connection
#[tauri::command]
pub fn lan_disconnect_client(state: State<'_, LanState>) -> Result<(), String> {
    let mut guard = state.client.lock().map_err(|_| "lan state poisoned")?;
    guard.take();
    Ok(())
}

async fn run_host(
    app: AppHandle,
    session_id: String,
    code: String,
    host_name: String,
    listener: TcpListener,
    mut shutdown_rx: oneshot::Receiver<()>,
    mut to_client: mpsc::UnboundedReceiver<String>,
) {
    let stream = tokio::select! {
        _ = &mut shutdown_rx => return,
        accepted = listener.accept() => match accepted {
            Ok((stream, _addr)) => stream,
            Err(_) => return,
        },
    };
    let (read, mut write) = tokio::io::split(stream);
    let mut lines = BufReader::new(read).lines();

    // the first line must be a valid join with the session's code
    let joined = loop {
        tokio::select! {
            _ = &mut shutdown_rx => return,
            line = lines.next_line() => match line {
                Ok(Some(line)) => {
                    let parsed: Result<Value, _> = serde_json::from_str(&line);
                    match parsed {
                        Ok(v) if v["type"] == "join" && v["code"] == code.as_str() => {
                            break v["name"].as_str().unwrap_or("P2").to_string();
                        }
                        _ => continue, //ignore anything else before the join
                    }
                }
                _ => return,
            },
        }
    };
    emit(&app, "lan://peer-joined", serde_json::json!({ "name": joined, "host": host_name, "sessionId": session_id }));

    // forward peer messages to the frontend
    let app2 = app.clone();
    let read_task = tauri::async_runtime::spawn(async move {
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.len() > MAX_MESSAGE_BYTES {
                        continue;
                    }
                    if let Ok(message) = serde_json::from_str::<Value>(&line) {
                        emit(&app2, "lan://peer-message", serde_json::json!({ "message": message }));
                    }
                }
                _ => {
                    emit(&app2, "lan://peer-left", serde_json::json!({ "reason": "disconnected" }));
                    break;
                }
            }
        }
    });

    // forward the frontend's sends to the peer
    while let Some(text) = to_client.recv().await {
        if write.write_all(text.as_bytes()).await.is_err() {
            break;
        }
    }
    read_task.abort();
}
