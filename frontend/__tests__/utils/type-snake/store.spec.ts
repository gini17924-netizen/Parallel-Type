import { beforeEach, describe, expect, it } from "vitest";

import {
  TYPE_SNAKE_SCORES_KEY,
  getTypeSnakeBestLength,
  getTypeSnakeBestScore,
  getTypeSnakeHistory,
  recordTypeSnakeRun,
  sanitizeImportedTypeSnakeScores,
  _resetTypeSnakeScoresForTests,
} from "../../../src/ts/utils/type-snake/store";

function run(overrides: Partial<{ score: number; length: number }> = {}): {
  score: number;
  length: number;
  eaten: number;
  maxCombo: number;
} {
  return {
    score: overrides.score ?? 600,
    length: overrides.length ?? 11,
    eaten: 7,
    maxCombo: 7,
  };
}

describe("type snake store (idea G11 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetTypeSnakeScoresForTests();
  });

  it("records the first run as both bests with history", () => {
    const result = recordTypeSnakeRun(run());
    expect(result.isNewScoreRecord).toBe(true);
    expect(result.isNewLengthRecord).toBe(true);
    expect(getTypeSnakeBestScore()).toBe(600);
    expect(getTypeSnakeBestLength()).toBe(11);
    expect(getTypeSnakeHistory()).toHaveLength(1);
    expect(window.localStorage.getItem(TYPE_SNAKE_SCORES_KEY)).not.toBeNull();
  });

  it("keeps bests on a weaker run; history grows newest-first", () => {
    recordTypeSnakeRun(run({ score: 900, length: 14 }));
    const weaker = recordTypeSnakeRun(run({ score: 200, length: 5 }));
    expect(weaker.isNewScoreRecord).toBe(false);
    expect(weaker.isNewLengthRecord).toBe(false);
    expect(getTypeSnakeBestScore()).toBe(900);
    expect(getTypeSnakeHistory()[0]?.length).toBe(5);
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordTypeSnakeRun(run({ score: 100 + i, length: 4 + i }));
    }
    const history = getTypeSnakeHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.length).toBe(15);
    expect(getTypeSnakeBestLength()).toBe(15);
  });

  it("the reset hook clears storage and cache", () => {
    recordTypeSnakeRun(run());
    _resetTypeSnakeScoresForTests();
    expect(window.localStorage.getItem(TYPE_SNAKE_SCORES_KEY)).toBeNull();
    expect(getTypeSnakeBestScore()).toBe(0);
  });

  it("sanitize drops garbage and trims the history (audit L4 pattern)", () => {
    const sanitized = sanitizeImportedTypeSnakeScores({
      bestScore: 800,
      bestLength: true,
      history: [
        { at: 9, score: 40, length: 6, eaten: 2, maxCombo: 2 },
        { nope: true },
      ],
    });
    expect(sanitized.bestScore).toBe(800);
    expect(sanitized.bestLength).toBe(0);
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedTypeSnakeScores("x")).toEqual({
      bestScore: 0,
      bestLength: 0,
      history: [],
    });
  });
});
