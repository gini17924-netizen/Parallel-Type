import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { createSeededRng } from "../daily-gauntlet/seeded-rng";
import { createTowerWaveSpawner } from "./spawner";

/**
 * Tower Defense's LanPlayable (phase 85, pattern S): both players defend
 * against the SAME seeded waves (the spawner's rng derives from the
 * shared match seed — identical enemies, lanes, speeds and tanks in the
 * identical order; only the typing pace diverges) and the run ends when
 * the tower falls — the death race. There is no horn timer: each side
 * sends its finish when the tower is gone, the verdict resolves when
 * both are in — the HIGHER SCORE wins, the longer survival breaks the
 * tie, the exact parity is a draw. A peer without a finish loses.
 *
 * Pure — the lobby passes the language in settings; the page fetches
 * that language's pool and builds the seeded spawner.
 */

export type TowerRemoteState = {
  /** the peer's live score */
  score: number;
  /** the peer's remaining tower hp */
  towerHp: number;
};

export type TowerVerdict = "won" | "lost" | "draw";

/** the death-race verdict: the higher score wins, the longer survival
 * breaks the tie */
export function resolveTowerVerdict(
  mine: { score: number; elapsedMs: number },
  theirs: { score: number; elapsedMs: number },
): TowerVerdict {
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

/** the seeded wave spawner: the same pool + seed build the identical
 * waves on both machines (words, speeds, lanes, tanks) */
export function towerLanSpawner(
  pool: string[],
  seed: number,
): ReturnType<typeof createTowerWaveSpawner> {
  return createTowerWaveSpawner({
    words: pool,
    rng: createSeededRng(seed),
  });
}

export const lanTowerDefense: LanPlayable = {
  gameId: "tower-defense",
  route: "/games/tower-defense",
  label: "tower defense",
  icon: "fa-chess-rook",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "tower-defense",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "tower-defense") return false;
    if (
      typeof start.seed !== "number" ||
      !Number.isInteger(start.seed) ||
      start.seed <= 0
    ) {
      return false;
    }
    const lang = start.params["lang"];
    return typeof lang === "string" && lang.length > 0;
  },
  encodeProgress(state) {
    return {
      score: coerceCount(state["score"], 0),
      towerHp: coerceCount(state["towerHp"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const score = record["score"];
    const towerHp = record["towerHp"];
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      typeof towerHp !== "number" ||
      !Number.isFinite(towerHp) ||
      towerHp < 0
    ) {
      return undefined;
    }
    const state: TowerRemoteState = {
      score: Math.floor(score),
      towerHp: Math.floor(towerHp),
    };
    return { ...state };
  },
};
