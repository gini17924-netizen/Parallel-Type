import { describe, it, expect } from "vitest";

import {
  computeWrappedStats,
  type WrappedInput,
  type WrappedStats,
} from "../../src/ts/utils/wrapped-stats";

//fixed "now": Nov 4 2026 local noon — the 365-day window covers it all
const NOW = new Date(2026, 10, 4, 12, 0, 0).getTime();

function ts(month: number, day: number, hour: number): number {
  return new Date(2026, month - 1, day, hour, 0, 0).getTime();
}

function makeResult(overrides: Partial<WrappedInput> = {}): WrappedInput {
  return {
    wpm: 60,
    acc: 95,
    consistency: 80,
    restartCount: 0,
    testDuration: 30,
    afkDuration: 0,
    incompleteTestSeconds: 0,
    charStats: [100, 0, 0, 0],
    mode: "time",
    timestamp: ts(10, 20, 14),
    ...overrides,
  };
}

/** the spec works with plain inputs; cast keeps the store type away */
function compute(inputs: WrappedInput[], now = NOW): WrappedStats {
  return computeWrappedStats(inputs as never, now);
}

describe("computeWrappedStats", () => {
  it("returns zeros for an empty window", () => {
    const stats = compute([]);
    expect(stats.hook.totalTests).toBe(0);
    expect(stats.personas).toEqual([]);
  });

  it("excludes results older than the 365-day window", () => {
    const old = makeResult({ timestamp: NOW - 400 * 86_400_000, wpm: 200 });
    const stats = compute([old]);
    expect(stats.hook.totalTests).toBe(0);
  });

  it("computes the hook: words from wpm × duration, gatsby share", () => {
    const stats = compute([
      makeResult({ wpm: 60, testDuration: 60 }), //60 wpm × 1 min = 60 words
      makeResult({ wpm: 60, testDuration: 60 }),
    ]);
    expect(stats.hook.totalTests).toBe(2);
    expect(stats.hook.totalWords).toBe(120);
    expect(stats.hook.gatsbyPct).toBe(0.3); //round1
  });

  it("finds the longest streak of consecutive active days", () => {
    const stats = compute([
      makeResult({ timestamp: ts(9, 1, 10) }),
      makeResult({ timestamp: ts(9, 2, 10) }),
      makeResult({ timestamp: ts(9, 3, 10) }),
      makeResult({ timestamp: ts(9, 10, 10) }), //gap — new run of 1
    ]);
    expect(stats.yearInNumbers.longestDayStreak).toBe(3);
    expect(stats.yearInNumbers.activeDays).toBe(4);
  });

  it("counts running personal bests and the all-time peak", () => {
    const stats = compute([
      makeResult({ wpm: 50, timestamp: ts(9, 1, 10) }),
      makeResult({ wpm: 70, timestamp: ts(9, 2, 10) }), //pb
      makeResult({ wpm: 65, timestamp: ts(9, 3, 10) }), //no pb
      makeResult({ wpm: 90, timestamp: ts(9, 4, 10) }), //pb
      makeResult({ acc: 100, timestamp: ts(9, 5, 10) }),
    ]);
    expect(stats.peak.bestWpm).toBe(90);
    expect(stats.peak.pbsHit).toBe(3); //50 then 70 then 90
    expect(stats.peak.perfectAccCount).toBe(1);
    expect(stats.peak.thresholds.find((it) => it.wpm === 60)?.count).toBe(4);
  });

  it("classifies restart addiction and favorite mode", () => {
    const stats = compute([
      makeResult({ restartCount: 0, mode: "time" }),
      makeResult({ restartCount: 1, mode: "words" }),
      makeResult({ restartCount: 1, mode: "words" }),
      makeResult({ restartCount: 2, mode: "words" }),
    ]);
    expect(stats.quirks.avgRestarts).toBe(1);
    expect(stats.quirks.maxRestarts).toBe(2);
    expect(stats.quirks.firstTryPct).toBe(25);
    expect(stats.quirks.favoriteMode).toBe("words");
    expect(stats.quirks.restartLevel).toBe("moderate");
  });

  it("breaks errors down by type and computes the clutch delta", () => {
    const slow = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
      makeResult({
        wpm: 30 + i,
        acc: 90,
        charStats: [80, 10, 5, 5],
        timestamp: ts(9, i, 12),
      }),
    );
    const fast = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
      makeResult({
        wpm: 100 + i,
        acc: 99,
        charStats: [100, 1, 0, 0],
        timestamp: ts(9, 20 + i, 12),
      }),
    );
    const stats = compute([...slow, ...fast]);
    const totalErrors = 9 * 20 + 9 * 1;
    expect(stats.accuracy.totalErrors).toBe(totalErrors);
    expect(stats.accuracy.wrongKeyPct).toBeCloseTo((99 / totalErrors) * 100, 0);
    //fast tests (99%) vs slow tests (90%): clutch delta positive
    expect(stats.accuracy.clutchDelta).toBeGreaterThan(5);
  });

  it("buckets months and finds the biggest jump", () => {
    const august = [1, 2, 3].map((i) =>
      makeResult({ wpm: 50, timestamp: ts(8, 10 + i, 12) }),
    );
    const septLow = [1, 2, 3].map((i) =>
      makeResult({ wpm: 55, timestamp: ts(9, 10 + i, 12) }),
    );
    const septHigh = [1, 2, 3].map((i) =>
      makeResult({ wpm: 75, timestamp: ts(9, 20 + i, 12) }),
    );
    const october = [1, 2, 3].map((i) =>
      makeResult({ wpm: 85, timestamp: ts(10, 10 + i, 12) }),
    );
    const stats = compute([...august, ...septLow, ...septHigh, ...october]);
    expect(stats.journey.months.map((month) => month.month)).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(stats.journey.bestMonth).toBe("2026-10");
    expect(stats.journey.biggestJump?.month).toBe("2026-10");
    expect(stats.journey.improvement).toBeCloseTo(85 - 50, 1);
  });

  it("groups sessions on a 30-minute gap and measures warmup", () => {
    //session 1: cold 40 wpm, then 3 warmed-up tests at 80
    //session 2 (next day): one cold test at 50
    const stats = compute([
      makeResult({ wpm: 40, timestamp: ts(10, 1, 10) }),
      makeResult({ wpm: 80, timestamp: ts(10, 1, 10) + 5 * 60_000 }),
      makeResult({ wpm: 80, timestamp: ts(10, 1, 10) + 10 * 60_000 }),
      makeResult({ wpm: 80, timestamp: ts(10, 1, 10) + 15 * 60_000 }),
      makeResult({ wpm: 50, timestamp: ts(10, 2, 10) }),
    ]);
    expect(stats.warmup.sessions).toBe(2);
    expect(stats.warmup.coldStartWpm).toBeCloseTo((40 + 50) / 2, 1);
    expect(stats.warmup.warmedUpWpm).toBe(80);
    expect(stats.warmup.longestSession).toBe(4);
  });

  it("classifies night owl when late-night tests dominate", () => {
    const late = Array.from({ length: 10 }, (_, i) =>
      makeResult({ timestamp: ts(10, 1 + i, 23) }),
    );
    const morning = Array.from({ length: 3 }, (_, i) =>
      makeResult({ timestamp: ts(10, 1 + i, 7) }),
    );
    const stats = compute([...late, ...morning]);
    expect(stats.timing.timePreference).toBe("night owl");
  });

  it("assigns unique persona labels and flags the user's dominant one", () => {
    const slow = Array.from({ length: 6 }, (_, i) =>
      makeResult({
        wpm: 30,
        acc: 70,
        consistency: 30,
        timestamp: ts(9, 1 + i, 12),
      }),
    );
    const fast = Array.from({ length: 6 }, (_, i) =>
      makeResult({
        wpm: 120,
        acc: 99,
        consistency: 90,
        timestamp: ts(9, 10 + i, 12),
      }),
    );
    const mid = Array.from({ length: 6 }, (_, i) =>
      makeResult({
        wpm: 70,
        acc: 90,
        consistency: 60,
        timestamp: ts(9, 20 + i, 12),
      }),
    );
    const stats = compute([...slow, ...fast, ...mid]);
    const labels = stats.personas.map((persona) => persona.label);
    expect(new Set(labels).size).toBe(labels.length); //unique
    expect(stats.personas.some((persona) => persona.isUser === true)).toBe(
      true,
    );
    expect(
      stats.personas.reduce((sum, persona) => sum + persona.share, 0),
    ).toBeCloseTo(100, 0);
  });
});
