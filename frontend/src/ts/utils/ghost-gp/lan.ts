import {
  createLanSeed,
  wordIndexProgressCodec,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { shuffleWithSeed } from "../games/seeded-shuffle";
import { FALLBACK_WORDS } from "../bot-duel/duel-words";

/**
 * Ghost GP's LanPlayable (online wave, phase 7 — pattern R, seeded): the
 * opponent replaces the ghost — their relayed progress drives the SAME
 * BotPacer interface the curve ghost uses (the remote pacer), so the duel
 * engine cannot tell them apart. The word sequence is seeded: both
 * machines rebuild the identical race locally from the shared seed (the
 * same LCG shuffle the daily uses) — nothing is shipped but the seed.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool, shuffles with the seed and hands the
 * remote pacer to createGpEngine.
 */

const DEFAULT_RACE_LENGTH = 35; //the standard GP race
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

/** the race stream the LAN match runs (the fallback pool cycles when the
 * fetch failed) */
export function gpLanStream(pool: string[], seed: number): string[] {
  const source = pool.length > 0 ? pool : FALLBACK_WORDS;
  return shuffleWithSeed(source, seed);
}

export const lanGhostGp: LanPlayable = {
  gameId: "ghost-gp",
  route: "/games/ghost-gp",
  label: "ghost gp",
  icon: "fa-ghost",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "ghost-gp",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        words: coerceCount(settings["words"], DEFAULT_RACE_LENGTH),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "ghost-gp") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["words"]);
  },
  ...wordIndexProgressCodec(),
};
