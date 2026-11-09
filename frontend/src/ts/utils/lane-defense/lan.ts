import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { createSeededRng } from "../daily-gauntlet/seeded-rng";
import { createWaveSpawner, type WaveSpawner } from "./spawner";

/**
 * Lane Defense's LanPlayable (online wave, phase 33 — pattern S #8): both
 * players defend against the SAME seeded waves (the spawner's rng derives
 * from the shared seed — identical enemies, lanes, speeds and tanks in the
 * identical order; only the typing pace diverges) and the run ends when
 * the wall falls — the death race. There is no horn timer: each side
 * sends its finish when the wall is gone, the verdict resolves when both
 * are in — the HIGHER SCORE wins (score = Σ word length x 10 x the combo
 * tier / tank mult over the shared waves), the longer survival breaks the
 * tie (equal score but a longer stand means the better run), the exact
 * parity is a draw. A peer without a finish loses.
 *
 * The educational zone letters do NOT travel: unlocked learn-groups vary
 * per machine, so the LAN waves always come from the full pool.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool and builds the seeded spawner.
 */

export type LaneRemoteState = {
  /** the peer's live score */
  score: number;
  /** the peer's remaining wall hp */
  wallHp: number;
};

export type LaneVerdict = "won" | "lost" | "draw";

/** the death-race verdict: the higher score wins, the longer survival
 * (elapsed at the wall falling) breaks the tie */
export function resolveLaneVerdict(
  mine: { score: number; elapsedMs: number },
  theirs: { score: number; elapsedMs: number },
): LaneVerdict {
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
 * waves on both machines (words, speeds, lanes, tanks — no zone letters:
 * the learn-groups vary per machine) */
export function laneLanSpawner(pool: string[], seed: number): WaveSpawner {
  return createWaveSpawner({ words: pool, rng: createSeededRng(seed) });
}

export const lanLaneDefense: LanPlayable = {
  gameId: "lane-defense",
  route: "/games/lane-defense",
  label: "lane defense",
  icon: "fa-shield-alt",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "lane-defense",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "lane-defense") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    return typeof lang === "string" && lang.length > 0;
  },
  encodeProgress(state) {
    return {
      score: coerceCount(state["score"], 0),
      wallHp: coerceCount(state["wallHp"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const score = record["score"];
    const wallHp = record["wallHp"];
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      typeof wallHp !== "number" ||
      !Number.isFinite(wallHp) ||
      wallHp < 0
    ) {
      return undefined;
    }
    const state: LaneRemoteState = {
      score: Math.floor(score),
      wallHp: Math.floor(wallHp),
    };
    return { ...state };
  },
};
