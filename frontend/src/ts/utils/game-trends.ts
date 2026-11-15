/**
 * phase 114: the per-game score trends — every mini-game's recent-run
 * history (the stores keep the last 10 runs with timestamps) turned into
 * a uniform spark series. PURE: the aggregation takes plain {at, value}
 * rows; the thin `gameTrendSeries()` builder just reads the real stores
 * and maps each game's own value field (score, or distance for the
 * runner). the UI renders the bars; the tested core is the aggregation.
 */

import { getBeatKeysHistory } from "./beat-keys/store";
import { getClimberHistory, getRunnerHistory } from "./climber/store";
import { getCraneHistory } from "./crane/store";
import { getFirefightHistory } from "./firefight/store";
import { getFruitSlashHistory } from "./fruit-slash/store";
import { getLaneDefenseHistory } from "./lane-defense/store";
import { getStackAttackHistory } from "./stack-attack/store";
import { getWordBlastHistory } from "./word-blast/store";

export type TrendPoint = { at: number; value: number };

export type GameTrend = {
  gameId: string;
  label: string;
  points: TrendPoint[];
  best: number;
  latest: number;
  /** the latest minus the previous point (0 for a single point) */
  step: number;
};

/** PURE: normalize a raw history into sorted oldest→newest points, last
 * `limit` kept, zero/negative timestamps dropped */
export function trendPoints(
  history: { at: number; value: number }[],
  limit = 10,
): TrendPoint[] {
  return history
    .filter(
      (row) =>
        Number.isFinite(row.at) && row.at > 0 && Number.isFinite(row.value),
    )
    .sort((a, b) => a.at - b.at)
    .slice(-limit)
    .map((row) => ({ at: row.at, value: row.value }));
}

/** PURE: the per-point deltas summarized as up/down/flat */
export function directionOf(points: TrendPoint[]): "up" | "down" | "flat" {
  if (points.length < 2) return "flat";
  const last = points[points.length - 1]?.value ?? 0;
  const prev = points[points.length - 2]?.value ?? 0;
  if (last > prev) return "up";
  if (last < prev) return "down";
  return "flat";
}

function summarize(
  gameId: string,
  label: string,
  history: { at: number; value: number }[],
): GameTrend {
  const points = trendPoints(history);
  const best = Math.max(0, ...points.map((p) => p.value));
  const latest =
    points.length > 0 ? (points[points.length - 1] as TrendPoint).value : 0;
  const step =
    points.length >= 2
      ? (points[points.length - 1] as TrendPoint).value -
        (points[points.length - 2] as TrendPoint).value
      : 0;
  return { gameId, label, points, best, latest, step };
}

/** the real trend registry — the games that keep timestamped histories
 * (the stores that only keep bests — ghost, deck-runner summaries — have
 * no time series and stay out) */
export function gameTrendSeries(): GameTrend[] {
  return [
    summarize(
      "crane",
      "crane stack",
      getCraneHistory().map((r) => ({ at: r.at, value: r.score })),
    ),
    summarize(
      "firefight",
      "firefight",
      getFirefightHistory().map((r) => ({ at: r.at, value: r.score })),
    ),
    summarize(
      "lane-defense",
      "lane defense",
      getLaneDefenseHistory().map((r) => ({ at: r.at, value: r.score })),
    ),
    summarize(
      "fruit-slash",
      "fruit slash",
      getFruitSlashHistory().map((r) => ({ at: r.at, value: r.score })),
    ),
    summarize(
      "stack-attack",
      "stack attack",
      getStackAttackHistory().map((r) => ({ at: r.at, value: r.score })),
    ),
    summarize(
      "beat-keys",
      "beat keys",
      getBeatKeysHistory().map((r) => ({ at: r.at, value: r.score })),
    ),
    summarize(
      "climber",
      "sky climber",
      getClimberHistory().map((r) => ({ at: r.at, value: r.score })),
    ),
    summarize(
      "runner",
      "endless runner",
      getRunnerHistory().map((r) => ({ at: r.at, value: r.distanceM })),
    ),
    summarize(
      "word-blast",
      "word blast",
      getWordBlastHistory(50).map((r) => ({ at: r.at, value: r.score })),
    ),
  ];
}
