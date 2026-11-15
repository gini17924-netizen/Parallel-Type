import { createEffect, createRoot, createSignal } from "solid-js";

import {
  createRelay,
  feedKey,
  type RelayState,
} from "../utils/team-relay/engine";
import { getLanLastMessage, getLanLastMessageClientId } from "./lan";

/**
 * phase 111: the team relay over the LAN pipe. the host seats everyone
 * (itself first), builds the shared word list (the pasted-text pattern of
 * the custom duel), and broadcasts relay-start. from then on the machines
 * stay in lockstep by EVENT REPLAY: the player typing a key applies it
 * locally and broadcasts relay-key; every other machine feeds the SAME
 * sequence into the SAME pure engine (phase 110), which ignores wrong
 * keys and non-active players deterministically — so all states converge
 * without any state broadcast.
 *
 * seat identity: the host is "host" (its sends carry no clientId), a
 * client is String(clientId) — the same strings live in the seats list.
 */

/** the host's own seat id (its messages carry no clientId) */
export const HOST_PLAYER_ID = "host";

const [relayState, setRelayState] = createSignal<RelayState | undefined>(
  undefined,
);
const [armed, setArmed] = createSignal(false);
const [myPlayerId, setMyPlayerId] = createSignal<string>(HOST_PLAYER_ID);

export function getRelayState(): RelayState | undefined {
  return relayState();
}

export function isRelayArmed(): boolean {
  return armed();
}

export function getMyRelaySeat(): string {
  return myPlayerId();
}

function lanBroadcast(message: Record<string, unknown>): void {
  const w = window as unknown as {
    __TAURI__?: {
      core?: {
        invoke?: (
          cmd: string,
          args?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
  };
  const invoke = w.__TAURI__?.core?.invoke;
  if (invoke === undefined) return;
  void invoke("lan_send_message", { message });
}

/** the host: seat everyone (the room roster, itself first), build the
 * shared list, arm, broadcast. false = fewer than two seats or no words */
export function startTeamRelay(words: string[], clientIds: number[]): boolean {
  if (words.length === 0) return false;
  const seats = [
    HOST_PLAYER_ID,
    ...[...clientIds].sort((a, b) => a - b).map(String),
  ];
  if (seats.length < 2) return false;
  const state = createRelay(words, seats);
  setMyPlayerId(HOST_PLAYER_ID);
  applyArmed(state);
  lanBroadcast({ type: "relay-start", words, seats });
  return true;
}

/** a seated player: applies the key locally and broadcasts it for replay.
 * nothing happens when the engine ignores the key (wrong char, not their
 * turn) — the wire stays quiet too */
export function relayTypeKey(key: string): void {
  const state = relayState();
  if (state === undefined || state.phase === "complete") return;
  const next = feedKey(state, myPlayerId(), key);
  if (next === state) return;
  setRelayState(next);
  lanBroadcast({ type: "relay-key", key, by: myPlayerId() });
}

/** the current word for THE LOCAL machine's seat (or undefined when the
 * local seat is a spectator or the relay is over) */
export function myCurrentWord(): { word: string; typed: number } | undefined {
  const state = relayState();
  if (state === undefined) return undefined;
  const me = state.players.find((p) => p.playerId === myPlayerId());
  if (me === undefined) return undefined;
  const word = me.words[me.done];
  if (word === undefined) return undefined;
  return { word, typed: me.typed };
}

/** whether it is the local seat's turn to type */
export function isMyRelayTurn(): boolean {
  const state = relayState();
  if (state === undefined || state.phase === "complete") return false;
  return state.activePlayerId === myPlayerId();
}

/** the one place relay messages are interpreted — production feeds it
 * from the last-message signal, specs call it directly with a clientId */
export function receiveRelayMessage(
  message: Record<string, unknown>,
  clientId?: number,
): void {
  const type = message["type"];
  if (type === "relay-start") {
    const words = Array.isArray(message["words"])
      ? (message["words"] as unknown[]).filter(
          (word): word is string => typeof word === "string",
        )
      : [];
    const seats = Array.isArray(message["seats"])
      ? (message["seats"] as unknown[]).filter(
          (seat): seat is string => typeof seat === "string",
        )
      : [];
    if (words.length === 0 || seats.length < 2) return;
    //the receiver seats itself by ITS pipe identity
    const mine =
      typeof clientId === "number" ? String(clientId) : HOST_PLAYER_ID;
    setMyPlayerId(mine);
    applyArmed(createRelay(words, seats));
    return;
  }
  if (type === "relay-key") {
    const state = relayState();
    if (state === undefined || !armed()) return;
    const key = message["key"];
    const by = message["by"];
    if (typeof key !== "string" || key.length !== 1) return;
    if (typeof by !== "string" || by === "") return;
    //replay the sender's key through the same pure engine — wrong keys
    //and out-of-turn keys are ignored deterministically
    const next = feedKey(state, by, key);
    if (next !== state) setRelayState(next);
  }
}

function applyArmed(state: RelayState): void {
  setRelayState(state);
  setArmed(true);
}

/** the message consumption — mirrors the lan-match pattern: one root
 * effect watching the last raw pipe message */
createRoot(() => {
  createEffect(() => {
    const message = getLanLastMessage();
    if (message === undefined) return;
    const type = message["type"];
    if (type !== "relay-start" && type !== "relay-key") return;
    receiveRelayMessage(message, getLanLastMessageClientId());
  });
});

/** the specs' reset */
export function _resetLanRelayForTests(): void {
  setRelayState(undefined);
  setArmed(false);
  setMyPlayerId(HOST_PLAYER_ID);
}
