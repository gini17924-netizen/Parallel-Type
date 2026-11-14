import { createSignal } from "solid-js";
import { LCG } from "@keybr/rand";

import { lanSendToPeer } from "./lan";

/**
 * The elimination tournament (phase 78): a pure bracket engine over the
 * phase-77 room. The HOST is the referee — it builds the bracket from the
 * room roster, broadcasts the state to everyone (the lobby renders the
 * table), starts each match with TARGETED starts (lan_send_to_client),
 * and drives the progression from the room map's per-client finished
 * reports (phase 77). Every transition is pure and seed-deterministic;
 * the wire shape is the plain state (no envelopes to keep it debuggable).
 *
 * Byes: the roster pads to the next power of two with null slots; a
 * one-sided match settles immediately (its real player advances). A
 * player that leaves mid-match counts as a null finish — their opponent
 * advances.
 */

export type TournamentPlayer = { clientId: number; name?: string };

export type TournamentMatch = {
  round: number;
  index: number;
  /** the two clientIds; null = a bye slot (auto-advance) */
  players: [number | null, number | null];
  winner?: number;
  done: boolean;
};

export type TournamentState = {
  players: TournamentPlayer[];
  rounds: TournamentMatch[][];
  currentRound: number;
  currentMatchIndex: number;
  /** the start payload the tournament's matches run with (the host's
   * selected game + settings at bracket time) */
  start: Record<string, unknown>;
  champion?: number;
};

/** a room-map finished report, exactly what phase 77 stores */
export type FinishReport = { finishMs: number | null; acc: number };

/** a null slot — the padding player */
const BYE: number | null = null;

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** builds one round's matches from an ordered list of advancing ids
 * (null = bye); a single-sided match settles immediately */
function buildRound(
  round: number,
  entrants: (number | null)[],
): TournamentMatch[] {
  const matches: TournamentMatch[] = [];
  for (let i = 0; i < entrants.length; i += 2) {
    const a = entrants[i] ?? null;
    const b = entrants[i + 1] ?? null;
    const singleSided = a !== null && b === null;
    matches.push({
      round,
      index: matches.length,
      players: [a, b],
      done: singleSided,
      winner: singleSided ? a : undefined,
    });
  }
  return matches;
}

/** the round's winners in order (bye matches carry theirs already) */
function roundWinners(round: TournamentMatch[]): (number | null)[] {
  return round.map((match) => match.winner ?? null);
}

/** creates the bracket: the roster is shuffled (seed), padded to the next
 * power of two with byes, and the first round is built */
export function createBracket(
  players: TournamentPlayer[],
  start: Record<string, unknown>,
  seed = Date.now(),
): TournamentState {
  const rng = LCG(seed);
  const shuffled = shuffle(players, rng);
  const padded: TournamentPlayer[] = [...shuffled];
  while (padded.length < nextPowerOfTwo(Math.max(shuffled.length, 1))) {
    padded.push({ clientId: BYE as number });
  }
  const entrants = padded.map((p) => p.clientId);
  const firstRound = buildRound(0, entrants);
  const state: TournamentState = {
    players: shuffled,
    rounds: [firstRound],
    currentRound: 0,
    currentMatchIndex: 0,
    start,
  };
  return settle(state);
}

/** the first match still to play (or undefined — the tournament is done) */
export function currentMatch(
  state: TournamentState,
): TournamentMatch | undefined {
  const round = state.rounds[state.currentRound];
  if (round === undefined) return undefined;
  return round.find((match) => !match.done);
}

/** the winner index (0 = players[0], 1 = players[1]) between two finish
 * reports: a real finish beats null; lower finishMs wins; higher acc
 * breaks ties; index 0 breaks everything (deterministic) */
export function decideWinner(
  a: FinishReport | null,
  b: FinishReport | null,
): 0 | 1 {
  if (a === null) return 1;
  if (b === null) return 0;
  const aMs = a.finishMs;
  const bMs = b.finishMs;
  if (aMs !== null && bMs === null) return 0;
  if (bMs !== null && aMs === null) return 1;
  if (aMs !== null && bMs !== null && aMs !== bMs) {
    return aMs < bMs ? 0 : 1;
  }
  if (a.acc !== b.acc) return a.acc > b.acc ? 0 : 1;
  return 0;
}

/** records the winner; when the round completes, the next round is built
 * from the winners — or the champion is crowned on the final */
export function advance(
  state: TournamentState,
  winner: number,
): TournamentState {
  const rounds = state.rounds.map((round) =>
    round.map((match) => ({ ...match, players: [...match.players] as [number | null, number | null] })),
  );
  const round = rounds[state.currentRound];
  if (round === undefined) return state;
  const match = round[state.currentMatchIndex];
  if (match === undefined || match.done) return state;
  match.winner = winner;
  match.done = true;

  const nextIndex = round.findIndex((m) => !m.done);
  if (nextIndex !== -1) {
    return {
      ...state,
      rounds,
      currentMatchIndex: nextIndex,
    };
  }

  //the round is complete
  const winners = roundWinners(round);
  if (winners.length === 1) {
    const champion = winners[0] ?? undefined;
    return {
      ...state,
      rounds,
      currentMatchIndex: state.currentMatchIndex,
      champion,
    };
  }
  const nextRound = buildRound(state.currentRound + 1, winners);
  rounds.push(nextRound);
  const settled: TournamentState = {
    ...state,
    rounds,
    currentRound: state.currentRound + 1,
    currentMatchIndex: 0,
  };
  return settle(settled);
}

/** marks any one-sided (bye) matches done — called after every round
 * build; a full-bye round cannot happen (the padding is a power of two) */
function settle(state: TournamentState): TournamentState {
  const rounds = state.rounds;
  let changed = false;
  for (let r = state.currentRound; r < rounds.length; r++) {
    const round = rounds[r] as TournamentMatch[];
    for (const match of round) {
      if (
        !match.done &&
        ((match.players[0] !== null && match.players[1] === null) ||
          (match.players[0] === null && match.players[1] !== null))
      ) {
        match.done = true;
        const first = match.players[0];
        const second = match.players[1];
        match.winner = first ?? (second as number);
        changed = true;
      }
    }
  }
  if (!changed) return state;
  //a fully-settled current round advances immediately (bye chains)
  const round = rounds[state.currentRound] as TournamentMatch[];
  const nextIndex = round.findIndex((m) => !m.done);
  if (nextIndex !== -1) {
    return { ...state, currentMatchIndex: nextIndex };
  }
  const winners = roundWinners(round);
  if (winners.length === 1) {
    return { ...state, champion: winners[0] ?? undefined };
  }
  const nextRound = buildRound(state.currentRound + 1, winners);
  const next: TournamentState = {
    ...state,
    rounds: [...rounds, nextRound],
    currentRound: state.currentRound + 1,
    currentMatchIndex: 0,
  };
  return settle(next);
}

export function isTournamentComplete(state: TournamentState): boolean {
  return state.champion !== undefined;
}

// ------------------------------------------------------------------ wire

const [tournamentSignal, setTournamentSignal] = createSignal<
  TournamentState | undefined
>(undefined);

export function getTournament(): TournamentState | undefined {
  return tournamentSignal();
}

/** the host: owns its own bracket and mirrors it to the room */
export function setHostTournament(state: TournamentState): void {
  setTournamentSignal(state);
  lanSendToPeer({ type: "tournament", tournament: state });
}

export function clearTournament(): void {
  setTournamentSignal(undefined);
  lanSendToPeer({ type: "tournament", tournament: null });
}

/** a loose wire check — the state is host-authored, so the client trusts
 * the shape minimally (rounds array + start object) */
function looksLikeTournament(value: unknown): value is TournamentState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { rounds?: unknown; start?: unknown };
  return Array.isArray(candidate.rounds) && typeof candidate.start === "object";
}

/** the client: a tournament message from the host replaces the bracket */
export function handleTournamentMessage(
  tournament: unknown,
): void {
  if (tournament === null) {
    setTournamentSignal(undefined);
    return;
  }
  if (looksLikeTournament(tournament)) {
    setTournamentSignal(tournament);
  }
}

/** resolves one current-match player's report from the phase-77 room map:
 * undefined = still playing; null = the player left without finishing;
 * a report = the race verdict */
export function resolveReport(
  room: Record<number, { finished?: FinishReport }>,
  clientId: number | null,
): { resolved: boolean; report: FinishReport | null } {
  if (clientId === null) return { resolved: true, report: null };
  const entry = room[clientId];
  if (entry === undefined) return { resolved: true, report: null };
  if (entry.finished !== undefined) {
    return { resolved: true, report: entry.finished };
  }
  return { resolved: false, report: null };
}
