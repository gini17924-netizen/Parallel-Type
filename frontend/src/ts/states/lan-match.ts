import { createEffect, createRoot, createSignal } from "solid-js";

import { navigate } from "../router/navigate";
import {
  getLanLastMessage,
  getLanPeerName,
  getLanRole,
  lanSendToPeer,
} from "./lan";

/**
 * LAN match layer (online bot-duel, phase 4): rides on the lan.ts pipe
 * and turns the raw peer messages into typed match state. The module owns
 * the message consumption through one root effect — whatever page is
 * mounted (the lobby waiting, or the duel racing), an incoming `start`
 * arms the match and navigates both players to the duel.
 *
 * Protocol (JSON objects through the pipe; the host builds the words so
 * no seed is needed):
 * - start    {type, gameId:"bot-duel", words, from}  host -> client
 * - progress {type, wordIndex, correctChars}         both, per word
 * - finished {type, finishMs|null, acc}              both, race end
 * - rematch  {type}                                  client asks, host starts
 *
 * Nothing here is persisted — a match is session-only, like the names.
 */

export type LanMatch = {
  role: "host" | "client";
  peerName: string;
  gameId: "bot-duel";
  words: string[];
  /** bumped on every arm so a rematch re-triggers the consumers */
  seq: number;
};

export type RemoteProgress = {
  wordIndex: number;
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

/** arms (or re-arms) the match; consumers restart from the new seq */
export function armLanMatch(match: Omit<LanMatch, "seq">): void {
  seqCounter += 1;
  setMatchSignal({ ...match, seq: seqCounter });
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
export function sendLanMatchStart(words: string[], from: string): void {
  lanSendToPeer({ type: "start", gameId: "bot-duel", words, from });
}

/** both sides: per-completed-word progress relay */
export function sendLanMatchProgress(
  wordIndex: number,
  correctChars: number,
): void {
  lanSendToPeer({ type: "progress", wordIndex, correctChars });
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

/** the one place every match message is interpreted — the root effect
 * feeds it from the lan pipe, specs call it directly */
export function handleLanPeerMessage(message: Record<string, unknown>): void {
  const words = Array.isArray(message["words"])
    ? (message["words"] as unknown[]).filter(
        (word): word is string => typeof word === "string",
      )
    : [];
  if (
    message["type"] === "start" &&
    message["gameId"] === "bot-duel" &&
    words.length > 0
  ) {
    armLanMatch({
      role: getLanRole() === "host" ? "host" : "client",
      peerName:
        typeof message["from"] === "string"
          ? message["from"]
          : (getLanPeerName() ?? "P2"),
      gameId: "bot-duel",
      words,
    });
    void navigate({ to: "/games/bot-duel" });
    return;
  }
  if (matchSignal() === undefined) return; //no live match — ignore
  if (message["type"] === "progress") {
    const wordIndex = message["wordIndex"];
    if (typeof wordIndex === "number" && wordIndex >= 0) {
      setProgressSignal({ wordIndex, arrivalPerf: performance.now() });
    }
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
