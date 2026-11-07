import { beforeEach, describe, expect, it } from "vitest";

import {
  getLaneDefenseBestScore,
  getLaneDefenseBestWave,
  getLaneDefenseHistory,
  getLaneDefenseZoneBest,
  LANE_DEFENSE_SCORES_KEY,
  recordLaneDefenseRun,
  sanitizeImportedLaneDefenseScores,
  _resetLaneDefenseScoresForTests,
} from "../../../src/ts/utils/lane-defense/store";

function run(
  overrides: Partial<{ score: number; wave: number; zone: string }> = {},
): {
  score: number;
  wave: number;
  maxCombo: number;
  kills: number;
  zone: string;
} {
  return {
    score: overrides.score ?? 500,
    wave: overrides.wave ?? 6,
    maxCombo: 11,
    kills: 40,
    zone: overrides.zone ?? "",
  };
}

describe("lane defense store (idea G9 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetLaneDefenseScoresForTests();
  });

  it("records the first run as both bests with history", () => {
    const result = recordLaneDefenseRun(run());
    expect(result.isNewScoreRecord).toBe(true);
    expect(result.isNewWaveRecord).toBe(true);
    expect(getLaneDefenseBestScore()).toBe(500);
    expect(getLaneDefenseBestWave()).toBe(6);
    expect(getLaneDefenseHistory()).toHaveLength(1);
    expect(window.localStorage.getItem(LANE_DEFENSE_SCORES_KEY)).not.toBeNull();
  });

  it("tracks per-zone bests independently", () => {
    recordLaneDefenseRun(run({ score: 800, zone: "fj" }));
    recordLaneDefenseRun(run({ score: 300, zone: "dk" }));
    expect(getLaneDefenseZoneBest("fj")).toBe(800);
    expect(getLaneDefenseZoneBest("dk")).toBe(300);
    expect(getLaneDefenseZoneBest("sl")).toBe(0);
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 13; i++) {
      recordLaneDefenseRun(run({ score: 100 + i }));
    }
    const history = getLaneDefenseHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.score).toBe(112);
    expect(getLaneDefenseBestScore()).toBe(112);
  });

  it("the reset hook clears storage and cache", () => {
    recordLaneDefenseRun(run());
    _resetLaneDefenseScoresForTests();
    expect(window.localStorage.getItem(LANE_DEFENSE_SCORES_KEY)).toBeNull();
    expect(getLaneDefenseBestScore()).toBe(0);
  });

  it("sanitize drops garbage and keeps valid zones (audit L4 pattern)", () => {
    const sanitized = sanitizeImportedLaneDefenseScores({
      bestScore: 640,
      bestWave: "x",
      byZone: { fj: { bestScore: 220 }, bad: "nope" },
      history: [
        { at: 2, score: 30, wave: 2, maxCombo: 4, kills: 6, zone: "fj" },
        42,
      ],
    });
    expect(sanitized.bestScore).toBe(640);
    expect(sanitized.bestWave).toBe(0);
    expect(sanitized.byZone).toEqual({ fj: { bestScore: 220 } });
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedLaneDefenseScores(7)).toEqual({
      bestScore: 0,
      bestWave: 0,
      byZone: {},
      history: [],
    });
  });
});
