import { describe, expect, it } from "vitest";

import {
  bucketOf,
  bucketSummary,
  heatmapCells,
  MIN_HEATMAP_SAMPLES,
} from "../../src/ts/utils/heatmap";
import { aggregateWeeks, trendsOf } from "../../src/ts/utils/weekly-report";

const DAY = 86_400_000;

describe("phase 108 — the keyboard heatmap (pure criteria)", () => {
  it("the bucket thresholds: weak <70, mid <90, strong >=90", () => {
    expect(bucketOf(55)).toBe("weak");
    expect(bucketOf(70)).toBe("mid");
    expect(bucketOf(89)).toBe("mid");
    expect(bucketOf(90)).toBe("strong");
  });

  it("keys below the sample floor stay unrated (one typo paints nothing)", () => {
    const cells = heatmapCells({
      a: { correct: 0, incorrect: 1 },
      s: { correct: 4, incorrect: 1 },
    });
    expect(cells.some((c) => c.key === "a")).toBe(false);
    expect(cells.some((c) => c.key === "s")).toBe(true);
    expect(MIN_HEATMAP_SAMPLES).toBe(5);
  });

  it("cells sort weakest-first with the rounded accuracy", () => {
    const cells = heatmapCells({
      q: { correct: 95, incorrect: 5 }, //95% strong
      w: { correct: 6, incorrect: 4 }, //60% weak
      e: { correct: 85, incorrect: 15 }, //85% mid
    });
    expect(cells.map((c) => c.key)).toEqual(["w", "e", "q"]);
    expect(cells[0]?.acc).toBe(60);
    expect(cells[0]?.bucket).toBe("weak");
  });

  it("the summary counts the buckets", () => {
    const cells = heatmapCells({
      q: { correct: 95, incorrect: 5 },
      w: { correct: 6, incorrect: 4 },
      e: { correct: 85, incorrect: 15 },
    });
    expect(bucketSummary(cells)).toEqual({ weak: 1, mid: 1, strong: 1 });
  });
});

describe("phase 108 — the weekly report (pure aggregation)", () => {
  it("aggregates rows into monday-start weeks with rounded averages", () => {
    const monday = Date.parse("2026-11-09T12:00:00");
    const tuesday = monday + DAY;
    const nextMonday = monday + 7 * DAY;
    const weeks = aggregateWeeks([
      { timestamp: monday, wpm: 60, acc: 0.9 },
      { timestamp: tuesday, wpm: 80, acc: 0.95 },
      { timestamp: nextMonday, wpm: 100, acc: 0.99 },
    ]);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]?.tests).toBe(2);
    expect(weeks[0]?.avgWpm).toBe(70);
    expect(weeks[0]?.avgAcc).toBe(0.925);
    expect(weeks[1]?.tests).toBe(1);
    expect(weeks[1]?.avgWpm).toBe(100);
  });

  it("garbage rows (bad timestamp or NaN metrics) are skipped", () => {
    const monday = Date.parse("2026-11-09T12:00:00");
    const weeks = aggregateWeeks([
      { timestamp: monday, wpm: 60, acc: 0.9 },
      { timestamp: NaN, wpm: 60, acc: 0.9 },
      { timestamp: -5, wpm: 60, acc: 0.9 },
      { timestamp: monday, wpm: NaN, acc: 0.9 },
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.tests).toBe(1);
  });

  it("the trends compare the latest two weeks with data", () => {
    const w1 = { weekIndex: 1, tests: 2, avgWpm: 60, avgAcc: 0.9 };
    const w2 = { weekIndex: 2, tests: 2, avgWpm: 75, avgAcc: 0.95 };
    expect(trendsOf([w1, w2])).toEqual({ wpmTrend: 15, accTrend: 0.05 });
    expect(trendsOf([w1])).toEqual({ wpmTrend: 0, accTrend: 0 });
  });
});
