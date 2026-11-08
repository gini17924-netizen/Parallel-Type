import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { shuffleWithSeed } from "../games/seeded-shuffle";
import { FALLBACK_WORDS } from "../bot-duel/duel-words";

/**
 * Sprint's LanPlayable (online wave, phase 5 — pattern R): a ten-second
 * burst where both players race the SAME seeded stream. Nothing is
 * shipped but the seed + params — both machines hold the identical
 * language pool (same app version), so the seeded shuffle reproduces the
 * exact word sequence locally. The verdict lands at the horn: more
 * complete words wins, more correct chars breaks the tie.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool and shuffles with the seed.
 */

export type SprintRemoteState = {
  /** complete words at the report moment */
  words: number;
  /** momentary-correct characters (the tiebreak) */
  chars: number;
};

export type SprintVerdict = "won" | "lost" | "draw";

/** the LAN word order: the shared seeded LCG shuffle (the daily's
 * algorithm), seeded by the match seed */
export function buildSprintStream(pool: string[], seed: number): string[] {
  return shuffleWithSeed(pool, seed);
}

/** the horn verdict: more words wins, correct chars break the tie */
export function resolveSprintVerdict(
  mine: SprintRemoteState,
  theirs: SprintRemoteState,
): SprintVerdict {
  if (mine.words !== theirs.words) {
    return mine.words > theirs.words ? "won" : "lost";
  }
  if (mine.chars !== theirs.chars) {
    return mine.chars > theirs.chars ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_STREAM_WORDS = 60;
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

export const lanSprint: LanPlayable = {
  gameId: "sprint",
  route: "/games/sprint",
  label: "sprint",
  icon: "fa-bolt",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "sprint",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        words: coerceCount(settings["words"], DEFAULT_STREAM_WORDS),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "sprint") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["words"]);
  },
  encodeProgress(state) {
    const words = state["words"];
    const chars = state["chars"];
    return {
      words: typeof words === "number" && words >= 0 ? Math.floor(words) : 0,
      chars: typeof chars === "number" && chars >= 0 ? Math.floor(chars) : 0,
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const words = record["words"];
    const chars = record["chars"];
    if (
      typeof words !== "number" ||
      !Number.isFinite(words) ||
      words < 0 ||
      typeof chars !== "number" ||
      !Number.isFinite(chars) ||
      chars < 0
    ) {
      return undefined;
    }
    const state: SprintRemoteState = {
      words: Math.floor(words),
      chars: Math.floor(chars),
    };
    return { ...state };
  },
};

/** the stream the LAN match races (the lobby passes no pool — both sides
 * fetch their identical bundled pool and shuffle with the shared seed) */
export function sprintLanStream(pool: string[], seed: number): string[] {
  const source = pool.length > 0 ? pool : FALLBACK_WORDS;
  return buildSprintStream(source, seed);
}
