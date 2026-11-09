import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { createSeededRng } from "../daily-gauntlet/seeded-rng";
import { createWaveSpawner, type WaveSpawner } from "./spawner";

/**
 * Letter Strike's LanPlayable (online wave, phase 31 — pattern S #7): both
 * players face the SAME seeded waves (the spawner's rng derives from the
 * shared seed — identical ships, identical order, identical bosses; only
 * the typing pace diverges) and the run ends when the last life is lost —
 * the death race. There is no horn timer: each side sends its finish when
 * boxed in, the verdict resolves when both are in — the HIGHER SCORE wins
 * (score = Σ word length x 10 x the combo tier over the shared waves), the
 * longer survival breaks the tie (equal score but a longer stand means the
 * better run), the exact parity is a draw. A peer without a finish loses.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool and builds the seeded spawner.
 */

export type StrikeRemoteState = {
  /** the peer's live score */
  score: number;
  /** the peer's remaining lives */
  lives: number;
};

export type StrikeVerdict = "won" | "lost" | "draw";

/** the death-race verdict: the higher score wins, the longer survival
 * (elapsed at losing the last life) breaks the tie */
export function resolveStrikeVerdict(
  mine: { score: number; elapsedMs: number },
  theirs: { score: number; elapsedMs: number },
): StrikeVerdict {
  if (mine.score !== theirs.score) {
    return mine.score > theirs.score ? "won" : "lost";
  }
  if (mine.elapsedMs !== theirs.elapsedMs) {
    return mine.elapsedMs > theirs.elapsedMs ? "won" : "lost";
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

/** the seeded wave spawner: the same pool + seed build the identical
 * waves on both machines (ships, speeds, bosses — in the same order) */
export function strikeLanSpawner(pool: string[], seed: number): WaveSpawner {
  return createWaveSpawner({ words: pool, rng: createSeededRng(seed) });
}

export const lanStrike: LanPlayable = {
  gameId: "letter-strike",
  route: "/games/letter-strike",
  label: "letter strike",
  icon: "fa-rocket",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "letter-strike",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "letter-strike") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    return typeof lang === "string" && lang.length > 0;
  },
  encodeProgress(state) {
    return {
      score: coerceCount(state["score"], 0),
      lives: coerceCount(state["lives"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const score = record["score"];
    const lives = record["lives"];
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      typeof lives !== "number" ||
      !Number.isFinite(lives) ||
      lives < 0
    ) {
      return undefined;
    }
    const state: StrikeRemoteState = {
      score: Math.floor(score),
      lives: Math.floor(lives),
    };
    return { ...state };
  },
};
