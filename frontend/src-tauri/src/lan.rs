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
//!
//! Discovery (phase 3): while a match is open, the host BROADCASTS a UDP
//! beacon every second on port 51988 so other devices' lobbies can list
//! it; every app also runs a discovery listener that collects those
//! beacons into a stale-pruned list the frontend polls
//! (`lan_get_discovered`). Nothing but the beacon payload is trusted —
//! foreign app tags are dropped, and a host never lists itself.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};

const LAN_PORT_DEFAULT: u16 = 51987;
const MAX_MESSAGE_BYTES: usize = 64 * 1024;
/// unambiguous alphabet for the 4-char join code (no 0/O/1/I/L)
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/// UDP port the host beacon broadcasts to and discovery listeners bind
const DISCOVERY_PORT: u16 = 51988;
/// beacons with a different app tag are ignored (other apps' chatter)
const DISCOVERY_APP_TAG: &str = "paralleltype-lan-v1";
const DISCOVERY_INTERVAL_MS: u64 = 1000;
/// a session not heard from for this long disappears from the list
const DISCOVERY_STALE_MS: u64 = 5000;

pub struct LanState {
    pub host: Mutex<Option<HostHandle>>,
    pub client: Mutex<Option<mpsc::UnboundedSender<String>>>,
    /// live discovery results by session id (pruned on every read)
    pub discovered: Mutex<HashMap<String, DiscoveredSession>>,
    /// shuts the discovery listener down; None = not listening
    pub discovery: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DiscoveredSession {
    pub session_id: String,
    pub name: String,
    pub code: String,
    pub port: u16,
    pub ip: String,
    /// last-seen timestamp (ms) — the staleness marker
    pub seen_ms: u64,
}

#[allow(dead_code)] //session_id/code/port mirror the host info the frontend got
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

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
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

/// validates a raw beacon: our app tag, every field present, and never
/// our own session (the OS loops the host's broadcast back to itself).
/// `sender_ip` fills the ip when the payload doesn't carry one.
fn parse_announcement(
    bytes: &[u8],
    sender_ip: &str,
    own_session: Option<&str>,
) -> Option<DiscoveredSession> {
    if bytes.len() > 2048 {
        return None;
    }
    let announce: Value = serde_json::from_slice(bytes).ok()?;
    if announce["app"] != DISCOVERY_APP_TAG {
        return None;
    }
    let session_id = announce["sessionId"].as_str()?.to_string();
    if own_session == Some(session_id.as_str()) {
        return None;
    }
    Some(DiscoveredSession {
        session_id,
        name: announce["name"].as_str()?.to_string(),
        code: announce["code"].as_str()?.to_string(),
        port: u16::try_from(announce["port"].as_u64()?).ok()?,
        ip: match announce["ip"].as_str() {
            Some(ip) => ip.to_string(),
            None => sender_ip.to_string(),
        },
        seen_ms: now_ms(),
    })
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

/// starts the discovery listener: beacons heard on the UDP port land in
/// the pruned list behind `lan_get_discovered`. Idempotent — the lobby
/// may call this on every mount.
#[tauri::command]
pub async fn lan_start_discovery(
    app: AppHandle,
    state: State<'_, LanState>,
) -> Result<(), String> {
    let mut guard = state.discovery.lock().map_err(|_| "lan state poisoned")?;
    if guard.is_some() {
        return Ok(());
    }
    let sock = std::net::UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT))
        .map_err(|e| format!("lan: discovery bind failed ({e})"))?;
    sock.set_nonblocking(true)
        .map_err(|e| format!("lan: discovery bind failed ({e})"))?;
    let sock = tokio::net::UdpSocket::from_std(sock)
        .map_err(|e| format!("lan: discovery bind failed ({e})"))?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tauri::async_runtime::spawn(run_discovery(app, sock, shutdown_rx));
    *guard = Some(shutdown_tx);
    Ok(())
}

/// stops the discovery listener and forgets the list
#[tauri::command]
pub fn lan_stop_discovery(state: State<'_, LanState>) -> Result<(), String> {
    let mut guard = state.discovery.lock().map_err(|_| "lan state poisoned")?;
    if let Some(shutdown) = guard.take() {
        let _ = shutdown.send(());
    }
    state
        .discovered
        .lock()
        .map_err(|_| "lan state poisoned")?
        .clear();
    Ok(())
}

/// the current discovered list — stale sessions (silent for 5s) pruned,
/// newest first
#[tauri::command]
pub fn lan_get_discovered(state: State<'_, LanState>) -> Result<Value, String> {
    let now = now_ms();
    let mut discovered = state.discovered.lock().map_err(|_| "lan state poisoned")?;
    discovered.retain(|_, session| now.saturating_sub(session.seen_ms) <= DISCOVERY_STALE_MS);
    let mut sessions: Vec<&DiscoveredSession> = discovered.values().collect();
    sessions.sort_by(|a, b| b.seen_ms.cmp(&a.seen_ms));
    Ok(Value::Array(
        sessions
            .iter()
            .map(|session| {
                serde_json::json!({
                    "sessionId": session.session_id,
                    "name": session.name,
                    "code": session.code,
                    "port": session.port,
                    "ip": session.ip,
                })
            })
            .collect(),
    ))
}

async fn run_discovery(
    app: AppHandle,
    sock: tokio::net::UdpSocket,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    let mut buf = [0u8; 2048];
    loop {
        let (len, from) = tokio::select! {
            _ = &mut shutdown_rx => return,
            received = sock.recv_from(&mut buf) => match received {
                Ok(received) => received,
                Err(_) => return,
            },
        };
        let own = app
            .state::<LanState>()
            .host
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|handle| handle.session_id.clone()));
        let Some(session) =
            parse_announcement(&buf[..len], &from.ip().to_string(), own.as_deref())
        else {
            continue;
        };
        if let Ok(mut discovered) = app.state::<LanState>().discovered.lock() {
            discovered.insert(session.session_id.clone(), session);
        }
    }
}

/// aborts the wrapped task when dropped — every run_host return path
/// must stop the beacon (the match either started or ended)
struct AbortOnDrop(tauri::async_runtime::JoinHandle<()>);

impl AbortOnDrop {
    fn stop(&self) {
        self.0.abort();
    }
}

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// broadcasts the host's presence once a second so the other device's
/// lobby can list the match — `dest` is injectable so tests can loop back
async fn run_beacon(
    host_name: String,
    session_id: String,
    code: String,
    port: u16,
    dest: String,
) {
    let payload = serde_json::json!({
        "app": DISCOVERY_APP_TAG,
        "name": host_name,
        "sessionId": session_id,
        "code": code,
        "port": port,
        "ip": local_ip(),
    })
    .to_string();
    let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") else {
        return;
    };
    if sock.set_broadcast(true).is_err() {
        return;
    }
    let mut tick = tokio::time::interval(Duration::from_millis(DISCOVERY_INTERVAL_MS));
    loop {
        tick.tick().await;
        let _ = sock.send_to(payload.as_bytes(), &dest);
    }
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
    let port = listener
        .local_addr()
        .map(|addr| addr.port())
        .unwrap_or(LAN_PORT_DEFAULT);
    //the discovery beacon runs while the match is open and stops the
    //moment a client joins — AbortOnDrop covers every return path
    let beacon = AbortOnDrop(tauri::async_runtime::spawn(run_beacon(
        host_name.clone(),
        session_id.clone(),
        code.clone(),
        port,
        format!("255.255.255.255:{DISCOVERY_PORT}"),
    )));
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
    beacon.stop(); //the match is found — no more broadcasting

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_announcement() {
        let payload = serde_json::json!({
            "app": DISCOVERY_APP_TAG,
            "name": "HOST1",
            "sessionId": "lan-1/ABCD",
            "code": "ABCD",
            "port": 51987,
            "ip": "192.168.1.5",
        });
        let session = parse_announcement(payload.to_string().as_bytes(), "10.0.0.9", None)
            .expect("a valid beacon parses");
        assert_eq!(session.name, "HOST1");
        assert_eq!(session.code, "ABCD");
        assert_eq!(session.port, 51987);
        assert_eq!(session.ip, "192.168.1.5");
        assert_eq!(session.session_id, "lan-1/ABCD");
    }

    #[test]
    fn rejects_foreign_apps_own_sessions_and_garbage() {
        let mut payload = serde_json::json!({
            "app": "someone-elses-app",
            "name": "X",
            "sessionId": "s1",
            "code": "ABCD",
            "port": 51987,
            "ip": "1.2.3.4",
        });
        assert!(
            parse_announcement(payload.to_string().as_bytes(), "1.2.3.4", None).is_none(),
            "a foreign app tag must be dropped"
        );
        payload["app"] = DISCOVERY_APP_TAG.into();
        assert!(
            parse_announcement(payload.to_string().as_bytes(), "1.2.3.4", Some("s1")).is_none(),
            "a host must not list its own session"
        );
        assert!(
            parse_announcement(payload.to_string().as_bytes(), "1.2.3.4", Some("other")).is_some(),
            "someone else's session under our app tag passes"
        );
        assert!(parse_announcement(b"not json", "1.2.3.4", None).is_none());
    }

    #[test]
    fn falls_back_to_the_sender_ip() {
        let payload = serde_json::json!({
            "app": DISCOVERY_APP_TAG,
            "name": "HOST1",
            "sessionId": "s1",
            "code": "ABCD",
            "port": 51987,
        });
        let session = parse_announcement(payload.to_string().as_bytes(), "192.168.1.7", None)
            .expect("parses without ip");
        assert_eq!(session.ip, "192.168.1.7");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn beacon_reaches_a_listener_on_loopback() {
        let listener = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind");
        let dest = format!("127.0.0.1:{}", listener.local_addr().expect("addr").port());
        let task = tokio::spawn(run_beacon(
            "HOST1".into(),
            "lan-1/ABCD".into(),
            "ABCD".into(),
            51987,
            dest,
        ));
        listener
            .set_read_timeout(Some(Duration::from_millis(3000)))
            .expect("timeout");
        let mut buf = [0u8; 2048];
        let (len, _) = listener.recv_from(&mut buf).expect("a beacon within 3s");
        task.abort();
        let session =
            parse_announcement(&buf[..len], "127.0.0.1", None).expect("the beacon parses");
        assert_eq!(session.name, "HOST1");
        assert_eq!(session.code, "ABCD");
        assert_eq!(session.port, 51987);
    }
}
