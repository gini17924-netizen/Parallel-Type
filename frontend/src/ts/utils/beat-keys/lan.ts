import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { createSeededRng } from "../daily-gauntlet/seeded-rng";
import { BALANCE } from "./balance";
import { generateChart, type BeatChart } from "./chart";

/**
 * Beat Keys' LanPlayable (online wave, phase 41 — pattern S #12): both
 * players play the SAME seeded chart (the lane patterns derive from the
 * shared seed at the shared difficulty's BPM — identical notes in the
 * identical order) and the chart's last note ends both runs at the same
 * musical moment (unjudged notes auto-miss — the finish time is the chart
 * itself, so the SCORE is the discriminator). The verdict resolves when
 * both are in: the HIGHER SCORE wins, the exact parity is a draw. A peer
 * without a finish loses.
 *
 * Pure — the lobby passes the language + difficulty in settings; the page
 * (phase B) builds the seeded chart on its own audio clock.
 */

export type BeatRemoteState = {
  /** the peer's live score */
  score: number;
  /** the peer's live acc (0..100) */
  acc: number;
  /** the peer's best streak so far */
  maxCombo: number;
};

export type BeatVerdict = "won" | "lost" | "draw";

/** the score verdict: the higher score wins, the exact parity is a draw
 * (the chart itself is the shared clock — no time tiebreak) */
export function resolveBeatVerdict(
  mine: { score: number },
  theirs: { score: number },
): BeatVerdict {
  if (mine.score !== theirs.score) {
    return mine.score > theirs.score ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_LANGUAGE = "english";
const DEFAULT_DIFFICULTY = "normal";

function coerceCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
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

/** the seeded chart: the same seed + difficulty build the identical
 * notes on both machines (the BPM is fixed per difficulty, doc §۰.۳) */
export function beatLanChart(seed: number, difficulty: string): BeatChart {
  const bpm =
    difficulty === "easy"
      ? BALANCE.bpmByDifficulty.easy
      : difficulty === "hard"
        ? BALANCE.bpmByDifficulty.hard
        : BALANCE.bpmByDifficulty.normal;
  return generateChart({ bpm, rng: createSeededRng(seed) });
}

export const lanBeatKeys: LanPlayable = {
  gameId: "beat-keys",
  route: "/games/beat-keys",
  label: "beat keys",
  icon: "fa-drum",
  buildStart(settings) {
    const lang = settings["lang"];
    const difficulty = settings["difficulty"];
    const start: LanStartPayload = {
      gameId: "beat-keys",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        difficulty:
          difficulty === "easy" || difficulty === "hard"
            ? difficulty
            : DEFAULT_DIFFICULTY,
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "beat-keys") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    const difficulty = start.params["difficulty"];
    return (
      difficulty === "easy" || difficulty === "normal" || difficulty === "hard"
    );
  },
  encodeProgress(state) {
    return {
      score: coerceCount(state["score"], 0),
      acc: coerceCount(state["acc"], 0),
      maxCombo: coerceCount(state["maxCombo"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const score = record["score"];
    const acc = record["acc"];
    const maxCombo = record["maxCombo"];
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      typeof acc !== "number" ||
      !Number.isFinite(acc) ||
      acc < 0 ||
      typeof maxCombo !== "number" ||
      !Number.isFinite(maxCombo) ||
      maxCombo < 0
    ) {
      return undefined;
    }
    const state: BeatRemoteState = {
      score: Math.floor(score),
      acc: Math.floor(acc),
      maxCombo: Math.floor(maxCombo),
    };
    return { ...state };
  },
};
