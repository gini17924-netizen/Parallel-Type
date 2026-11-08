import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { isDifficulty, type Difficulty } from "../word-blast";

/**
 * Word Blast's LanPlayable (online wave, phase 19 — pattern S, the
 * score-race proof): both players play the SAME seeded spawn stream for
 * the SAME duration and the horn compares the scores — the higher score
 * wins, the exact parity is a draw (both horns land within one RTT, so
 * there is no time tiebreak to speak of). The seeded rng drives the
 * target picks and the spawn jitter on both machines (the KI-40 pattern
 * the daily gauntlet already uses).
 *
 * Pure — the lobby passes the language + difficulty in settings.
 */

export type WordBlastRemoteState = {
  /** the peer's live score */
  score: number;
  /** the peer's current combo streak */
  combo: number;
};

export type WordBlastVerdict = "won" | "lost" | "draw";

/** the horn verdict: the higher score wins */
export function resolveWordBlastVerdict(
  mine: { score: number },
  theirs: { score: number },
): WordBlastVerdict {
  if (mine.score !== theirs.score) {
    return mine.score > theirs.score ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_DURATION_MS = 90_000;
const DEFAULT_LANGUAGE = "english";
const DEFAULT_DIFFICULTY: Difficulty = "normal";

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

export const lanWordBlast: LanPlayable = {
  gameId: "word-blast",
  route: "/games/word-blast",
  label: "word blast",
  icon: "fa-bomb",
  buildStart(settings) {
    const lang = settings["lang"];
    const difficulty = settings["difficulty"];
    const start: LanStartPayload = {
      gameId: "word-blast",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        difficulty: isDifficulty(difficulty) ? difficulty : DEFAULT_DIFFICULTY,
        durationMs: coerceCount(settings["durationMs"], DEFAULT_DURATION_MS),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "word-blast") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    if (!isDifficulty(start.params["difficulty"])) return false;
    return isPositiveInt(start.params["durationMs"]);
  },
  encodeProgress(state) {
    return {
      score: coerceCount(state["score"], 0),
      combo: coerceCount(state["combo"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const score = record["score"];
    const combo = record["combo"];
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      typeof combo !== "number" ||
      !Number.isFinite(combo) ||
      combo < 0
    ) {
      return undefined;
    }
    const state: WordBlastRemoteState = {
      score: Math.floor(score),
      combo: Math.floor(combo),
    };
    return { ...state };
  },
};
