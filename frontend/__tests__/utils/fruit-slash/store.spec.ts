import { beforeEach, describe, expect, it } from "vitest";

import {
  FRUIT_SLASH_SCORES_KEY,
  getFruitSlashBestScore,
  getFruitSlashBestSlashed,
  getFruitSlashHistory,
  recordFruitSlashRun,
  sanitizeImportedFruitSlashScores,
  _resetFruitSlashScoresForTests,
} from "../../../src/ts/utils/fruit-slash/store";

function run(overrides: Partial<{ score: number; slashed: number }> = {}): {
  score: number;
  slashed: number;
  bombsTyped: number;
  maxCombo: number;
} {
  return {
    score: overrides.score ?? 700,
    slashed: overrides.slashed ?? 24,
    bombsTyped: 1,
    maxCombo: 9,
  };
}

describe("fruit slash store (idea G10 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetFruitSlashScoresForTests();
  });

  it("records the first run as both bests with history", () => {
    const result = recordFruitSlashRun(run());
    expect(result.isNewScoreRecord).toBe(true);
    expect(result.isNewSlashedRecord).toBe(true);
    expect(getFruitSlashBestScore()).toBe(700);
    expect(getFruitSlashBestSlashed()).toBe(24);
    expect(getFruitSlashHistory()).toHaveLength(1);
    expect(window.localStorage.getItem(FRUIT_SLASH_SCORES_KEY)).not.toBeNull();
  });

  it("keeps bests on a weaker run; history grows newest-first", () => {
    recordFruitSlashRun(run({ score: 1200, slashed: 30 }));
    const weaker = recordFruitSlashRun(run({ score: 400, slashed: 10 }));
    expect(weaker.isNewScoreRecord).toBe(false);
    expect(weaker.isNewSlashedRecord).toBe(false);
    expect(getFruitSlashBestScore()).toBe(1200);
    const history = getFruitSlashHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.slashed).toBe(10);
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordFruitSlashRun(run({ score: 100 + i, slashed: i }));
    }
    const history = getFruitSlashHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.slashed).toBe(11);
    expect(getFruitSlashBestSlashed()).toBe(11);
  });

  it("the reset hook clears storage and cache", () => {
    recordFruitSlashRun(run());
    _resetFruitSlashScoresForTests();
    expect(window.localStorage.getItem(FRUIT_SLASH_SCORES_KEY)).toBeNull();
    expect(getFruitSlashBestScore()).toBe(0);
  });

  it("sanitize drops garbage and trims the history (audit L4 pattern)", () => {
    const sanitized = sanitizeImportedFruitSlashScores({
      bestScore: 900,
      bestSlashed: "x",
      history: [
        { at: 3, score: 20, slashed: 2, bombsTyped: 0, maxCombo: 3 },
        "junk",
      ],
    });
    expect(sanitized.bestScore).toBe(900);
    expect(sanitized.bestSlashed).toBe(0);
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedFruitSlashScores(null)).toEqual({
      bestScore: 0,
      bestSlashed: 0,
      history: [],
    });
  });
});
