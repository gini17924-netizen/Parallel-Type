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
  getLanClients,
  getLanLastMessage,
  getLanLastMessageClientId,
  getLanMyClientId,
  getLanPeerName,
  getLanRole,
  lanSendToClient,
  lanSendToPeer,
} from "./lan";
import {
  advance as advanceTournament,
  currentMatch as currentTournamentMatch,
  decideWinner as decideWinnerTournament,
  getTournament,
  handleTournamentMessage,
  resolveReport as resolveTournamentReport,
  setHostTournament,
  type TournamentState,
} from "./lan-tournament";

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
  role: "host" | "client" | "spectator";
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

/** a game-specific message the generic router does not interpret — the
 * page consumes it directly (the V pattern's snapshot/input stream) */
export type RawLanMessage = {
  message: Record<string, unknown>;
  /** performance.now() at the message arrival */
  arrivalPerf: number;
};

/** phase 77 — the room map: every client's latest match state, keyed by
 * its clientId (the host is implicit and carries no id). The primary
 * peer's flow (getRemoteProgress/getRemoteFinished) is untouched — the
 * map is the multi-player layer on top. */
export type LanRoomClient = {
  clientId: number;
  name?: string;
  /** the client's latest decoded progress (shaped by the game contract) */
  progress?: Record<string, unknown>;
  finished?: { finishMs: number | null; acc: number };
};

const [roomClientsSignal, setRoomClientsSignal] = createSignal<
  Record<number, LanRoomClient>
>({});

export function getLanRoomClients(): Record<number, LanRoomClient> {
  return roomClientsSignal();
}

function updateRoomClient(clientId: number, patch: Partial<LanRoomClient>): void {
  const room = { ...getLanRoomClients() };
  room[clientId] = {
    ...(room[clientId] ?? { clientId }),
    name: getLanClients()[clientId]?.name,
    ...patch,
  };
  setRoomClientsSignal(room);
}

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
/** the raw passthrough for game-specific message types the generic router
 * does not interpret (the V pattern's state-sync: snapshots + inputs) */
const [rawSignal, setRawSignal] = createSignal<RawLanMessage | undefined>(
  undefined,
);

let seqCounter = 0;

function resetDerived(): void {
  setProgressSignal(undefined);
  setFinishedSignal(undefined);
  setRematchSignal(false);
  setRawSignal(undefined);
  //phase 77: a (re)armed match forgets the room's per-client states — the
  //roster itself lives in lan.ts and survives
  setRoomClientsSignal({});
}

/** arms (or re-arms) the match; consumers restart from the new seq. An
 * invalid start is refused (both sides gate through the registry). */
export function armLanMatch(match: {
  role: "host" | "client" | "spectator";
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

export function getLanRawMessage(): RawLanMessage | undefined {
  return rawSignal();
}

/** both sides: ships a game-specific message untouched — the V pattern's
 * state-sync (snapshots, inputs) rides the same pipe with its own types */
export function sendLanMatchMessage(message: Record<string, unknown>): void {
  lanSendToPeer(message);
}

/** host: ships the start (also the rematch re-send) to the room — an
 * invalid start is refused before it can reach the wire. phase 79: the
 * players list tells every receiver their seat — a clientId on the list
 * plays, everyone else in the room is a spectator */
export function sendLanMatchStart(
  start: LanStartPayload,
  from: string,
  players?: number[],
): void {
  const playable = getLanGame(start.gameId);
  if (playable === undefined || !playable.validateStart(start)) {
    console.error("lan: refusing to ship an invalid match start", start.gameId);
    return;
  }
  lanSendToPeer({
    ...start,
    type: "start",
    from,
    ...(players !== undefined ? { players } : {}),
  });
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
 * LanPlayable registry; the root effect feeds it, specs call it directly.
 * phase 77: `clientId` identifies the sender inside a room (undefined =
 * the host's own sends, or a v1 pipe without ids) — room-local progress
 * and finished states land in the clients map instead of the single-peer
 * signals */
export function handleLanPeerMessage(
  message: Record<string, unknown>,
  clientId?: number,
): void {
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
    //phase 79: the receiver classifies its own seat — the listed playerIds
    //play, the other room members watch (spectator); a start without a
    //players list is the v1 two-player shape (the client plays)
    const playerIds = Array.isArray(message["players"])
      ? (message["players"] as unknown[]).filter(
          (id): id is number => typeof id === "number",
        )
      : undefined;
    const myId = getLanMyClientId();
    let role: "host" | "client" | "spectator";
    if (getLanRole() === "host") {
      role = "host";
    } else if (playerIds !== undefined && myId !== undefined) {
      role = playerIds.includes(myId) ? "client" : "spectator";
    } else {
      role = "client";
    }
    armLanMatch({
      role,
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
    if (clientId !== undefined) {
      //a room member's progress lands in the clients map (phase 77)
      updateRoomClient(clientId, { progress: decoded });
      return;
    }
    setProgressSignal({ state: decoded, arrivalPerf: performance.now() });
    return;
  }
  if (message["type"] === "finished") {
    const finishMs = message["finishMs"];
    const acc = message["acc"];
    const finished = {
      finishMs: typeof finishMs === "number" ? finishMs : null,
      acc: typeof acc === "number" ? acc : 0,
    };
    if (clientId !== undefined) {
      updateRoomClient(clientId, { finished });
      return;
    }
    setFinishedSignal({ ...finished, arrivalPerf: performance.now() });
    return;
  }
  if (message["type"] === "rematch") setRematchSignal(true);
  if (message["type"] === "tournament") {
    //phase 78: the host's bracket broadcast — the lobby renders it
    handleTournamentMessage(message["tournament"]);
    return;
  }
  //anything else is a game-specific type: the raw passthrough hands it to
  //the mounted page (the V pattern's snapshots + inputs)
  setRawSignal({ message, arrivalPerf: performance.now() });
}

/** phase 78 — the host referee: starts one tournament match by TARGETED
 * sends (only its two players get the start; the rest of the room waits
 * in the lobby watching the bracket) */
export function startTournamentMatch(state: TournamentState): void {
  const match = currentTournamentMatch(state);
  if (match === undefined) return;
  const from = getLanPeerName() ?? "P1";
  for (const id of match.players) {
    if (id !== null) {
      lanSendToClient(id, {
        ...state.start,
        type: "start",
        from,
        tournamentMatch: { round: match.round, index: match.index },
      });
    }
  }
}

//phase 78 — the host referee loop: when both current-match players have
//resolved (finished, or left the room = a null finish), the winner
//advances, the bracket re-broadcasts and the next match starts. The
//two-player flow is untouched: this only runs while a tournament is live.
createRoot(() => {
  createEffect(() => {
    const state = getTournament();
    if (state === undefined || state.champion !== undefined) return;
    if (getLanRole() !== "host") return;
    const match = currentTournamentMatch(state);
    if (match === undefined) return;
    const room = getLanRoomClients();
    const reportA = resolveTournamentReport(room, match.players[0]);
    const reportB = resolveTournamentReport(room, match.players[1]);
    if (!reportA.resolved || !reportB.resolved) return;
    const winnerIndex = decideWinnerTournament(reportA.report, reportB.report);
    const winner = match.players[winnerIndex];
    if (winner === null) return;
    const next = advanceTournament(state, winner);
    setHostTournament(next);
    startTournamentMatch(next);
  });
});

//the module owns the message consumption: a start arms and navigates
//no matter which page is currently on screen. phase 77: the sender's
//clientId rides alongside the message (undefined = the host or a v1 pipe)
createRoot(() => {
  createEffect(() => {
    const message = getLanLastMessage();
    if (message !== undefined) {
      handleLanPeerMessage(message, getLanLastMessageClientId());
    }
  });
});

/** test hook: forgets everything (including the seq) between specs */
export function _resetLanMatchForTests(): void {
  clearLanMatch();
}
