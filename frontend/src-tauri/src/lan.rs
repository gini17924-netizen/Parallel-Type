//! LAN multiplayer plumbing (idea: Online Games, phase 1 — the fork's
//! first backend layer). A tiny newline-delimited JSON pipe over TCP:
//! one device HOSTS (listens), the other CONNECTS (dial). The frontend
//! never touches sockets directly — it talks to this module through
//! Tauri commands and receives peer traffic as Tauri events:
//!
//! - `lan://peer-joined` { name }        the client completed the join
//!                                       (the ack carries the HOST's name)
//! - `lan://peer-message` { message }    a JSON message from the peer
//! - `lan://peer-left` { reason }        the peer disconnected
//! - `lan://client-error` { error }      client-side socket error
//!
//! Hardening (phase 5): the join handshake ends with the host's
//! `{type:"joined", name}` ack (no ack in 5s -> join failed); the host
//! releases the slot when no valid join arrives in 10s; every relayed
//! message must be a JSON object with a string `type` — a violation
//! closes the connection.
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
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
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
/// the join handshake must complete within this window or the slot is
/// released (a silent client must not pin the one connection forever)
const JOIN_TIMEOUT_SECS: u64 = 10;
/// the client waits this long for the host's joined ack
const ACK_TIMEOUT_SECS: u64 = 5;
/// hardening (phase H1): the manual connect's TCP attempt gets this
/// window — a firewall silently DROPPING the syn would otherwise hang
/// the join for the OS-level timeout (~21s of silence)
const CONNECT_TIMEOUT_SECS: u64 = 5;
/// hardening (phase 53): a peer's inbound stream is rate-limited — the
/// pipe serves exactly one two-player match, so anything beyond a
/// generous match-sized budget is hostile (flooded snapshots, spam)
const RATE_WINDOW_MS: u64 = 1000;
const RATE_MAX_MESSAGES: u32 = 120;
const RATE_MAX_BYTES: u64 = 384 * 1024;

/// a sliding-window rate limiter for ONE connection's inbound lines:
/// admits up to RATE_MAX_MESSAGES lines / RATE_MAX_BYTES bytes per
/// RATE_WINDOW_MS, then trips (the caller closes the connection). Pure —
/// the clock is injected so tests can drive the window.
pub struct RateLimiter {
    window_start_ms: u64,
    messages_in_window: u32,
    bytes_in_window: u64,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            window_start_ms: 0,
            messages_in_window: 0,
            bytes_in_window: 0,
        }
    }

    /// true = the line is admitted; false = the window's caps are blown
    pub fn admit(&mut self, line_len: usize, now_ms: u64) -> bool {
        if now_ms.saturating_sub(self.window_start_ms) >= RATE_WINDOW_MS {
            self.window_start_ms = now_ms;
            self.messages_in_window = 0;
            self.bytes_in_window = 0;
        }
        self.messages_in_window += 1;
        self.bytes_in_window += line_len as u64;
        self.messages_in_window <= RATE_MAX_MESSAGES
            && self.bytes_in_window <= RATE_MAX_BYTES
    }
}

/// reads one newline-terminated line with a HARD allocation cap —
/// `BufReader::lines()` grows unbounded, so a peer streaming a giant line
/// without a newline could balloon the host's memory before the size
/// check ever ran. An over-cap line (or a broken utf8) is an error.
async fn next_bounded_line<R>(
    reader: &mut R,
) -> std::io::Result<Option<String>>
where
    R: tokio::io::AsyncBufRead + Unpin,
{
    let mut buf: Vec<u8> = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        match reader.read(&mut byte).await? {
            0 => {
                return Ok(if buf.is_empty() {
                    None
                } else {
                    Some(String::from_utf8_lossy(&buf).into_owned())
                });
            }
            _ => {
                if byte[0] == b'\n' {
                    return Ok(Some(String::from_utf8_lossy(&buf).into_owned()));
                }
                buf.push(byte[0]);
                if buf.len() > MAX_MESSAGE_BYTES {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "line over the size cap",
                    ));
                }
            }
        }
    }
}

pub struct LanState {
    pub host: Mutex<Option<HostHandle>>,
    pub client: Mutex<Option<ClientHandle>>,
    /// live discovery results by session id (pruned on every read)
    pub discovered: Mutex<HashMap<String, DiscoveredSession>>,
    /// shuts the discovery listener down; None = not listening
    pub discovery: Mutex<Option<oneshot::Sender<()>>>,
}

/// the client side of a live connection: the send channel plus the read
/// loop's task (aborted on disconnect so the socket halves die with it)
pub struct ClientHandle {
    tx: mpsc::UnboundedSender<String>,
    read_task: tauri::async_runtime::JoinHandle<()>,
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
        run_host(AppEventSink { app: app2 }, session2, code2, name2, listener, shutdown_rx, client_rx).await;
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

/// a relayed peer message must be a JSON object carrying a string type —
/// anything else is a protocol violation and closes the connection
fn is_valid_message(line: &str) -> bool {
    match serde_json::from_str::<Value>(line) {
        Ok(value) => value.is_object() && value["type"].is_string(),
        Err(_) => false,
    }
}

/// the client waits for the host's `{type:"joined", name}` ack and
/// returns the host's name — a rejected code or a silent host fails here
async fn await_join_ack<R>(reader: &mut R) -> Result<String, String>
where
    R: tokio::io::AsyncBufRead + Unpin,
{
    let line = match tokio::time::timeout(
        Duration::from_secs(ACK_TIMEOUT_SECS),
        next_bounded_line(reader),
    )
    .await
    {
        Err(_) => return Err("lan: join timed out".into()),
        Ok(Ok(Some(line))) => line,
        Ok(_) => return Err("lan: join failed (connection dropped)".into()),
        Ok(Err(_)) => return Err("lan: join failed (line over the cap)".into()),
    };
    let parsed: Option<Value> = serde_json::from_str(&line).ok();
    match parsed {
        Some(value) if value["type"] == "joined" => {
            Ok(value["name"].as_str().unwrap_or("the host").to_string())
        }
        Some(value) if value["type"] == "join-rejected" => {
            Err("lan: the code was rejected by the host".into())
        }
        _ => Err("lan: join rejected".into()),
    }
}

/// connects this device to a host (the client side): validates the join
/// code through the host's joined ack, then relays host messages as
/// `lan://peer-message` events
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
    let stream = match tokio::time::timeout(
        Duration::from_secs(CONNECT_TIMEOUT_SECS),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Err(_) => {
            return Err(format!(
                "lan: the host did not answer in {CONNECT_TIMEOUT_SECS}s — check the ip and the host's firewall"
            ))
        }
        Ok(Err(e)) => return Err(format!("lan: connect failed ({e})")),
        Ok(Ok(stream)) => stream,
    };
    let (read, mut write) = tokio::io::split(stream);
    let join = serde_json::json!({ "type": "join", "name": name, "code": code });
    write
        .write_all(format!("{}\n", join).as_bytes())
        .await
        .map_err(|e| format!("lan: join failed ({e})"))?;

    let mut reader = BufReader::new(read);
    let host_name = await_join_ack(&mut reader).await?;

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let app2 = app.clone();
    let read_task = tauri::async_runtime::spawn(async move {
        let mut limiter = RateLimiter::new();
        loop {
            match next_bounded_line(&mut reader).await {
                Ok(Some(line)) => {
                    if !limiter.admit(line.len(), now_ms()) || !is_valid_message(&line) {
                        emit(&app2, "lan://client-error", serde_json::json!({ "error": "protocol violation" }));
                        break;
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
    *guard = Some(ClientHandle { tx, read_task });
    emit(&app, "lan://peer-joined", serde_json::json!({ "name": host_name }));
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
    match &guard.as_ref().ok_or("lan: not connected")?.tx {
        tx => tx.send(text).map_err(|_| "lan: not connected".into()),
    }
}

/// drops the client connection (the read loop's task is aborted with it)
#[tauri::command]
pub fn lan_disconnect_client(state: State<'_, LanState>) -> Result<(), String> {
    let mut guard = state.client.lock().map_err(|_| "lan state poisoned")?;
    if let Some(handle) = guard.take() {
        handle.read_task.abort();
    }
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
    let sock = bind_discovery_socket()?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tauri::async_runtime::spawn(run_discovery(app, sock, shutdown_rx));
    *guard = Some(shutdown_tx);
    Ok(())
}

/// binds the UDP discovery port; SO_REUSEADDR lets a second listener
/// (diagnostics, another app instance) share the broadcast port
fn bind_discovery_socket() -> Result<tokio::net::UdpSocket, String> {
    let socket = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    )
    .map_err(|e| format!("lan: discovery bind failed ({e})"))?;
    socket
        .set_reuse_address(true)
        .map_err(|e| format!("lan: discovery bind failed ({e})"))?;
    let bind_addr: std::net::SocketAddr = "0.0.0.0:51988"
        .parse()
        .expect("a fixed valid bind addr");
    socket
        .bind(&bind_addr.into())
        .map_err(|e| format!("lan: discovery bind failed ({e})"))?;
    socket
        .set_nonblocking(true)
        .map_err(|e| format!("lan: discovery bind failed ({e})"))?;
    tokio::net::UdpSocket::from_std(socket.into())
        .map_err(|e| format!("lan: discovery bind failed ({e})"))
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

/// classifies one pre-handshake line against the session's code — pure
/// and testable: the correct join accepts, a WELL-FORMED join with a
/// wrong code rejects immediately (the client gets a precise error),
/// anything else is ignored
#[derive(Debug)]
enum JoinDecision {
    Accept(String),
    Reject,
    Ignore,
}

fn decide_join(line: &str, code: &str) -> JoinDecision {
    let parsed: Result<Value, _> = serde_json::from_str(line);
    match parsed {
        Ok(v) if v["type"] == "join" && v["code"] == code => {
            JoinDecision::Accept(v["name"].as_str().unwrap_or("P2").to_string())
        }
        Ok(v) if v["type"] == "join" => JoinDecision::Reject,
        _ => JoinDecision::Ignore,
    }
}

/// the outbound events a live connection produces — abstracted so the
/// e2e tests can drive the REAL run_host over real TCP without an
/// AppHandle (phase 60)
trait LanEventSink: Send + 'static {
    fn emit(&self, event: &str, payload: serde_json::Value);
}

/// the production sink: wraps the Tauri app handle
#[derive(Clone)]
struct AppEventSink {
    app: tauri::AppHandle,
}

impl LanEventSink for AppEventSink {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = self.app.emit(event, payload);
    }
}

async fn run_host<S: LanEventSink + Clone>(
    sink: S,
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
    // accept + handshake loop: a rejected or silent client releases its
    // connection and the host keeps accepting — H1's 'keeps listening'
    // made real (a new client CAN join after a rejected one)
    let (reader, write, joined) = 'handshake: loop {
        let stream = tokio::select! {
            _ = &mut shutdown_rx => return,
            accepted = listener.accept() => match accepted {
                Ok((stream, _addr)) => stream,
                Err(_) => return,
            },
        };
        let (read_half, write_half) = tokio::io::split(stream);
        let mut reader = BufReader::new(read_half);

        // the first line must be a valid join with the session's code; a
        // silent client releases THIS connection (the beacon resumes) and
        // a WRONG code gets an immediate precise reject — the host then
        // accepts the next client
        let join_deadline =
            tokio::time::Instant::now() + Duration::from_secs(JOIN_TIMEOUT_SECS);
        let outcome = loop {
            let remaining =
                join_deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break None; //the silent client released
            }
            let line = match tokio::time::timeout(
                remaining,
                next_bounded_line(&mut reader),
            )
            .await
            {
                Err(_) => break None, //the window closed
                Ok(Ok(Some(line))) => Some(line),
                Ok(_) => break None, //the client dropped
                Ok(Err(_)) => break None, //an over-cap line
            };
            match decide_join(&line, &code) {
                JoinDecision::Accept(name) => break Some(name),
                JoinDecision::Reject => {
                    let reject = serde_json::json!({
                        "type": "join-rejected",
                        "reason": "wrong code"
                    });
                    if write_half
                        .write_all(format!("{}\n", reject).as_bytes())
                        .await
                        .is_err()
                    {
                        break None;
                    }
                    break None; //the reject is out — this connection is
                                //released NOW, the host accepts the next
                                //client instead of reading the rejected one
                }
                JoinDecision::Ignore => continue, //anything else before the join
            }
        };
        match outcome {
            Some(name) => break 'handshake (reader, write_half, name),
            None => continue, //this connection released — the beacon re-announces
        }
    };
    // the joined ack completes the handshake — the client shows the
    // HOST's name only after receiving it
    let ack = serde_json::json!({ "type": "joined", "name": host_name, "sessionId": session_id });
    if write
        .write_all(format!("{}\n", ack).as_bytes())
        .await
        .is_err()
    {
        return;
    }
    sink.emit("lan://peer-joined", serde_json::json!({ "name": joined, "host": host_name, "sessionId": session_id }));
    beacon.stop(); //the match is found — no more broadcasting

    // forward peer messages to the frontend; a protocol violation (no
    // string type, oversize, a blown rate window) closes the connection
    let read_task = tauri::async_runtime::spawn(async move {
        let sink = sink.clone();
        let mut limiter = RateLimiter::new();
        loop {
            match next_bounded_line(&mut reader).await {
                Ok(Some(line)) => {
                    if !limiter.admit(line.len(), now_ms()) || !is_valid_message(&line) {
                        sink.emit("lan://peer-left", serde_json::json!({ "reason": "protocol violation" }));
                        break;
                    }
                    if let Ok(message) = serde_json::from_str::<Value>(&line) {
                        sink.emit("lan://peer-message", serde_json::json!({ "message": message }));
                    }
                }
                _ => {
                    sink.emit("lan://peer-left", serde_json::json!({ "reason": "disconnected" }));
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
    use std::sync::Arc;

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

    #[test]
    fn message_validation_requires_a_typed_object() {
        assert!(is_valid_message(r#"{"type":"progress","wordIndex":1}"#));
        assert!(is_valid_message(r#"{"type":"finished","finishMs":null}"#));
        assert!(!is_valid_message(r#"{"wordIndex":1}"#), "no type");
        assert!(!is_valid_message(r#"{"type":42}"#), "type not a string");
        assert!(!is_valid_message(r#"[1,2,3]"#), "not an object");
        assert!(!is_valid_message("garbage"), "not even json");
    }

    #[tokio::test]
    async fn the_join_ack_carries_the_host_name() {
        let (client_side, mut host_side) = tokio::io::duplex(1024);
        let fake_host = tokio::spawn(async move {
            host_side
                .write_all(br#"{"type":"joined","name":"HOST1"}"#)
                .await
                .expect("write the ack");
            host_side.write_all(b"\n").await.expect("write newline");
        });
        let mut reader = BufReader::new(client_side);
        let host = await_join_ack(&mut reader).await.expect("acked");
        assert_eq!(host, "HOST1");
        fake_host.await.expect("fake host task");
    }

    #[tokio::test]
    async fn a_non_ack_reply_rejects_the_join() {
        let (client_side, mut host_side) = tokio::io::duplex(1024);
        let mut reader = BufReader::new(client_side);
        host_side
            .write_all(br#"{"type":"progress","wordIndex":1}"#)
            .await
            .expect("write a non-ack");
        host_side.write_all(b"\n").await.expect("write newline");
        assert!(
            await_join_ack(&mut reader).await.is_err(),
            "anything but joined must fail the handshake"
        );
    }

    #[test]
    fn the_rate_limiter_admits_a_steady_match_stream() {
        let mut limiter = RateLimiter::new();
        let mut now = 1_000u64;
        //the type-pong worst case: 20 snapshots/s at ~300 bytes
        for _ in 0..60 {
            assert!(limiter.admit(300, now), "a match stream must pass");
            now += 16;
        }
    }

    #[test]
    fn a_message_flood_trips_the_limiter() {
        let mut limiter = RateLimiter::new();
        let mut now = 1_000u64;
        let mut tripped = false;
        for _ in 0..(RATE_MAX_MESSAGES + 10) {
            if !limiter.admit(10, now) {
                tripped = true;
                break;
            }
        }
        assert!(tripped, "flooding past the message cap must trip");
    }

    #[test]
    fn a_byte_flood_trips_the_limiter_even_under_the_message_cap() {
        let mut limiter = RateLimiter::new();
        let mut now = 1_000u64;
        let mut tripped = false;
        //six 64KB lines: 6 messages (under the cap) but ~384KB bytes
        for _ in 0..8 {
            if !limiter.admit(MAX_MESSAGE_BYTES, now) {
                tripped = true;
                break;
            }
        }
        assert!(tripped, "a byte flood must trip even under the message cap");
    }

    #[test]
    fn the_window_slides_back_open_after_a_trip() {
        let mut limiter = RateLimiter::new();
        let mut now = 1_000u64;
        for _ in 0..(RATE_MAX_MESSAGES + 5) {
            limiter.admit(10, now);
        }
        assert!(!limiter.admit(10, now), "still inside the blown window");
        now += RATE_WINDOW_MS + 1;
        assert!(
            limiter.admit(10, now),
            "a slid window admits again (the connection may recover)"
        );
    }

    #[test]
    fn decide_join_classifies_the_handshake_lines() {
        let correct = r#"{"type":"join","name":"P2","code":"ABCD"}"#;
        match decide_join(correct, "ABCD") {
            JoinDecision::Accept(name) => assert_eq!(name, "P2"),
            other => panic!("the correct join must accept, got {other:?}"),
        }
        //a WELL-FORMED join with a wrong code: an immediate reject (the
        //client gets a precise error instead of a silent 5s hang)
        let wrong = r#"{"type":"join","name":"P2","code":"ZZZZ"}"#;
        assert!(matches!(
            decide_join(wrong, "ABCD"),
            JoinDecision::Reject
        ));
        //anything else before the join is ignored
        assert!(matches!(
            decide_join(r#"{"type":"progress","x":1}"#, "ABCD"),
            JoinDecision::Ignore
        ));
        assert!(matches!(decide_join("garbage", "ABCD"), JoinDecision::Ignore));
    }

    #[tokio::test]
    async fn a_join_rejected_ack_fails_the_handshake_with_a_precise_error() {
        let (client_side, mut host_side) = tokio::io::duplex(1024);
        let fake_host = tokio::spawn(async move {
            host_side
                .write_all(br#"{"type":"join-rejected","reason":"wrong code"}"#)
                .await
                .expect("write the reject");
            host_side.write_all(b"
").await.expect("write newline");
        });
        let mut reader = BufReader::new(client_side);
        let error = await_join_ack(&mut reader)
            .await
            .expect_err("a reject must fail the handshake");
        assert!(error.contains("rejected"), "precise: {error}");
        fake_host.await.expect("fake host task");
    }

    /// the e2e test sink: collects everything the host emits
    #[derive(Clone, Default)]
    struct TestSink {
        events: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
    }

    impl LanEventSink for TestSink {
        fn emit(&self, event: &str, payload: serde_json::Value) {
            self
                .events
                .lock()
                .expect("test sink lock")
                .push((event.to_string(), payload));
        }
    }

    impl TestSink {
        fn count(&self, event: &str) -> usize {
            self
                .events
                .lock()
                .expect("test sink lock")
                .iter()
                .filter(|(e, _)| e == event)
                .count()
        }

        fn last(&self, event: &str) -> Option<serde_json::Value> {
            self
                .events
                .lock()
                .expect("test sink lock")
                .iter()
                .rev()
                .find(|(e, _)| e == event)
                .map(|(_, p)| p.clone())
        }
    }

    /// drives one scripted client through the REAL run_host over a real
    /// TCP loopback: joins, reads the ack, exchanges messages. Returns
    /// every line the client read.
    async fn scripted_client(
        addr: std::net::SocketAddr,
        code: &str,
        sends: Vec<serde_json::Value>,
    ) -> Vec<String> {
        let stream = tokio::net::TcpStream::connect(addr)
            .await
            .expect("the client connects");
        let (mut read, mut write) = tokio::io::split(stream);
        let join = serde_json::json!({
            "type": "join", "name": "P2", "code": code
        });
        write
            .write_all(format!("{}\n", join).as_bytes())
            .await
            .expect("write the join");
        let mut read_lines: Vec<String> = Vec::new();
        let mut reader = BufReader::new(read);
        for send in sends {
            let mut ack_line = String::new();
            tokio::time::timeout(Duration::from_secs(3), reader.read_line(&mut ack_line))
                .await
                .expect("the ack within 3s")
                .expect("the ack line reads");
            read_lines.push(ack_line.trim_end().to_string());
            write
                .write_all(format!("{}\n", send).as_bytes())
                .await
                .expect("write the send");
        }
        read_lines
    }

    #[tokio::test]
    async fn e2e_host_relays_a_full_match_over_real_tcp() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let sink = TestSink::default();
        let (_shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        let (host_sends, client_rx) = mpsc::unbounded_channel::<String>();
        tokio::spawn(run_host(
            sink.clone(),
            "lan-1/ABCD".into(),
            "ABCD".into(),
            "HOST1".into(),
            listener,
            shutdown_rx,
            client_rx,
        ));

        //the host frontend's start queues through the pipe — and the
        //SENDER STAYS ALIVE (the dropped sender would end the write task
        //and close the socket mid-match, H1's own lesson)
        let start = serde_json::json!({ "type": "start", "seed": 42, "params": {} });
        host_sends
            .send(format!("{}\n", start))
            .expect("the start queues");

        //the scripted client: join -> ack -> the host's start -> its own progress
        let sends = vec![serde_json::json!({ "type": "progress", "state": { "x": 3 } })];
        let read_lines = scripted_client(addr, "ABCD", sends).await;

        //the ack carries the HOST's name (the join handshake contract)
        assert!(read_lines[0].contains("HOST1"), "the ack names the host: {}", read_lines[0]);
        //the host relayed the start back through the pipe
        assert!(read_lines[1].contains("start"), "the start relays: {}", read_lines[1]);

        //the sink saw the join announcement; the client's progress needs a
        //yield or two to reach it (the test runtime is current-thread)
        assert_eq!(sink.count("lan://peer-joined"), 1);
        let mut waited = 0u32;
        while sink.count("lan://peer-message") == 0 && waited < 50 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            waited += 1;
        }
        let relayed = sink.last("lan://peer-message").expect("the progress relayed");
        assert_eq!(relayed["message"]["type"].as_str(), Some("progress"));
    }

    #[tokio::test]
    async fn e2e_a_wrong_code_rejects_and_the_host_keeps_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let sink = TestSink::default();
        let (_shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        let (_, client_rx) = mpsc::unbounded_channel::<String>();
        tokio::spawn(run_host(
            sink.clone(),
            "lan-1/ABCD".into(),
            "ABCD".into(),
            "HOST1".into(),
            listener,
            shutdown_rx,
            client_rx,
        ));

        //client 1: the WRONG code — an immediate join-rejected, no 5s hang
        let stream = tokio::net::TcpStream::connect(addr).await.expect("connect");
        let (mut read, mut write) = tokio::io::split(stream);
        let wrong = serde_json::json!({ "type": "join", "name": "P2", "code": "WRONG" });
        write
            .write_all(format!("{}\n", wrong).as_bytes())
            .await
            .expect("write the wrong join");
        let mut reject_line = String::new();
        tokio::time::timeout(Duration::from_secs(2), BufReader::new(read).read_line(&mut reject_line))
            .await
            .expect("the reject within 2s")
            .expect("the reject line reads");
        assert!(
            reject_line.contains("join-rejected"),
            "precise: {reject_line}"
        );

        //client 2: the correct code still joins — the host kept listening
        let stream2 = tokio::net::TcpStream::connect(addr).await.expect("connect");
        let (mut read2, mut write2) = tokio::io::split(stream2);
        let good = serde_json::json!({ "type": "join", "name": "P2", "code": "ABCD" });
        write2
            .write_all(format!("{}\n", good).as_bytes())
            .await
            .expect("write the good join");
        let mut ack_line = String::new();
        tokio::time::timeout(Duration::from_secs(2), BufReader::new(read2).read_line(&mut ack_line))
            .await
            .expect("the ack within 2s")
            .expect("the ack line reads");
        assert!(ack_line.contains("joined"), "the correct client joins: {ack_line}");
    }

    #[tokio::test]
    async fn e2e_a_flood_trips_the_rate_limiter() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let sink = TestSink::default();
        let (_shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        let (_, client_rx) = mpsc::unbounded_channel::<String>();
        tokio::spawn(run_host(
            sink.clone(),
            "lan-1/ABCD".into(),
            "ABCD".into(),
            "HOST1".into(),
            listener,
            shutdown_rx,
            client_rx,
        ));

        //the client joins, then floods well past the message cap
        let stream = tokio::net::TcpStream::connect(addr).await.expect("connect");
        let (mut read, mut write) = tokio::io::split(stream);
        let join = serde_json::json!({ "type": "join", "name": "P2", "code": "ABCD" });
        write
            .write_all(format!("{}\n", join).as_bytes())
            .await
            .expect("write the join");
        let flood = serde_json::json!({ "type": "progress", "state": { "x": 1 } })
            .to_string();
        for _ in 0..(RATE_MAX_MESSAGES + 40) {
            let _ = write
                .write_all(format!("{}\n", flood).as_bytes())
                .await;
        }
        //the limiter trips: the sink sees the peer-left (the connection cut)
        let mut waited = 0u32;
        while sink.count("lan://peer-left") == 0 && waited < 50 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            waited += 1;
        }
        assert!(
            sink.count("lan://peer-left") >= 1,
            "the flood must cut the connection"
        );
        //the flood's reads: the pipe closes — whatever surfaces, fine
        let _ = BufReader::new(read).read_line(&mut String::new()).await;
    }

    #[tokio::test]
    async fn a_giant_line_without_a_newline_errors_instead_of_ballooning() {
        let (client_side, mut host_side) = tokio::io::duplex(128 * 1024);
        let mut reader = BufReader::new(client_side);
        host_side
            .write_all(&vec![b'a'; MAX_MESSAGE_BYTES + 1024])
            .await
            .expect("write an over-cap line (no newline yet)");
        let result = next_bounded_line(&mut reader).await;
        assert!(
            result.is_err(),
            "an over-cap line must error, not allocate unbounded"
        );
    }
}
