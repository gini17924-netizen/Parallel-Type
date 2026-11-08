import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { shuffleWithSeed } from "../games/seeded-shuffle";

/**
 * Nitro Run's LanPlayable (online wave, phase 13 — pattern R, seeded):
 * the endless AI race becomes a sprint to a target distance — the AI
 * field drops out, both players type the SAME seeded word stream and
 * the nitro/combo mechanics carry over (a 5-word streak banks charges,
 * Enter burns one for x2 progress). The first across the target line
 * wins: the lower finish time wins (frames aligned within one RTT), a
 * peer without a finish loses, the exact tie is a draw.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool, shuffles with the seed and drives the
 * engine's nextWord from the stream.
 */

export type NitroRemoteState = {
  /** the peer's live distance in meters */
  meters: number;
  /** the peer's completed words */
  words: number;
};

export type NitroVerdict = "won" | "lost" | "draw";

/** the finish-line verdict: the lower finish time wins */
export function resolveNitroVerdict(
  mine: { finishMs: number },
  theirs: { finishMs: number },
): NitroVerdict {
  if (mine.finishMs !== theirs.finishMs) {
    return mine.finishMs < theirs.finishMs ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_TARGET_M = 1000;
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

/** the seeded word stream both sides race over (cycled by the page) */
export function nitroLanStream(pool: string[], seed: number): string[] {
  return shuffleWithSeed(pool, seed);
}

export const lanNitro: LanPlayable = {
  gameId: "nitro-run",
  route: "/games/nitro-run",
  label: "nitro run",
  icon: "fa-car-side",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "nitro-run",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        meters: coerceCount(settings["meters"], DEFAULT_TARGET_M),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "nitro-run") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["meters"]);
  },
  encodeProgress(state) {
    return {
      meters: coerceCount(state["meters"], 0),
      words: coerceCount(state["words"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const meters = record["meters"];
    const words = record["words"];
    if (
      typeof meters !== "number" ||
      !Number.isFinite(meters) ||
      meters < 0 ||
      typeof words !== "number" ||
      !Number.isFinite(words) ||
      words < 0
    ) {
      return undefined;
    }
    const state: NitroRemoteState = {
      meters: Math.floor(meters),
      words: Math.floor(words),
    };
    return { ...state };
  },
};
