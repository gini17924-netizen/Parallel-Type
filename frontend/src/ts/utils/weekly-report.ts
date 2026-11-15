import { loadLocalResults } from "./local-persistence";
import { weekIndexFromTimestamp } from "./streaks/engine";

/**
 * phase 108: the weekly report — the local results aggregated WEEK BY WEEK
 * (tests count, average wpm, average accuracy) with the trend against the
 * previous week. the aggregation is PURE (a list of (timestamp, wpm, acc)
 * rows in, weeks out) so the gate is unit-testable without a backend; the
 * builder just maps the real local results into rows.
 */

export type WeekRow = {
  /** the absolute monday-start week index (the streaks engine's) */
  weekIndex: number;
  tests: number;
  avgWpm: number;
  avgAcc: number;
};

export type WeeklyReport = {
  weeks: WeekRow[];
  /** the trend of the LATEST week with data vs the one before it */
  wpmTrend: number;
  accTrend: number;
};

type ResultRow = { timestamp: number; wpm: number; acc: number };

/** PURE: aggregate rows into week buckets (sorted oldest → newest) */
export function aggregateWeeks(rows: ResultRow[]): WeekRow[] {
  const buckets = new Map<
    number,
    { tests: number; wpmSum: number; accSum: number }
  >();
  for (const row of rows) {
    if (!Number.isFinite(row.timestamp) || row.timestamp <= 0) continue;
    if (!Number.isFinite(row.wpm) || !Number.isFinite(row.acc)) continue;
    const week = weekIndexFromTimestamp(row.timestamp);
    const bucket = buckets.get(week) ?? { tests: 0, wpmSum: 0, accSum: 0 };
    bucket.tests++;
    bucket.wpmSum += row.wpm;
    bucket.accSum += row.acc;
    buckets.set(week, bucket);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekIndex, bucket]) => ({
      weekIndex,
      tests: bucket.tests,
      avgWpm: Math.round((bucket.wpmSum / bucket.tests) * 10) / 10,
      avgAcc: Math.round((bucket.accSum / bucket.tests) * 1000) / 1000,
    }));
}

/** the trends of the latest two weeks with data (0 when either is missing) */
export function trendsOf(weeks: WeekRow[]): {
  wpmTrend: number;
  accTrend: number;
} {
  if (weeks.length < 2) return { wpmTrend: 0, accTrend: 0 };
  const last = weeks[weeks.length - 1] as WeekRow;
  const prev = weeks[weeks.length - 2] as WeekRow;
  return {
    wpmTrend: Math.round((last.avgWpm - prev.avgWpm) * 10) / 10,
    accTrend: Math.round((last.avgAcc - prev.avgAcc) * 1000) / 1000,
  };
}

/** builds the report from the REAL local results */
export async function buildWeeklyReport(): Promise<WeeklyReport> {
  const results = await loadLocalResults();
  const rows = results
    .filter(
      (result) =>
        Number.isFinite(result.timestamp) &&
        result.timestamp > 0 &&
        Number.isFinite(result.wpm) &&
        Number.isFinite(result.acc),
    )
    .map((result) => ({
      timestamp: result.timestamp,
      wpm: result.wpm,
      acc: result.acc,
    }));
  const weeks = aggregateWeeks(rows);
  return { weeks, ...trendsOf(weeks) };
}
