import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { createSeededRng } from "../daily-gauntlet/seeded-rng";
import { BALANCE } from "./balance";

/**
 * Firefight's LanPlayable (online wave, phase 37 — pattern S #10): both
 * players fight the SAME seeded fire (the words AND the ignition/spread
 * picks derive from one shared seeded stream — identical grids evolving
 * identically; only the hose diverges) inside the shared survival window
 * from params. Each side's run ends by surviving the window (won) or the
 * ash ratio hitting the loss line (lost early); the finish carries the
 * elapsed time and the verdict resolves when both are in:
 *   1. surviving beats losing — the mission outcome comes first,
 *   2. the higher RAW score wins (the ash penalty stays a local-display
 *      rule — the remote ash count never travels, so both sides compare
 *      the same symmetric number),
 *   3. the longer survival breaks the equal-score tie,
 *   4. the exact parity is a draw. A peer without a finish loses.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool and builds the seeded stream.
 */

export type FireRemoteState = {
  /** the peer's live (raw) score */
  score: number;
  /** the peer's extinguished cells so far */
  extinguished: number;
};

export type FireVerdict = "won" | "lost" | "draw";

/** the survival verdict: the outcome first, then the raw score, then the
 * longer survival (the elapsed at the window or at the ash line) */
export function resolveFireVerdict(
  mine: { won: boolean; score: number; elapsedMs: number },
  theirs: { won: boolean; score: number; elapsedMs: number },
): FireVerdict {
  if (mine.won !== theirs.won) {
    return mine.won ? "won" : "lost";
  }
  if (mine.score !== theirs.score) {
    return mine.score > theirs.score ? "won" : "lost";
  }
  if (mine.elapsedMs !== theirs.elapsedMs) {
    return mine.elapsedMs > theirs.elapsedMs ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_LANGUAGE = "english";
const DEFAULT_SURVIVE_MS = BALANCE.surviveMs;
/** the offline fallback stream (the page's own fallback words) */
const FALLBACK_POOL = ["flame", "ember", "smoke", "blaze", "spark", "torch"];

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

/** the seeded fire stream: ONE rng drives the ignition/spread picks AND
 * the ignited cells' words — the same interleaved call order on both
 * machines evolves the identical grid (4-7 letter words, the page's
 * filter mirrored) */
export function fireLanStream(
  pool: string[],
  seed: number,
): { wordFor: () => string; rng: () => number } {
  const rng = createSeededRng(seed);
  const pickable = [
    ...new Set(
      pool
        .filter(
          (word) =>
            word.length >= BALANCE.minWordLen &&
            word.length <= BALANCE.maxWordLen &&
            /^\p{L}+$/u.test(word),
        )
        .map((word) => word.toLowerCase()),
    ),
  ];
  const source = pickable.length > 0 ? pickable : FALLBACK_POOL;
  return {
    rng,
    wordFor: () => source[Math.floor(rng() * source.length)] ?? "flame",
  };
}

export const lanFirefight: LanPlayable = {
  gameId: "firefight",
  route: "/games/firefight",
  label: "firefight",
  icon: "fa-fire",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "firefight",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        surviveMs: coerceCount(settings["surviveMs"], DEFAULT_SURVIVE_MS),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "firefight") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["surviveMs"]);
  },
  encodeProgress(state) {
    return {
      score: coerceCount(state["score"], 0),
      extinguished: coerceCount(state["extinguished"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const score = record["score"];
    const extinguished = record["extinguished"];
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      typeof extinguished !== "number" ||
      !Number.isFinite(extinguished) ||
      extinguished < 0
    ) {
      return undefined;
    }
    const state: FireRemoteState = {
      score: Math.floor(score),
      extinguished: Math.floor(extinguished),
    };
    return { ...state };
  },
};
