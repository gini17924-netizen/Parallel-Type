import { beforeEach, describe, expect, it } from "vitest";

import {
  SKY_SCORES_KEY,
  _resetSkyScoresForTests,
  getClimberBestHeight,
  getClimberBestScore,
  getClimberHistory,
  getRunnerBestDistanceM,
  getRunnerHistory,
  recordClimberRun,
  recordRunnerRun,
  sanitizeImportedSkyScores,
} from "../../../src/ts/utils/climber/store";

describe("sky scores store — dual namespace (idea G15 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetSkyScoresForTests();
  });

  it("records a climber run into the climber namespace", () => {
    const result = recordClimberRun({ height: 22, score: 340, falls: 1 });
    expect(result.isNewHeightRecord).toBe(true);
    expect(result.isNewScoreRecord).toBe(true);
    expect(getClimberBestHeight()).toBe(22);
    expect(getClimberBestScore()).toBe(340);
    expect(getClimberHistory()).toHaveLength(1);
  });

  it("keeps the climber bests on a weaker run", () => {
    recordClimberRun({ height: 30, score: 500, falls: 0 });
    const weaker = recordClimberRun({ height: 12, score: 150, falls: 3 });
    expect(weaker.isNewHeightRecord).toBe(false);
    expect(weaker.isNewScoreRecord).toBe(false);
    expect(getClimberBestHeight()).toBe(30);
    expect(getClimberHistory()[0]?.height).toBe(12);
  });

  it("the two namespaces stay independent under one key", () => {
    recordClimberRun({ height: 22, score: 340, falls: 1 });
    recordRunnerRun({ distanceM: 850, hits: 2 });
    expect(getRunnerBestDistanceM()).toBe(850);
    expect(getClimberBestHeight()).toBe(22);
    expect(getRunnerHistory()).toHaveLength(1);
    expect(getClimberHistory()).toHaveLength(1);
    const raw = JSON.parse(
      window.localStorage.getItem(SKY_SCORES_KEY) ?? "{}",
    ) as { climber?: unknown; runner?: unknown };
    expect(raw.climber).toBeDefined();
    expect(raw.runner).toBeDefined();
  });

  it("caps each namespace's history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordClimberRun({ height: i, score: 10 * i, falls: 0 });
      recordRunnerRun({ distanceM: 100 + i, hits: 1 });
    }
    expect(getClimberHistory()).toHaveLength(10);
    expect(getRunnerHistory()).toHaveLength(10);
    expect(getClimberBestHeight()).toBe(11);
    expect(getRunnerBestDistanceM()).toBe(111);
  });

  it("the reset hook clears storage and cache", () => {
    recordClimberRun({ height: 5, score: 50, falls: 0 });
    _resetSkyScoresForTests();
    expect(window.localStorage.getItem(SKY_SCORES_KEY)).toBeNull();
    expect(getClimberBestHeight()).toBe(0);
    expect(getRunnerBestDistanceM()).toBe(0);
  });

  it("sanitize drops garbage rows per namespace (audit L4)", () => {
    const sanitized = sanitizeImportedSkyScores({
      climber: {
        bestHeight: 22,
        bestScore: 340,
        games: 2.9,
        history: [{ at: 10, height: 22, score: 340, falls: 1 }, { junk: true }],
      },
      runner: {
        bestDistanceM: -5,
        games: "lots",
        history: [{ at: 11, distanceM: 850, hits: 2 }, { junk: true }],
      },
    });
    expect(sanitized.climber.bestHeight).toBe(22);
    expect(sanitized.climber.games).toBe(2);
    expect(sanitized.climber.history).toHaveLength(1);
    expect(sanitized.runner.bestDistanceM).toBe(0); //negative dropped
    expect(sanitized.runner.games).toBe(0);
    expect(sanitizeImportedSkyScores(null).climber.bestHeight).toBe(0);
  });
});
