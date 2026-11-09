import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";

/**
 * Pair Keys' LanPlayable (online wave, phase 25 — pattern S #4): both
 * players memorize and solve the SAME seeded board (the engine is fully
 * deterministic under the injected rng — identical cards, identical
 * order) and the horn compares the finish times — the memory race. The
 * lower finish time wins; the doc's accuracy rule breaks the tie: fewer
 * MOVES (extra flips) beat more; the exact parity is a draw. A peer
 * without a finish loses.
 *
 * Pure — the lobby passes the language + mode + level in settings; the
 * page (phase B) builds the board with the seeded rng (form-name mode
 * needs the joining letters of that language).
 */

export type PairRemoteState = {
  /** the peer's matched pairs so far */
  found: number;
  /** the peer's flip moves so far */
  moves: number;
};

export type PairVerdict = "won" | "lost" | "draw";

/** the horn verdict: the lower finish time wins, fewer moves breaks the
 * tie (the doc's accuracy rule — extra flips cost) */
export function resolvePairVerdict(
  mine: { finishMs: number; moves: number },
  theirs: { finishMs: number; moves: number },
): PairVerdict {
  if (mine.finishMs !== theirs.finishMs) {
    return mine.finishMs < theirs.finishMs ? "won" : "lost";
  }
  if (mine.moves !== theirs.moves) {
    return mine.moves < theirs.moves ? "won" : "lost";
  }
  return "draw";
}

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

export const lanPairKeys: LanPlayable = {
  gameId: "pair-keys",
  route: "/games/pair-keys",
  label: "pair keys",
  icon: "fa-clone",
  buildStart(settings) {
    const lang = settings["lang"];
    const mode = settings["mode"];
    const start: LanStartPayload = {
      gameId: "pair-keys",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        mode: mode === "letter" ? "letter" : "form-name",
        level: coerceCount(settings["level"], 1) === 2 ? 2 : 1,
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "pair-keys") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    const mode = start.params["mode"];
    if (mode !== "form-name" && mode !== "letter") return false;
    const level = start.params["level"];
    return level === 1 || level === 2;
  },
  encodeProgress(state) {
    return {
      found: coerceCount(state["found"], 0),
      moves: coerceCount(state["moves"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const found = record["found"];
    const moves = record["moves"];
    if (
      typeof found !== "number" ||
      !Number.isFinite(found) ||
      found < 0 ||
      typeof moves !== "number" ||
      !Number.isFinite(moves) ||
      moves < 0
    ) {
      return undefined;
    }
    const state: PairRemoteState = {
      found: Math.floor(found),
      moves: Math.floor(moves),
    };
    return { ...state };
  },
};
