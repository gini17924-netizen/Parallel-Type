import { beforeEach, describe, expect, it } from "vitest";

import {
  getLetterStrikeBestScore,
  getLetterStrikeBestWave,
  getLetterStrikeHistory,
  LETTER_STRIKE_SCORES_KEY,
  recordLetterStrikeRun,
  sanitizeImportedLetterStrikeScores,
  _resetLetterStrikeScoresForTests,
} from "../../../src/ts/utils/letter-strike/store";

function run(overrides: Partial<{ score: number; wave: number }> = {}): {
  score: number;
  wave: number;
  maxCombo: number;
  shipsDestroyed: number;
} {
  return {
    score: overrides.score ?? 500,
    wave: overrides.wave ?? 6,
    maxCombo: 12,
    shipsDestroyed: 45,
  };
}

describe("letter strike store (idea G8 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetLetterStrikeScoresForTests();
  });

  it("records the first run as both bests with history", () => {
    const result = recordLetterStrikeRun(run());
    expect(result.isNewScoreRecord).toBe(true);
    expect(result.isNewWaveRecord).toBe(true);
    expect(getLetterStrikeBestScore()).toBe(500);
    expect(getLetterStrikeBestWave()).toBe(6);
    expect(getLetterStrikeHistory()).toHaveLength(1);
    expect(
      window.localStorage.getItem(LETTER_STRIKE_SCORES_KEY),
    ).not.toBeNull();
  });

  it("keeps bests when a weaker run arrives; history grows newest-first", () => {
    recordLetterStrikeRun(run({ score: 900, wave: 8 }));
    const weaker = recordLetterStrikeRun(run({ score: 400, wave: 3 }));
    expect(weaker.isNewScoreRecord).toBe(false);
    expect(weaker.isNewWaveRecord).toBe(false);
    expect(getLetterStrikeBestScore()).toBe(900);
    expect(getLetterStrikeBestWave()).toBe(8);
    const history = getLetterStrikeHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.score).toBe(400); //newest first
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 14; i++) {
      recordLetterStrikeRun(run({ score: 100 + i }));
    }
    const history = getLetterStrikeHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.score).toBe(113); //the newest
    expect(getLetterStrikeBestScore()).toBe(113);
  });

  it("the reset hook clears storage and cache", () => {
    recordLetterStrikeRun(run());
    _resetLetterStrikeScoresForTests();
    expect(window.localStorage.getItem(LETTER_STRIKE_SCORES_KEY)).toBeNull();
    expect(getLetterStrikeBestScore()).toBe(0);
  });

  it("sanitize drops garbage and trims the history (audit L4 pattern)", () => {
    const sanitized = sanitizeImportedLetterStrikeScores({
      bestScore: 700,
      bestWave: "nine", //garbage: dropped
      history: [
        { at: 1, score: 10, wave: 1, maxCombo: 2, shipsDestroyed: 3 },
        { at: "x" }, //invalid: dropped
      ],
    });
    expect(sanitized.bestScore).toBe(700);
    expect(sanitized.bestWave).toBe(0);
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedLetterStrikeScores("nonsense")).toEqual({
      bestScore: 0,
      bestWave: 0,
      history: [],
    });
  });
});
