import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { shuffleWithSeed } from "../games/seeded-shuffle";

/**
 * Stack Attack's LanPlayable (online wave, phase 21 — pattern S, the
 * score race #2): both players play the SAME seeded block stream for the
 * SAME duration and the horn compares the cleared-rows progress — the
 * more rowsCleared wins, the score breaks the tie, the exact parity is a
 * draw (both horns land within one RTT). The seeded rng drives the block
 * words and the spawn order on both machines; the steering is local.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool and cycles the shuffled stream.
 */

export type StackRemoteState = {
  /** the peer's cleared rows */
  rows: number;
  /** the peer's score (the tiebreak) */
  score: number;
};

export type StackVerdict = "won" | "lost" | "draw";

/** the horn verdict: more cleared rows wins, the score breaks the tie */
export function resolveStackVerdict(
  mine: { rows: number; score: number },
  theirs: { rows: number; score: number },
): StackVerdict {
  if (mine.rows !== theirs.rows) {
    return mine.rows > theirs.rows ? "won" : "lost";
  }
  if (mine.score !== theirs.score) {
    return mine.score > theirs.score ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_DURATION_MS = 120_000;
const DEFAULT_LANGUAGE = "english";

function coerceCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 2147483647
  );
}

/** the seeded block stream (cycled by the page's spawnWord) */
export function stackLanStream(pool: string[], seed: number): string[] {
  return shuffleWithSeed(pool, seed);
}

export const lanStack: LanPlayable = {
  gameId: "stack-attack",
  route: "/games/stack-attack",
  label: "stack attack",
  icon: "fa-cubes",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "stack-attack",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        durationMs: coerceCount(settings["durationMs"], DEFAULT_DURATION_MS),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "stack-attack") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["durationMs"]);
  },
  encodeProgress(state) {
    return {
      rows: coerceCount(state["rows"], 0),
      score: coerceCount(state["score"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const rows = record["rows"];
    const score = record["score"];
    if (
      typeof rows !== "number" ||
      !Number.isFinite(rows) ||
      rows < 0 ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0
    ) {
      return undefined;
    }
    const state: StackRemoteState = {
      rows: Math.floor(rows),
      score: Math.floor(score),
    };
    return { ...state };
  },
};
