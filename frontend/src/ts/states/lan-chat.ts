import { createSignal } from "solid-js";

import { getLanClients, getLanPeerName, getLanRole, lanSendToPeer } from "./lan";

/**
 * Lobby chat (phase 80): short capped messages riding the phase-77 pipe
 * as plain `chat` objects — the Rust side stays passthrough (the raw
 * relay already carries them, the rate limiter already guards spam) and
 * this module owns only the client-side contract: the 280-char cap, the
 * log (capped, session-only) and the sender name resolution.
 *
 * A chat message on the wire: {type:"chat", from, text, ts}. The room
 * relay injects the sender's clientId (phase 77), so receivers can map
 * the author through the roster.
 */

export const CHAT_MAX_CHARS = 280;
/** the log keeps the most recent messages */
const CHAT_LOG_CAP = 50;

export type LanChatMessage = {
  /** the sender's room id (undefined = the host's own sends, or v1) */
  clientId?: number;
  from: string;
  text: string;
  ts: number;
};

const [chatLog, setChatLog] = createSignal<LanChatMessage[]>([]);

export function getLanChatLog(): LanChatMessage[] {
  return chatLog();
}

export function clearLanChat(): void {
  setChatLog([]);
}

/** the sender display name: the host sends under its own name, a client
 * under theirs; the receiver prefers the roster name when the relay
 * attached a clientId */
function senderName(clientId?: number): string {
  if (clientId !== undefined) {
    const roster = getLanClients();
    return roster[clientId]?.name ?? `client ${clientId}`;
  }
  return getLanRole() === "host" ? (getLanPeerName() ?? "host") : "host";
}

/** receives a chat message from the pipe (the lan-match router delegates
 * here); the text is clamped, the log is capped, and the sender's claimed
 * name is displayed with a roster fallback */
export function receiveLanChat(
  message: Record<string, unknown>,
  clientId?: number,
): void {
  const rawText = message["text"];
  const rawFrom = message["from"];
  const text = typeof rawText === "string" ? rawText.slice(0, CHAT_MAX_CHARS) : "";
  if (text === "") return; //an empty chat is not a chat
  const claimed =
    typeof rawFrom === "string" && rawFrom !== ""
      ? rawFrom.slice(0, CHAT_MAX_CHARS)
      : undefined;
  const entry: LanChatMessage = {
    clientId,
    from: claimed ?? senderName(clientId),
    text,
    ts: typeof message["ts"] === "number" ? message["ts"] : Date.now(),
  };
  const next = [...chatLog(), entry];
  if (next.length > CHAT_LOG_CAP) {
    next.splice(0, next.length - CHAT_LOG_CAP);
  }
  setChatLog(next);
}

/** sends a chat message to the room (both roles): the text is clamped to
 * the cap and the wire message carries the sender's display name */
export function sendLanChat(text: string): LanChatMessage | undefined {
  const clean = text.trim().slice(0, CHAT_MAX_CHARS);
  if (clean === "") return undefined;
  const from = getLanPeerName() ?? "P1";
  const entry: LanChatMessage = {
    from,
    text: clean,
    ts: Date.now(),
  };
  if (getLanRole() === "host") entry.clientId = undefined;
  lanSendToPeer({ type: "chat", from, text: clean, ts: entry.ts });
  const next = [...chatLog(), entry];
  if (next.length > CHAT_LOG_CAP) {
    next.splice(0, next.length - CHAT_LOG_CAP);
  }
  setChatLog(next);
  return entry;
}
