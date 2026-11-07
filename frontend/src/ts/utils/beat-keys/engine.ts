import { BALANCE } from "./balance";
import type { BeatChart } from "./chart";

/**
 * Beat Keys engine (idea G21, phase 1): the deterministic rhythm judge.
 * The clock is INJECTED in ms (the page passes
 * `() => audioCtx.currentTime * 1000` — the doc §۱ rule that the audio
 * clock, not performance.now, drives a rhythm game). The calibration
 * offset shifts the judged timeline: positive = the user taps late.
 *
 * judge: the nearest unjudged same-key note within the 300ms window →
 * Perfect (±80) / Good (±160) / Poor (±300); a tap with no note in the
 * window is a no-op (doc §۰.۷ — no penalty outside the window). Notes
 * that expire past the window auto-miss. Rank S/A/B/C from acc and
 * misses (doc §۰.۵). PURE.
 */

export type BeatGrade = "perfect" | "good" | "poor" | "miss";

export type BeatRank = "S" | "A" | "B" | "C";

export type BeatKeysResult = {
  score: number;
  acc: number;
  rank: BeatRank;
  maxCombo: number;
  misses: number;
};

export type BeatKeysState = {
  phase: "running" | "done";
  score: number;
  combo: number;
  maxCombo: number;
  /** 0..100, score-normalized over the judged notes */
  acc: number;
  grades: Record<BeatGrade, number>;
  judgedCount: number;
  totalCount: number;
  lastGrade: BeatGrade | undefined;
  /** the lane of the last judged note (the page's grade popup) */
  lastLane: number | undefined;
  rank: BeatRank | undefined;
  result: BeatKeysResult | undefined;
};

export type VisibleBeatNote = {
  lane: number;
  key: string;
  tMs: number;
  /** judged-timeline ms until the hit (negative = already past) */
  timeUntilHitMs: number;
};

type InternalNote = BeatChart["notes"][number] & {
  grade: BeatGrade | undefined;
};

const GRADE_SCORE: Record<Exclude<BeatGrade, "miss">, number> = {
  perfect: BALANCE.perfectScore,
  good: BALANCE.goodScore,
  poor: BALANCE.poorScore,
};

export type BeatKeysEngine = {
  state(): BeatKeysState;
  /** a key tap against the chart; returns the fresh state */
  judge(key: string): BeatKeysState;
  /** the unjudged notes worth rendering now (doc §۵: 2-3s visible) */
  visibleNotes(leadMs?: number): VisibleBeatNote[];
};

export function createBeatKeysEngine(options: {
  chart: BeatChart;
  /** the deterministic clock in ms */
  now: () => number;
  /** the calibration offset ms (positive = the user taps late) */
  offsetMs?: number;
}): BeatKeysEngine {
  const notes: InternalNote[] = options.chart.notes
    .slice()
    .sort((a, b) => a.tMs - b.tMs)
    .map((note) => ({ ...note, grade: undefined }));
  let combo = 0;
  let maxCombo = 0;
  let score = 0;
  let lastGrade: BeatGrade | undefined;
  let lastLane: number | undefined;
  const grades: Record<BeatGrade, number> = {
    perfect: 0,
    good: 0,
    poor: 0,
    miss: 0,
  };

  const judgedMs = (): number => options.now() - (options.offsetMs ?? 0);

  function judgedCount(): number {
    return grades.perfect + grades.good + grades.poor + grades.miss;
  }

  function computeAcc(): number {
    const total = judgedCount();
    if (total === 0) return 100;
    const weighted =
      grades.perfect * BALANCE.perfectScore +
      grades.good * BALANCE.goodScore +
      grades.poor * BALANCE.poorScore;
    return (weighted / (BALANCE.perfectScore * total)) * 100;
  }

  function computeRank(): BeatRank {
    const acc = computeAcc();
    if (acc >= BALANCE.rankSAcc && grades.miss === 0) return "S";
    if (acc >= BALANCE.rankAAcc) return "A";
    if (acc >= BALANCE.rankBAcc) return "B";
    return "C";
  }

  /** notes past their window (on the judged timeline) auto-miss */
  function sweepMisses(): void {
    const t = judgedMs();
    for (const note of notes) {
      if (note.grade !== undefined) continue;
      if (t - note.tMs > BALANCE.windowPoorMs) {
        note.grade = "miss";
        grades.miss += 1;
        combo = 0;
      } else {
        break; //sorted by tMs — the first live note ends the sweep
      }
    }
  }

  function snapshot(): BeatKeysState {
    sweepMisses();
    const total = notes.length;
    const finished = judgedCount() >= total && total > 0;
    const acc = computeAcc();
    const result: BeatKeysResult | undefined = finished
      ? {
          score,
          acc,
          rank: computeRank(),
          maxCombo,
          misses: grades.miss,
        }
      : undefined;
    return {
      phase: finished ? "done" : "running",
      score,
      combo,
      maxCombo,
      acc,
      grades: { ...grades },
      judgedCount: judgedCount(),
      totalCount: total,
      lastGrade,
      lastLane,
      rank: finished ? computeRank() : undefined,
      result,
    };
  }

  function judge(key: string): BeatKeysState {
    if (judgedCount() >= notes.length && notes.length > 0) return snapshot();
    sweepMisses();
    const t = judgedMs();
    const ch = key.toLowerCase();
    let best: InternalNote | undefined;
    let bestAbs = Number.POSITIVE_INFINITY;
    for (const note of notes) {
      if (note.grade !== undefined) continue;
      if (note.key !== ch) continue;
      const dt = t - note.tMs;
      if (dt < -BALANCE.windowPoorMs) break; //sorted: the rest are farther future
      if (Math.abs(dt) > BALANCE.windowPoorMs) continue;
      if (Math.abs(dt) < bestAbs) {
        bestAbs = Math.abs(dt);
        best = note;
      }
    }
    if (best === undefined) return snapshot(); //no note in the window = no-op
    const grade: BeatGrade =
      bestAbs <= BALANCE.windowPerfectMs
        ? "perfect"
        : bestAbs <= BALANCE.windowGoodMs
          ? "good"
          : "poor";
    best.grade = grade;
    grades[grade] += 1;
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    score += GRADE_SCORE[grade];
    lastGrade = grade;
    lastLane = best.lane;
    return snapshot();
  }

  function visibleNotes(leadMs = BALANCE.visibleLeadMs): VisibleBeatNote[] {
    sweepMisses();
    const t = judgedMs();
    const visible: VisibleBeatNote[] = [];
    for (const note of notes) {
      if (note.grade !== undefined) continue;
      const until = note.tMs - t;
      if (until > leadMs) break; //sorted — everything later is farther out
      if (until > -BALANCE.windowPoorMs) {
        visible.push({
          lane: note.lane,
          key: note.key,
          tMs: note.tMs,
          timeUntilHitMs: until,
        });
      }
    }
    return visible;
  }

  return {
    state: () => snapshot(),
    judge,
    visibleNotes,
  };
}
