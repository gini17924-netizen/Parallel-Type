import { beforeEach, describe, expect, it } from "vitest";

import {
  getStackAttackBestScore,
  getStackAttackHistory,
  STACK_ATTACK_SCORES_KEY,
  recordStackAttackRun,
  sanitizeImportedStackAttackScores,
  _resetStackAttackScoresForTests,
} from "../../../src/ts/utils/stack-attack/store";

function run(overrides: Partial<{ score: number }> = {}): {
  score: number;
  rowsCleared: number;
  level: number;
  blocksLocked: number;
} {
  return {
    score: overrides.score ?? 800,
    rowsCleared: 7,
    level: 2,
    blocksLocked: 19,
  };
}

describe("stack attack store (idea G12 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetStackAttackScoresForTests();
  });

  it("records the first run as the best with history", () => {
    const result = recordStackAttackRun(run());
    expect(result.isNewScoreRecord).toBe(true);
    expect(getStackAttackBestScore()).toBe(800);
    expect(getStackAttackHistory()).toHaveLength(1);
    expect(window.localStorage.getItem(STACK_ATTACK_SCORES_KEY)).not.toBeNull();
  });

  it("keeps the best on a weaker run; history grows newest-first", () => {
    recordStackAttackRun(run({ score: 1000 }));
    const weaker = recordStackAttackRun(run({ score: 300 }));
    expect(weaker.isNewScoreRecord).toBe(false);
    expect(getStackAttackBestScore()).toBe(1000);
    expect(getStackAttackHistory()[0]?.score).toBe(300);
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordStackAttackRun(run({ score: 100 + i }));
    }
    const history = getStackAttackHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.score).toBe(111);
  });

  it("the reset hook clears storage and cache", () => {
    recordStackAttackRun(run());
    _resetStackAttackScoresForTests();
    expect(window.localStorage.getItem(STACK_ATTACK_SCORES_KEY)).toBeNull();
    expect(getStackAttackBestScore()).toBe(0);
  });

  it("sanitize drops garbage and trims the history (audit L4 pattern)", () => {
    const sanitized = sanitizeImportedStackAttackScores({
      bestScore: 1500,
      history: [
        { at: 4, score: 60, rowsCleared: 2, level: 1, blocksLocked: 5 },
        null,
      ],
    });
    expect(sanitized.bestScore).toBe(1500);
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedStackAttackScores(undefined)).toEqual({
      bestScore: 0,
      history: [],
    });
  });
});
