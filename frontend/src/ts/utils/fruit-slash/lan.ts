import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { createSeededRng } from "../daily-gauntlet/seeded-rng";
import { BALANCE } from "./balance";

/**
 * Fruit Slash's LanPlayable (online wave, phase 35 — pattern S #9): both
 * players slash the SAME seeded launch stream (the word picks, the bomb
 * mix and the arc angles all derive from the shared seed — identical
 * fruits in the identical order; only the typing diverges) inside the
 * shared 90-second window. The horn fires for both (within one RTT) and
 * the run can end early only by typing 3 bombs — the horn verdict: the
 * HIGHER SCORE wins, the exact parity is a draw (both sides ran the same
 * clock — no time tiebreak, the word-blast family rule). A peer without
 * a finish loses.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool and builds the seeded spawn.
 */

export type FruitRemoteState = {
  /** the peer's live score */
  score: number;
  /** the peer's typed bombs so far (3 = the early end) */
  bombs: number;
};

export type FruitVerdict = "won" | "lost" | "draw";

/** the horn verdict: the higher score wins, the exact parity is a draw
 * (both sides ran the same 90s window — no time tiebreak) */
export function resolveFruitVerdict(
  mine: { score: number },
  theirs: { score: number },
): FruitVerdict {
  if (mine.score !== theirs.score) {
    return mine.score > theirs.score ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_LANGUAGE = "english";
const DEFAULT_DURATION_MS = BALANCE.durationMs;
/** the offline fallback stream (the page's own fallback words) */
const FALLBACK_POOL = ["fig", "date", "kiwi", "mango", "berry", "melon"];

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

/** the seeded spawn: the page's exact launch policy (level-riding word
 * window, bomb mix) mirrored under the shared rng — word pick AND bomb
 * decision both consume the seeded stream, so both machines launch the
 * identical fruits in the identical order */
export function fruitLanSpawn(
  pool: string[],
  seed: number,
): (level: number) => { word: string; isBomb: boolean } {
  const rng = createSeededRng(seed);
  const pickable = [
    ...new Set(
      pool
        .filter((word) => /^\p{L}+$/u.test(word))
        .map((word) => word.toLowerCase()),
    ),
  ];
  const source = pickable.length > 0 ? pickable : FALLBACK_POOL;
  return (level) => {
    //word length rides the level: 4 letters, +1 every 2 levels, cap 6
    const maxLen = Math.min(
      BALANCE.maxWordLen,
      BALANCE.minWordLen + Math.floor(level / 2),
    );
    const window_ = source.filter(
      (word) => word.length >= BALANCE.minWordLen && word.length <= maxLen,
    );
    const useSource = window_.length > 0 ? window_ : source;
    const word = useSource[Math.floor(rng() * useSource.length)] ?? "fig";
    return { word, isBomb: rng() < BALANCE.bombChance };
  };
}

export const lanFruitSlash: LanPlayable = {
  gameId: "fruit-slash",
  route: "/games/fruit-slash",
  label: "fruit slash",
  icon: "fa-apple-alt",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "fruit-slash",
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
    if (start.gameId !== "fruit-slash") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["durationMs"]);
  },
  encodeProgress(state) {
    return {
      score: coerceCount(state["score"], 0),
      bombs: coerceCount(state["bombs"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const score = record["score"];
    const bombs = record["bombs"];
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      typeof bombs !== "number" ||
      !Number.isFinite(bombs) ||
      bombs < 0
    ) {
      return undefined;
    }
    const state: FruitRemoteState = {
      score: Math.floor(score),
      bombs: Math.floor(bombs),
    };
    return { ...state };
  },
};
