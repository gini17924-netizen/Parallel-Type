import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";

/**
 * Wordle's LanPlayable (online wave, phase 27 — pattern S #5): both
 * players solve the SAME seeded answer head-to-head — the horn compares
 * the GUESS COUNTS (fewer guesses wins), the elapsed time breaks the tie
 * (both finish at their own pace), the exact parity is a draw. The seeded
 * rng picks the answer from the identical pool on both machines. There is
 * no horn timer: the race ends when BOTH sides finish (each side sends
 * its finish when done — the verdict resolves when both are in).
 *
 * Pure — the lobby passes the language + mode in settings; the page
 * (phase B) fetches that language's pools and picks the seeded answer.
 */

export type WordleRemoteState = {
  /** the peer's submitted guesses so far */
  guesses: number;
  /** whether the peer has solved the answer */
  solved: boolean;
};

export type WordleVerdict = "won" | "lost" | "draw";

/** the horn verdict: fewer guesses wins, the elapsed time breaks the tie */
export function resolveWordleVerdict(
  mine: { guesses: number; elapsedMs: number },
  theirs: { guesses: number; elapsedMs: number },
): WordleVerdict {
  if (mine.guesses !== theirs.guesses) {
    return mine.guesses < theirs.guesses ? "won" : "lost";
  }
  if (mine.elapsedMs !== theirs.elapsedMs) {
    return mine.elapsedMs < theirs.elapsedMs ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_LANGUAGE = "english";
const DEFAULT_MODE = "en";

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

export const lanWordle: LanPlayable = {
  gameId: "wordle",
  route: "/games/wordle",
  label: "wordle",
  icon: "fa-font",
  buildStart(settings) {
    const lang = settings["lang"];
    const mode = settings["mode"];
    const start: LanStartPayload = {
      gameId: "wordle",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        mode:
          mode === "fa" ? "fa" : mode === "random" ? "random" : DEFAULT_MODE,
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "wordle") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    const mode = start.params["mode"];
    return mode === "en" || mode === "fa" || mode === "random";
  },
  encodeProgress(state) {
    return {
      guesses: coerceCount(state["guesses"], 0),
      solved: state["solved"] === true ? 1 : 0,
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const guesses = record["guesses"];
    const solved = record["solved"];
    if (
      typeof guesses !== "number" ||
      !Number.isFinite(guesses) ||
      guesses < 0
    ) {
      return undefined;
    }
    if (typeof solved !== "boolean" && solved !== 0 && solved !== 1) {
      return undefined; //the flag is part of the state — missing = untrusted
    }
    const state: WordleRemoteState = {
      guesses: Math.floor(guesses),
      solved: solved === 1 || solved === true,
    };
    return { ...state };
  },
};
