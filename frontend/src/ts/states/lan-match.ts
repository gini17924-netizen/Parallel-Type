import { createEffect, createRoot, createSignal } from "solid-js";

import { navigate } from "../router/navigate";
//KI-43's lesson: the registry is filled by module loads, never by mounts
import "../utils/games/lan-games";
import {
  getLanGame,
  type LanGameId,
  type LanStartPayload,
} from "../utils/games/lan-registry";
import {
  getLanLastMessage,
  getLanPeerName,
  getLanRole,
  lanSendToPeer,
} from "./lan";

/**
 * LAN match layer (online wave, phase 2 — the generic match state): rides
 * on the lan.ts pipe and turns raw peer messages into typed match state
 * THROUGH the LanPlayable registry — no game is hard-coded here. The
 * module owns the message consumption through one root effect — whatever
 * page is mounted (the lobby waiting, or a game racing), an incoming
 * `start` arms the match and navigates both players to the game.
 *
 * Protocol (JSON objects through the pipe):
 * - start    {type, ...LanStartPayload, from}     host -> client
 * - progress {type, gameId, state}                 both, per word/tick
 * - finished {type, finishMs|null, acc}            both, race end
 * - rematch  {type}                                client asks, host starts
 *
 * Nothing here is persisted — a match is session-only, like the names.
 */

export type LanMatch = {
  role: "host" | "client";
  peerName: string;
  gameId: LanGameId;
  seq: number;
  /** the registry-validated start the match was armed with (words/seed/
   * params) — the game page builds everything from this */
  start: LanStartPayload;
};

export type RemoteProgress = {
  /** the peer's decoded progress state (shaped by the game's contract) */
  state: Record<string, unknown>;
  /** performance.now() at the message arrival — the page anchors it in
   * its own race frame (arrivalPerf - startedAt) */
  arrivalPerf: number;
};

export type RemoteFinished = {
  /** the peer's finish time in their frame (frames aligned within one
   * RTT); null = their race ended without a completion */
  finishMs: number | null;
  acc: number;
  /** performance.now() at the message arrival (the pacer's pin anchor) */
  arrivalPerf: number;
};

const [matchSignal, setMatchSignal] = createSignal<LanMatch | undefined>(
  undefined,
);
const [progressSignal, setProgressSignal] = createSignal<
  RemoteProgress | undefined
>(undefined);
const [finishedSignal, setFinishedSignal] = createSignal<
  RemoteFinished | undefined
>(undefined);
const [rematchSignal, setRematchSignal] = createSignal(false);

let seqCounter = 0;

function resetDerived(): void {
  setProgressSignal(undefined);
  setFinishedSignal(undefined);
  setRematchSignal(false);
}

/** arms (or re-arms) the match; consumers restart from the new seq. An
 * invalid start is refused (both sides gate through the registry). */
export function armLanMatch(match: {
  role: "host" | "client";
  peerName: string;
  start: LanStartPayload;
}): void {
  const playable = getLanGame(match.start.gameId);
  if (playable === undefined || !playable.validateStart(match.start)) {
    console.error(
      "lan: refusing to arm an invalid match start",
      match.start.gameId,
    );
    return;
  }
  seqCounter += 1;
  setMatchSignal({
    role: match.role,
    peerName: match.peerName,
    gameId: match.start.gameId,
    seq: seqCounter,
    start: match.start,
  });
  resetDerived();
}

/** disarms: no live match (the connection itself is untouched) */
export function clearLanMatch(): void {
  seqCounter = 0;
  setMatchSignal(undefined);
  resetDerived();
}

export function getLanMatch(): LanMatch | undefined {
  return matchSignal();
}

export function getRemoteProgress(): RemoteProgress | undefined {
  return progressSignal();
}

export function getRemoteFinished(): RemoteFinished | undefined {
  return finishedSignal();
}

export function getRematchAsked(): boolean {
  return rematchSignal();
}

/** host: ships the start (also the rematch re-send) to the peer */
export function sendLanMatchStart(start: LanStartPayload, from: string): void {
  lanSendToPeer({ ...start, type: "start", from });
}

/** both sides: the game's encoded progress state — the envelope (type +
 * gameId) is added here */
export function sendLanMatchProgress(state: Record<string, unknown>): void {
  const match = matchSignal();
  if (match === undefined) return;
  lanSendToPeer({ type: "progress", gameId: match.gameId, state });
}

/** both sides: the own race ended — finishMs null when it ended without
 * a completion (the opponent crossed first) */
export function sendLanMatchFinished(
  finishMs: number | null,
  acc: number,
): void {
  lanSendToPeer({ type: "finished", finishMs, acc });
}

/** client: asks the host for a rematch */
export function sendLanMatchRematch(): void {
  lanSendToPeer({ type: "rematch" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** the one place every match message is interpreted — routed through the
 * LanPlayable registry; the root effect feeds it, specs call it directly */
export function handleLanPeerMessage(message: Record<string, unknown>): void {
  if (message["type"] === "start") {
    const gameId = message["gameId"];
    //the registry lookup IS the validation of a wire-supplied id
    const playable =
      typeof gameId === "string" ? getLanGame(gameId as LanGameId) : undefined;
    if (playable === undefined) return; //an unknown game is dropped
    const rawWords = Array.isArray(message["words"])
      ? (message["words"] as unknown[]).filter(
          (word): word is string => typeof word === "string",
        )
      : undefined;
    const rawSeed = message["seed"];
    const start: LanStartPayload = {
      gameId: playable.gameId,
      seed:
        typeof rawSeed === "number" && Number.isFinite(rawSeed)
          ? rawSeed
          : undefined,
      params: isRecord(message["params"]) ? message["params"] : {},
      words:
        rawWords !== undefined && rawWords.length > 0 ? rawWords : undefined,
    };
    if (!playable.validateStart(start)) return; //malformed starts never arm
    armLanMatch({
      role: getLanRole() === "host" ? "host" : "client",
      peerName:
        typeof message["from"] === "string"
          ? message["from"]
          : (getLanPeerName() ?? "P2"),
      start,
    });
    void navigate({ to: playable.route });
    return;
  }
  const match = matchSignal();
  if (match === undefined) return; //no live match — ignore
  if (message["type"] === "progress") {
    if (message["gameId"] !== match.gameId) return; //foreign progress
    const playable = getLanGame(match.gameId);
    if (playable === undefined) return;
    const decoded = playable.decodeProgress(message["state"]);
    if (decoded === undefined) return; //untrusted shapes never land
    setProgressSignal({ state: decoded, arrivalPerf: performance.now() });
    return;
  }
  if (message["type"] === "finished") {
    const finishMs = message["finishMs"];
    const acc = message["acc"];
    setFinishedSignal({
      finishMs: typeof finishMs === "number" ? finishMs : null,
      acc: typeof acc === "number" ? acc : 0,
      arrivalPerf: performance.now(),
    });
    return;
  }
  if (message["type"] === "rematch") setRematchSignal(true);
}

//the module owns the message consumption: a start arms and navigates
//no matter which page is currently on screen
createRoot(() => {
  createEffect(() => {
    const message = getLanLastMessage();
    if (message !== undefined) handleLanPeerMessage(message);
  });
});

/** test hook: forgets everything (including the seq) between specs */
export function _resetLanMatchForTests(): void {
  clearLanMatch();
}
