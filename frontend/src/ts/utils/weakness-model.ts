import type { KeyStat, LearnState } from "./learn-stats";
import type { KeybrLetterStat } from "./keybr-letter-stats";

/**
 * Unified per-letter weakness model (idea #7) — a PURE computation over the
 * two persisted evidence sources:
 *
 * - drill source: `mtDesktopLearnState.keyStats` (learn/drill accuracy only)
 * - keybr source: `mtKeybrResults:<lang>` histograms (accuracy + latency,
 *   read-only contract — this module never writes them)
 *
 * Design (fixes the seven documented weaknesses of the old pipeline):
 * 1. per-source SMOOTHED accuracy acc_s = (hits + a) / (n + 2a) — a 0/2 char
 *    can no longer outrank a 3/10 char
 * 2. per-source RANK normalization to [0,1] BEFORE merging — 200 keybr
 *    sessions can no longer drown the drill history (equal vote per source)
 * 3. the keybr source contributes a latency term:
 *    slowness = clamp(meanTimeToType / TARGET_KEY_TIME_MS)
 *    weakness_raw = ACCURACY_WEIGHT*(1-acc_s) + SPEED_WEIGHT*slowness
 * 4. per-source minimum-sample gate (replaces the old global total >= 10)
 * 5. display accuracy stays RAW (combined hits / combined n) — the /drills
 *    grid shows real accuracy percentages, ranking uses the score
 *
 * Nothing here touches storage; callers pass the state in (testable headless).
 */

export type WeaknessSource = "drill" | "keybr";

export type WeaknessEvidence = { source: WeaknessSource; n: number };

export type WeaknessEntry = {
  letter: string;
  /** normalized 0..1, higher = weaker — ranking/weighting signal */
  score: number;
  /** raw combined accuracy across the gated sources (display) */
  acc: number;
  /** combined samples across the gated sources */
  total: number;
  /** which gated sources contributed, with their sample counts */
  evidence: WeaknessEvidence[];
};

export type WeaknessMap = Record<string, WeaknessEntry>;

const SMOOTHING_ALPHA = 3;
/** a source only speaks for a letter with at least this many samples */
export const MIN_SAMPLES_PER_SOURCE = 5;
const ACCURACY_WEIGHT = 0.6;
const SPEED_WEIGHT = 0.4;
/** slowness = clamp(meanTimeToType / TARGET_KEY_TIME_MS, 0, 1) */
const TARGET_KEY_TIME_MS = 400;

function smoothedAccuracy(correct: number, n: number): number {
  const a = SMOOTHING_ALPHA;
  return (correct + a) / (n + 2 * a);
}

/** fractional-ranking normalization to [0,1]; ties share the mean rank;
 * a single value maps to 0.5 (no information to be relative to) */
function rankNormalize(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && (order[j + 1]?.value ?? 0) === (order[i]?.value ?? 0)) {
      j++;
    }
    //average 1-based rank of the tie group, normalized
    const meanRank = (i + j) / 2; //0-based mean of i..j
    const normalized = n === 1 ? 0.5 : meanRank / (n - 1);
    for (let k = i; k <= j; k++) {
      const index = order[k]?.index;
      if (index !== undefined) ranks[index] = normalized;
    }
    i = j + 1;
  }
  return ranks;
}

type SourceReading = {
  /** per-letter weakness of this source BEFORE normalization */
  raw: Record<string, number>;
  /** per-letter raw accuracy of this source (display) */
  acc: Record<string, number>;
  /** per-letter sample counts of this source */
  counts: Record<string, number>;
};

function readDrillSource(keyStats: Record<string, KeyStat>): SourceReading {
  const raw: Record<string, number> = {};
  const acc: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const [letter, stat] of Object.entries(keyStats)) {
    const n = stat.correct + stat.incorrect;
    if (n < MIN_SAMPLES_PER_SOURCE) continue; //per-source gate
    counts[letter] = n;
    acc[letter] = stat.correct / n;
    raw[letter] = 1 - smoothedAccuracy(stat.correct, n);
  }
  return { raw, acc, counts };
}

function readKeybrSource(
  keybrStats: Record<string, KeybrLetterStat>,
): SourceReading {
  const raw: Record<string, number> = {};
  const acc: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const [letter, stat] of Object.entries(keybrStats)) {
    const n = stat.correct + stat.incorrect;
    if (n < MIN_SAMPLES_PER_SOURCE) continue; //per-source gate
    counts[letter] = n;
    const accS = smoothedAccuracy(stat.correct, n);
    const meanTime =
      n > 0 && stat.totalTimeToType > 0 ? stat.totalTimeToType / n : 0;
    const slowness = Math.min(1, Math.max(0, meanTime / TARGET_KEY_TIME_MS));
    acc[letter] = stat.correct / n;
    raw[letter] = ACCURACY_WEIGHT * (1 - accS) + SPEED_WEIGHT * slowness;
  }
  return { raw, acc, counts };
}

/** normalizes one source's raw weakness values and returns them keyed by
 * letter */
function normalizedRaws(source: SourceReading): Record<string, number> {
  const letters = Object.keys(source.raw);
  const values = letters.map((letter) => source.raw[letter] ?? 0);
  const ranks = rankNormalize(values);
  const out: Record<string, number> = {};
  letters.forEach((letter, index) => {
    const rank = ranks[index];
    if (rank !== undefined) out[letter] = rank;
  });
  return out;
}

/**
 * Builds the unified weakness map from the two evidence sources. A letter
 * enters the map when at least one gated source speaks for it; its score is
 * the equal-vote mean of the sources' rank-normalized weaknesses.
 */
export function buildWeaknessMap(
  learnState: LearnState,
  keybrStats: Record<string, KeybrLetterStat>,
): WeaknessMap {
  const allSources: { source: WeaknessSource; reading: SourceReading }[] = [
    { source: "drill", reading: readDrillSource(learnState.keyStats) },
    { source: "keybr", reading: readKeybrSource(keybrStats) },
  ];
  const sources = allSources.filter(
    ({ reading }) => Object.keys(reading.raw).length > 0,
  );

  const normalized = sources.map(({ source, reading }) => ({
    source,
    reading,
    norm: normalizedRaws(reading),
  }));

  const map: WeaknessMap = {};
  for (const { source, reading, norm } of normalized) {
    for (const letter of Object.keys(norm)) {
      const score = norm[letter] ?? 0;
      const n = reading.counts[letter] ?? 0;
      const entry = map[letter] ?? {
        letter,
        score: 0,
        acc: 0,
        total: 0,
        evidence: [],
      };
      const totalAfter = entry.total + n;
      //raw combined accuracy across sources: total hits / total samples
      const accBefore = entry.acc * entry.total;
      const accSource = reading.acc[letter] ?? 0;
      entry.acc =
        totalAfter > 0 ? (accBefore + accSource * n) / totalAfter : accSource;
      entry.total = totalAfter;
      entry.score =
        (entry.score * entry.evidence.length + score) /
        (entry.evidence.length + 1); //equal-vote mean over sources
      entry.evidence.push({ source, n });
      map[letter] = entry;
    }
  }
  return map;
}
