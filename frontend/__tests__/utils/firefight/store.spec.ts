import { beforeEach, describe, expect, it } from "vitest";

import {
  FIREFIGHT_SCORES_KEY,
  getFirefightBestScore,
  getFirefightHistory,
  getFirefightWins,
  recordFirefightRun,
  sanitizeImportedFirefightScores,
  _resetFirefightScoresForTests,
} from "../../../src/ts/utils/firefight/store";

function run(overrides: Partial<{ score: number; won: boolean }> = {}): {
  score: number;
  won: boolean;
  ashes: number;
  extinguished: number;
} {
  return {
    score: overrides.score ?? 900,
    won: overrides.won ?? true,
    ashes: 3,
    extinguished: 22,
  };
}

describe("firefight store (idea G16 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetFirefightScoresForTests();
  });

  it("records the first run as the best with the win counter", () => {
    const result = recordFirefightRun(run());
    expect(result.isNewScoreRecord).toBe(true);
    expect(getFirefightBestScore()).toBe(900);
    expect(getFirefightWins()).toBe(1);
    expect(getFirefightHistory()).toHaveLength(1);
    expect(window.localStorage.getItem(FIREFIGHT_SCORES_KEY)).not.toBeNull();
  });

  it("counts wins and survived runs separately", () => {
    recordFirefightRun(run({ won: true }));
    recordFirefightRun(run({ won: false, score: 100 }));
    recordFirefightRun(run({ won: false, score: 50 }));
    expect(getFirefightWins()).toBe(1);
    expect(getFirefightHistory()).toHaveLength(3);
    expect(getFirefightBestScore()).toBe(900);
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordFirefightRun(run({ score: 100 + i }));
    }
    const history = getFirefightHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.score).toBe(111);
    expect(getFirefightBestScore()).toBe(111);
  });

  it("the reset hook clears storage and cache", () => {
    recordFirefightRun(run());
    _resetFirefightScoresForTests();
    expect(window.localStorage.getItem(FIREFIGHT_SCORES_KEY)).toBeNull();
    expect(getFirefightBestScore()).toBe(0);
  });

  it("sanitize drops garbage and trims the history (audit L4 pattern)", () => {
    const sanitized = sanitizeImportedFirefightScores({
      bestScore: 1300,
      wins: "many",
      survivedRuns: 4,
      history: [
        { at: 5, score: 70, won: true, ashes: 1, extinguished: 9 },
        { broken: true },
      ],
    });
    expect(sanitized.bestScore).toBe(1300);
    expect(sanitized.wins).toBe(0); //garbage dropped
    expect(sanitized.survivedRuns).toBe(4);
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedFirefightScores(3)).toEqual({
      bestScore: 0,
      wins: 0,
      survivedRuns: 0,
      history: [],
    });
  });
});
