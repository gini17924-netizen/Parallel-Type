import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { shuffleWithSeed } from "../games/seeded-shuffle";

/**
 * Type Snake's LanPlayable (online wave, phase 29 — pattern S #6): both
 * players steer through the SAME seeded food stream (the placement rng and
 * the food words both derive from the shared seed — identical foods in the
 * identical order; only the typing pace diverges) and the run ends when
 * boxed in — the death race. There is no horn timer: each side sends its
 * finish when boxed in, the verdict resolves when both are in — the
 * HIGHER SCORE wins (score = Σ word length x 15 over the shared stream),
 * the longer survival breaks the tie (equal score but still alive means
 * the better run), the exact parity is a draw. A peer without a finish
 * loses.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool and feeds the seeded word stream.
 */

export type SnakeRemoteState = {
  /** the peer's live snake length */
  length: number;
  /** the peer's live score */
  score: number;
};

export type SnakeVerdict = "won" | "lost" | "draw";

/** the death-race verdict: the higher score wins, the longer survival
 * (elapsed at being boxed in) breaks the tie */
export function resolveSnakeVerdict(
  mine: { score: number; elapsedMs: number },
  theirs: { score: number; elapsedMs: number },
): SnakeVerdict {
  if (mine.score !== theirs.score) {
    return mine.score > theirs.score ? "won" : "lost";
  }
  if (mine.elapsedMs !== theirs.elapsedMs) {
    return mine.elapsedMs > theirs.elapsedMs ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_LANGUAGE = "english";
/** the offline fallback stream (the page's own fallback words) */
const FALLBACK_STREAM = ["hi", "run", "key", "tap", "win", "ace"];

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

/** the seeded food-word stream: the pool's 2-3 letter words (the same
 * filter the page applies), shuffled under the shared seed and consumed
 * one per spawn — both machines land on the identical foods */
export function typeSnakeLanWordStream(
  pool: string[],
  seed: number,
): () => string {
  const shortWords = [
    ...new Set(
      pool
        .filter(
          (word) =>
            word.length >= 2 && word.length <= 3 && /^\p{L}+$/u.test(word),
        )
        .map((word) => word.toLowerCase()),
    ),
  ];
  const stream =
    shortWords.length > 0 ? shuffleWithSeed(shortWords, seed) : FALLBACK_STREAM;
  let cursor = 0;
  return () => {
    const word = stream[cursor % stream.length] ?? "go";
    cursor += 1;
    return word;
  };
}

export const lanTypeSnake: LanPlayable = {
  gameId: "type-snake",
  route: "/games/type-snake",
  label: "type snake",
  icon: "fa-dragon",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "type-snake",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "type-snake") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    return typeof lang === "string" && lang.length > 0;
  },
  encodeProgress(state) {
    return {
      length: coerceCount(state["length"], 0),
      score: coerceCount(state["score"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const length = record["length"];
    const score = record["score"];
    if (
      typeof length !== "number" ||
      !Number.isFinite(length) ||
      length < 0 ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0
    ) {
      return undefined;
    }
    const state: SnakeRemoteState = {
      length: Math.floor(length),
      score: Math.floor(score),
    };
    return { ...state };
  },
};
