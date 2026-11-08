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

const NAME_KEY = "mtDesktopLanName";

const [getRole, setRole] = createSignal<LanRole>("none");
const [getHostInfo, setHostInfo] = createSignal<LanHostInfo | undefined>(
  undefined,
);
const [getPeerName, setPeerName] = createSignal<string | undefined>(undefined);
const [getConnected, setConnected] = createSignal(false);
const [getLastMessage, setLastMessage] = createSignal<
  Record<string, unknown> | undefined
>(undefined);

function getInvoke(): TauriInvoke | undefined {
  const tauri = (
    window as unknown as {
      __TAURI__?: { core?: { invoke?: TauriInvoke } };
    }
  ).__TAURI__;
  const invoke = tauri?.core?.invoke;
  return typeof invoke === "function" ? invoke : undefined;
}

type EventListen = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
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
  void listen<{ name?: string }>("lan://peer-joined", (e) => {
    setPeerName(e.payload.name);
    setConnected(true);
  });
  void listen<{ message: Record<string, unknown> }>(
    "lan://peer-message",
    (e) => {
      setLastMessage(e.payload.message);
    },
  );
  void listen("lan://peer-left", () => {
    setConnected(false);
    setPeerName(undefined);
  });
  void listen("lan://client-error", () => {
    setConnected(false);
    setPeerName(undefined);
    setRole("none");
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
  const info = (await invoke("lan_start_host", { name })) as LanHostInfo;
  setHostInfo(info);
  setRole("host");
  return info;
}

/** joins a host by its ip:port + code */
export async function lanJoin(
  addr: string,
  code: string,
  name: string,
): Promise<boolean> {
  const invoke = getInvoke();
  if (invoke === undefined) return false;
  wireLanEvents();
  lanRememberName(name);
  try {
    await invoke("lan_connect_client", { addr, code, name });
    setRole("client");
    return true;
  } catch (error) {
    console.error("lan join failed", error);
    return false;
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

export function getLanLastMessage(): Record<string, unknown> | undefined {
  return getLastMessage();
}

/** test hook: forgets the wired-listener latch so a spec can re-wire */
export function _resetLanStateForTests(): void {
  listenersWired = false;
  setRole("none");
  setConnected(false);
  setPeerName(undefined);
  setHostInfo(undefined);
  setLastMessage(undefined);
}
