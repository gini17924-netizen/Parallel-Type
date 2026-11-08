import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { shuffleWithSeed } from "../games/seeded-shuffle";

/**
 * Sky Climber's LanPlayable (online wave, phase 15 — pattern R, seeded):
 * the endless pressure climb becomes a race to a target height — both
 * players climb the SAME seeded platforms (the shrinking timers and the
 * fall rules carry over), and the first to reach the target height wins:
 * the lower finish time wins (frames aligned within one RTT), a peer
 * without a finish loses, the exact tie is a draw.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool and builds the seeded wordFor.
 */

export type ClimberRemoteState = {
  /** the peer's live height (platform index) */
  height: number;
  /** the peer's score */
  score: number;
};

export type ClimberVerdict = "won" | "lost" | "draw";

/** the finish-line verdict: the lower finish time wins */
export function resolveClimberVerdict(
  mine: { finishMs: number },
  theirs: { finishMs: number },
): ClimberVerdict {
  if (mine.finishMs !== theirs.finishMs) {
    return mine.finishMs < theirs.finishMs ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_TARGET_HEIGHT = 30;
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

/** the seeded word-for: platform index -> the shuffled pool's word
 * (deterministic on both machines from the shared seed) */
export function climberLanWordFor(
  pool: string[],
  seed: number,
): (index: number) => string {
  const stream =
    pool.length > 0 ? shuffleWithSeed(pool, seed) : ["climb", "type", "fast"];
  return (index: number) => stream[index % stream.length] ?? "climb";
}

export const lanClimber: LanPlayable = {
  gameId: "climber",
  route: "/games/climber",
  label: "sky climber",
  icon: "fa-arrow-up",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "climber",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        height: coerceCount(settings["height"], DEFAULT_TARGET_HEIGHT),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "climber") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["height"]);
  },
  encodeProgress(state) {
    return {
      height: coerceCount(state["height"], 0),
      score: coerceCount(state["score"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const height = record["height"];
    const score = record["score"];
    if (
      typeof height !== "number" ||
      !Number.isFinite(height) ||
      height < 0 ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0
    ) {
      return undefined;
    }
    const state: ClimberRemoteState = {
      height: Math.floor(height),
      score: Math.floor(score),
    };
    return { ...state };
  },
};
