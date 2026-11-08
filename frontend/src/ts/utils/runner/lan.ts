import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { shuffleWithSeed } from "../games/seeded-shuffle";
import { BALANCE } from "./balance";

/**
 * Endless Runner's LanPlayable (online wave, phase 17 — pattern R,
 * seeded): the endless run becomes a race to a target distance — both
 * players run the SAME seeded obstacles (the seeded rng drives the
 * kinds/gaps; the seeded pickWord walks a shuffled pool filtered by the
 * length window, so the identical words appear identically) and the
 * three-lives rules carry over. The first across the target line wins:
 * the lower finish time wins (frames aligned within one RTT), a peer
 * without a finish loses, the exact tie is a draw.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool and wires the seeded helpers.
 */

export type RunnerRemoteState = {
  /** the peer's live distance in meters */
  meters: number;
  /** the peer's lives left */
  lives: number;
};

export type RunnerVerdict = "won" | "lost" | "draw";

/** the finish-line verdict: the lower finish time wins */
export function resolveRunnerVerdict(
  mine: { finishMs: number },
  theirs: { finishMs: number },
): RunnerVerdict {
  if (mine.finishMs !== theirs.finishMs) {
    return mine.finishMs < theirs.finishMs ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_TARGET_M = 400;
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

/** the seeded pickWord: walks the shuffled pool for the next word inside
 * the requested length window (deterministic on both machines — the
 * engine calls it in the same order over the same stream) */
export function runnerLanPickWord(
  pool: string[],
  seed: number,
): (minLen: number, maxLen: number) => string {
  const source = pool.length > 0 ? pool : ["run", "jump", "type"];
  const stream = shuffleWithSeed(source, seed);
  let cursor = 0;
  return (minLen, maxLen) => {
    for (const _ of stream) {
      const word = stream[cursor % stream.length] ?? "run";
      cursor += 1;
      if (word.length >= minLen && word.length <= maxLen) return word;
    }
    return stream[0] ?? "run";
  };
}

export const lanRunner: LanPlayable = {
  gameId: "runner",
  route: "/games/runner",
  label: "endless runner",
  icon: "fa-running",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "runner",
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
    if (start.gameId !== "runner") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["meters"]);
  },
  encodeProgress(state) {
    return {
      meters: coerceCount(state["meters"], 0),
      lives: coerceCount(state["lives"], BALANCE.lives),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const meters = record["meters"];
    const lives = record["lives"];
    if (
      typeof meters !== "number" ||
      !Number.isFinite(meters) ||
      meters < 0 ||
      typeof lives !== "number" ||
      !Number.isFinite(lives) ||
      lives < 0
    ) {
      return undefined;
    }
    const state: RunnerRemoteState = {
      meters: Math.floor(meters),
      lives: Math.floor(lives),
    };
    return { ...state };
  },
};
