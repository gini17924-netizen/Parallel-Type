import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";

/**
 * Balloon Pop's LanPlayable (online wave, phase 23 — pattern S, the
 * score race #3): both players play the SAME seeded balloon sequence for
 * the SAME duration and the horn compares the pops — the more pops wins,
 * the score breaks the tie, the exact parity is a draw (both horns land
 * within one RTT). The seeded rng drives the spawner (letters/words/
 * punctuation per stage) on both machines; the hear-it TTS mode stays
 * offline-only.
 *
 * Pure — the lobby passes the language + stage in settings; the page
 * (phase B) fetches that language's pool and wires the seeded spawner.
 */

export type BalloonRemoteState = {
  /** the peer's popped balloons */
  pops: number;
  /** the peer's score (the tiebreak) */
  score: number;
};

export type BalloonVerdict = "won" | "lost" | "draw";

/** the horn verdict: more pops wins, the score breaks the tie */
export function resolveBalloonVerdict(
  mine: { pops: number; score: number },
  theirs: { pops: number; score: number },
): BalloonVerdict {
  if (mine.pops !== theirs.pops) {
    return mine.pops > theirs.pops ? "won" : "lost";
  }
  if (mine.score !== theirs.score) {
    return mine.score > theirs.score ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_DURATION_MS = 120_000;
const DEFAULT_LANGUAGE = "english";
const DEFAULT_STAGE = 1;

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

export const lanBalloon: LanPlayable = {
  gameId: "balloon-pop",
  route: "/games/balloon-pop",
  label: "balloon pop",
  icon: "fa-circle",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "balloon-pop",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        stage: coerceCount(settings["stage"], DEFAULT_STAGE),
        durationMs: coerceCount(settings["durationMs"], DEFAULT_DURATION_MS),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "balloon-pop") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    const stage = start.params["stage"];
    if (
      typeof stage !== "number" ||
      !Number.isInteger(stage) ||
      stage < 1 ||
      stage > 4
    ) {
      return false;
    }
    return isPositiveInt(start.params["durationMs"]);
  },
  encodeProgress(state) {
    return {
      pops: coerceCount(state["pops"], 0),
      score: coerceCount(state["score"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const pops = record["pops"];
    const score = record["score"];
    if (
      typeof pops !== "number" ||
      !Number.isFinite(pops) ||
      pops < 0 ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0
    ) {
      return undefined;
    }
    const state: BalloonRemoteState = {
      pops: Math.floor(pops),
      score: Math.floor(score),
    };
    return { ...state };
  },
};
