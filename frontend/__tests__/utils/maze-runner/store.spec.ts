import { beforeEach, describe, expect, it } from "vitest";

import {
  MAZE_SCORES_KEY,
  _resetMazeScoresForTests,
  getMazeBestTime,
  getMazeHistory,
  getMazeNoErrorRuns,
  recordMazeRun,
  sanitizeImportedMazeScores,
} from "../../../src/ts/utils/maze-runner/store";

describe("maze-runner store (idea G14 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetMazeScoresForTests();
  });

  it("records the first run as the per-level best TIME", () => {
    const result = recordMazeRun({
      level: 1,
      timeMs: 21000,
      score: 1200,
      errors: 0,
    });
    expect(result.isNewBestTime).toBe(true);
    expect(getMazeBestTime(1)).toBe(21000);
    expect(getMazeBestTime(2)).toBeUndefined(); //per-level isolation
    expect(getMazeNoErrorRuns()).toBe(1);
    expect(getMazeHistory()).toHaveLength(1);
  });

  it("a SLOWER run keeps the best time; the history grows newest-first", () => {
    recordMazeRun({ level: 1, timeMs: 18000, score: 2000, errors: 0 });
    const slower = recordMazeRun({
      level: 1,
      timeMs: 25000,
      score: 900,
      errors: 3,
    });
    expect(slower.isNewBestTime).toBe(false);
    expect(getMazeBestTime(1)).toBe(18000);
    expect(getMazeNoErrorRuns()).toBe(1); //the error run doesn't count
    expect(getMazeHistory()[0]?.timeMs).toBe(25000);
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordMazeRun({
        level: 1,
        timeMs: 30000 - i,
        score: 100 + i,
        errors: i % 2,
      });
    }
    const history = getMazeHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.timeMs).toBe(30000 - 11);
    expect(getMazeBestTime(1)).toBe(30000 - 11);
  });

  it("the reset hook clears storage and cache", () => {
    recordMazeRun({ level: 2, timeMs: 40000, score: 500, errors: 1 });
    _resetMazeScoresForTests();
    expect(window.localStorage.getItem(MAZE_SCORES_KEY)).toBeNull();
    expect(getMazeBestTime(2)).toBeUndefined();
  });

  it("sanitize drops garbage rows and negative times (audit L4)", () => {
    const sanitized = sanitizeImportedMazeScores({
      bestTimeByLevel: { "1": 21000, "2": -5, junk: "fast" },
      noErrorRuns: 3.9,
      history: [
        { at: 10, level: 1, timeMs: 21000, score: 1200, errors: 0 },
        { junk: true },
      ],
    });
    expect(sanitized.bestTimeByLevel).toEqual({ "1": 21000 });
    expect(sanitized.noErrorRuns).toBe(3);
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedMazeScores(null)).toEqual({
      bestTimeByLevel: {},
      noErrorRuns: 0,
      history: [],
    });
  });
});
