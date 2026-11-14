import { createSignal } from "solid-js";

/**
 * LAN session state (Online Games, phase 2): the frontend side of the
 * Rust pipe (src-tauri/src/lan.rs). The frontend NEVER touches sockets —
 * it invokes the lan_* commands and receives peer traffic as Tauri
 * events. Outside Tauri (tests, plain browser) everything degrades to a
 * graceful no-op. Names are session-only; the LAST name is kept in
 * localStorage purely as an input pre-fill (no identity persistence).
 */

type TauriInvoke = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type LanRole = "none" | "host" | "client";

export type LanHostInfo = {
  sessionId: string;
  code: string;
  port: number;
  ip: string;
};

/** a match found by the UDP discovery listener (phase 3) */
export type LanDiscovered = {
  sessionId: string;
  name: string;
  code: string;
  port: number;
  ip: string;
};

const NAME_KEY = "mtDesktopLanName";

const [getRole, setRole] = createSignal<LanRole>("none");
const [getHostInfo, setHostInfo] = createSignal<LanHostInfo | undefined>(
  undefined,
);
const [getPeerName, setPeerName] = createSignal<string | undefined>(undefined);
const [getConnected, setConnected] = createSignal(false);
const [getDiscovered, setDiscovered] = createSignal<LanDiscovered[]>([]);
const [getLastMessage, setLastMessage] = createSignal<
  Record<string, unknown> | undefined
>(undefined);
//phase 77: the room — a clientId per registered client plus the sender id
// riding the last message (undefined = the host's own sends)
const [getClients, setClients] = createSignal<
  Record<number, { clientId: number; name?: string }>
>({});
const [getLastMessageClientId, setLastMessageClientId] = createSignal<
  number | undefined
>(undefined);
/** the FIRST client that joined — the 2-player flow's counterpart */
let primaryClientId: number | undefined;

function getInvoke(): TauriInvoke | undefined {
  const tauri = (
    window as unknown as {
      __TAURI__?: { core?: { invoke?: TauriInvoke } };
    }
  ).__TAURI__;
  const invoke = tauri?.core?.invoke;
  return typeof invoke === "function" ? invoke : undefined;
}

type EventListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

function getListen(): EventListen | undefined {
  const tauri = (
    window as unknown as {
      __TAURI__?: { event?: { listen?: EventListen } };
    }
  ).__TAURI__;
  const listen = tauri?.event?.listen;
  return typeof listen === "function" ? listen : undefined;
}

let listenersWired = false;

/** wires the Rust-side LAN events into the signals (once per session) */
function wireLanEvents(): void {
  if (listenersWired) return;
  const listen = getListen();
  if (listen === undefined) return;
  listenersWired = true;
  void listen("lan://peer-joined", (e) => {
    const payload = e.payload as { clientId?: number; name?: string };
    //the FIRST join (or the host joining from the client side) is the
    //primary peer — the 2-player flow's counterpart; later joins fill the
    //roster without stealing the primary seat
    if (primaryClientId === undefined) {
      primaryClientId = payload.clientId;
      setPeerName(payload.name);
    }
    if (payload.clientId !== undefined) {
      const next = { ...getClients() };
      next[payload.clientId] = {
        clientId: payload.clientId,
        name: payload.name,
      };
      setClients(next);
    }
    setConnected(true);
  });
  void listen("lan://peer-message", (e) => {
    const payload = e.payload as {
      message: Record<string, unknown>;
      clientId?: number;
    };
    setLastMessage(payload.message);
    setLastMessageClientId(payload.clientId);
  });
  void listen("lan://peer-left", (e) => {
    const payload = e.payload as { clientId?: number };
    if (payload.clientId === undefined || payload.clientId === primaryClientId) {
      //the primary peer (or a legacy v1 peer without an id) is gone
      setConnected(false);
      setPeerName(undefined);
      primaryClientId = undefined;
    }
    if (payload.clientId !== undefined) {
      const next = { ...getClients() };
      delete next[payload.clientId];
      setClients(next);
    }
  });
  void listen("lan://client-error", () => {
    setConnected(false);
    setPeerName(undefined);
    setRole("none");
    primaryClientId = undefined;
    setClients({});
  });
}

/** whether the Tauri backend (and its LAN commands) is available */
export function lanAvailable(): boolean {
  return getInvoke() !== undefined;
}

/** the pre-fill name (the last one used, localStorage convenience only) */
export function lanPreFillName(): string {
  return window.localStorage.getItem(NAME_KEY) ?? "";
}

export function lanRememberName(name: string): void {
  window.localStorage.setItem(NAME_KEY, name);
}

/** starts hosting: returns the join info the other player needs */
export async function lanStartHost(
  name: string,
): Promise<LanHostInfo | undefined> {
  const invoke = getInvoke();
  if (invoke === undefined) return undefined;
  wireLanEvents();
  lanRememberName(name);
  const info = await invoke<LanHostInfo>("lan_start_host", { name });
  setHostInfo(info);
  setRole("host");
  return info;
}

/** joins a host by its ip:port + code. Resolves undefined on success,
 * or the PRECISE failure reason (the rust side names the step: the tcp
 * window, the ack timeout, the rejected code) so the lobby can show
 * what actually failed instead of one generic line */
export async function lanJoin(
  addr: string,
  code: string,
  name: string,
): Promise<string | undefined> {
  const invoke = getInvoke();
  if (invoke === undefined) return "the LAN backend is only available inside the desktop app";
  wireLanEvents();
  lanRememberName(name);
  try {
    await invoke("lan_connect_client", { addr, code, name });
    setRole("client");
    return undefined;
  } catch (error) {
    console.error("lan join failed", error);
    const raw =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "unknown join error";
    return raw.replace(/^lan:\s*/, "");
  }
}

/** sends a JSON message to the peer (routed by the current role) */
export function lanSendToPeer(message: Record<string, unknown>): void {
  const invoke = getInvoke();
  if (invoke === undefined) return;
  if (getRole() === "host") {
    void invoke("lan_send_message", { message });
  } else if (getRole() === "client") {
    void invoke("lan_client_send", { message });
  }
}

/** leaves/cancels: stops hosting or drops the client connection */
export function lanLeave(): void {
  const invoke = getInvoke();
  if (invoke === undefined) return;
  if (getRole() === "host") {
    void invoke("lan_stop_host");
  } else if (getRole() === "client") {
    void invoke("lan_disconnect_client");
  }
  setRole("none");
  setConnected(false);
  setPeerName(undefined);
  setHostInfo(undefined);
  primaryClientId = undefined;
  setClients({});
}

/** starts the UDP discovery listener (idempotent — the lobby owns the
 * lifecycle and stops it on unmount) */
export async function lanStartDiscovery(): Promise<boolean> {
  const invoke = getInvoke();
  if (invoke === undefined) return false;
  wireLanEvents();
  try {
    await invoke("lan_start_discovery");
    return true;
  } catch (error) {
    console.error("lan discovery start failed", error);
    return false;
  }
}

/** stops the discovery listener and clears the local list */
export function lanStopDiscovery(): void {
  const invoke = getInvoke();
  if (invoke === undefined) return;
  setDiscovered([]);
  void invoke("lan_stop_discovery");
}

/** pulls the current discovered list (the Rust side prunes stale entries) */
export async function lanRefreshDiscovered(): Promise<void> {
  const invoke = getInvoke();
  if (invoke === undefined) return;
  try {
    const list = await invoke<LanDiscovered[]>("lan_get_discovered");
    setDiscovered(Array.isArray(list) ? list : []);
  } catch (error) {
    console.error("lan discovery refresh failed", error);
  }
}

export function getLanRole(): LanRole {
  return getRole();
}

export function getLanHostInfo(): LanHostInfo | undefined {
  return getHostInfo();
}

export function getLanPeerName(): string | undefined {
  return getPeerName();
}

export function isLanConnected(): boolean {
  return getConnected();
}

export function getLanDiscovered(): LanDiscovered[] {
  return getDiscovered();
}

export function getLanLastMessage(): Record<string, unknown> | undefined {
  return getLastMessage();
}

/** phase 77: the sender's clientId for the last peer message — undefined
 * when the host itself sent it (or a v1 pipe without ids) */
export function getLanLastMessageClientId(): number | undefined {
  return getLastMessageClientId();
}

/** phase 77: the room roster — clientId → name, maintained by the
 * peer-joined / peer-left events */
export function getLanClients(): Record<
  number,
  { clientId: number; name?: string }
> {
  return getClients();
}

/** test hook: forgets the wired-listener latch so a spec can re-wire */
export function _resetLanStateForTests(): void {
  listenersWired = false;
  setRole("none");
  setConnected(false);
  setPeerName(undefined);
  setHostInfo(undefined);
  setDiscovered([]);
  setLastMessage(undefined);
  setLastMessageClientId(undefined);
  setClients({});
  primaryClientId = undefined;
}
