import { getLearnState, type KeyStat } from "./learn-stats";

/**
 * phase 108: the keyboard heatmap — the per-key accuracy buckets computed
 * PURELY from the learn-stats keyStats (the drill-graded correct/incorrect
 * counts). the UI renders the three buckets; the criteria here are the
 * tested core. a key with fewer samples than MIN_SAMPLES stays unrated so
 * a single typo cannot paint a key red.
 */

export const MIN_HEATMAP_SAMPLES = 5;

export type HeatBucket = "weak" | "mid" | "strong";

export type HeatCell = {
  key: string;
  acc: number;
  samples: number;
  bucket: HeatBucket;
};

export function bucketOf(acc: number): HeatBucket {
  if (acc < 70) return "weak";
  if (acc < 90) return "mid";
  return "strong";
}

/** PURE: every graded key with its accuracy and bucket; unrated keys
 * (below the sample floor) are omitted */
export function heatmapCells(keyStats: Record<string, KeyStat>): HeatCell[] {
  const cells: HeatCell[] = [];
  for (const [key, stat] of Object.entries(keyStats)) {
    const samples = stat.correct + stat.incorrect;
    if (samples < MIN_HEATMAP_SAMPLES) continue;
    const acc = Math.round((stat.correct / samples) * 100);
    cells.push({ key, acc, samples, bucket: bucketOf(acc) });
  }
  return cells.sort((a, b) => a.acc - b.acc);
}

/** reads the live learn-state (the drills page's entry) */
export function heatmapFromLearnState(): HeatCell[] {
  return heatmapCells(getLearnState().keyStats);
}

/** the bucket counts for the summary line */
export function bucketSummary(cells: HeatCell[]): {
  weak: number;
  mid: number;
  strong: number;
} {
  const summary = { weak: 0, mid: 0, strong: 0 };
  for (const cell of cells) summary[cell.bucket]++;
  return summary;
}
