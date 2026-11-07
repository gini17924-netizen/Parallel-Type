import { beforeEach, describe, expect, it } from "vitest";

import {
  CRANE_SCORES_KEY,
  getCraneBestHeight,
  getCraneBestScore,
  getCraneHistory,
  recordCraneRun,
  sanitizeImportedCraneScores,
  _resetCraneScoresForTests,
} from "../../../src/ts/utils/crane/store";

function run(overrides: Partial<{ score: number; height: number }> = {}): {
  score: number;
  height: number;
  perfectCount: number;
  misses: number;
} {
  return {
    score: overrides.score ?? 1200,
    height: overrides.height ?? 14,
    perfectCount: 6,
    misses: 1,
  };
}

describe("crane store (idea G17 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetCraneScoresForTests();
  });

  it("records the first run as the best with history", () => {
    const result = recordCraneRun(run());
    expect(result.isNewScoreRecord).toBe(true);
    expect(getCraneBestScore()).toBe(1200);
    expect(getCraneBestHeight()).toBe(14);
    expect(getCraneHistory()).toHaveLength(1);
    expect(window.localStorage.getItem(CRANE_SCORES_KEY)).not.toBeNull();
  });

  it("keeps the best on a weaker run; history grows newest-first", () => {
    recordCraneRun(run({ score: 1500, height: 18 }));
    const weaker = recordCraneRun(run({ score: 400, height: 5 }));
    expect(weaker.isNewScoreRecord).toBe(false);
    expect(getCraneBestScore()).toBe(1500);
    expect(getCraneHistory()[0]?.height).toBe(5);
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordCraneRun(run({ score: 100 + i, height: i }));
    }
    const history = getCraneHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.height).toBe(11);
    expect(getCraneBestScore()).toBe(111);
  });

  it("the reset hook clears storage and cache", () => {
    recordCraneRun(run());
    _resetCraneScoresForTests();
    expect(window.localStorage.getItem(CRANE_SCORES_KEY)).toBeNull();
    expect(getCraneBestScore()).toBe(0);
  });

  it("sanitize drops garbage and trims the history (audit L4 pattern)", () => {
    const sanitized = sanitizeImportedCraneScores({
      bestScore: 2000,
      bestHeight: "tall",
      perfectCount: 8,
      history: [
        { at: 10, score: 80, height: 6, perfectCount: 2, misses: 0 },
        { junk: true },
      ],
    });
    expect(sanitized.bestScore).toBe(2000);
    expect(sanitized.bestHeight).toBe(0);
    expect(sanitized.perfectCount).toBe(8);
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedCraneScores(null)).toEqual({
      bestScore: 0,
      bestHeight: 0,
      perfectCount: 0,
      history: [],
    });
  });
});
