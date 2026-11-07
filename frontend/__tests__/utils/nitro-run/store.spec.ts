import { beforeEach, describe, expect, it } from "vitest";

import {
  NITRO_RUN_STATS_KEY,
  getNitroBestDistanceM,
  getNitroBestRankScore,
  getNitroHistory,
  recordNitroRun,
  sanitizeImportedNitroRunStats,
  _resetNitroRunStatsForTests,
} from "../../../src/ts/utils/nitro-run/store";

function run(
  overrides: Partial<{ rankScore: number; distanceM: number }> = {},
): {
  rankScore: number;
  rank: number;
  distanceM: number;
  nitroUses: number;
} {
  return {
    rankScore: overrides.rankScore ?? 350,
    rank: 2,
    distanceM: overrides.distanceM ?? 2400,
    nitroUses: 3,
  };
}

describe("nitro run store (idea G23 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetNitroRunStatsForTests();
  });

  it("records the first run as both bests with history", () => {
    const result = recordNitroRun(run());
    expect(result.isNewScoreRecord).toBe(true);
    expect(result.isNewDistanceRecord).toBe(true);
    expect(getNitroBestRankScore()).toBe(350);
    expect(getNitroBestDistanceM()).toBe(2400);
    expect(getNitroHistory()).toHaveLength(1);
    expect(window.localStorage.getItem(NITRO_RUN_STATS_KEY)).not.toBeNull();
  });

  it("keeps bests on a weaker run; history grows newest-first", () => {
    recordNitroRun(run({ rankScore: 500, distanceM: 3000 }));
    const weaker = recordNitroRun(run({ rankScore: 200, distanceM: 800 }));
    expect(weaker.isNewScoreRecord).toBe(false);
    expect(weaker.isNewDistanceRecord).toBe(false);
    expect(getNitroBestRankScore()).toBe(500);
    expect(getNitroHistory()[0]?.distanceM).toBe(800);
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordNitroRun(run({ rankScore: 100 + i, distanceM: 500 + i }));
    }
    const history = getNitroHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.rankScore).toBe(111);
    expect(getNitroBestRankScore()).toBe(111);
  });

  it("the reset hook clears storage and cache", () => {
    recordNitroRun(run());
    _resetNitroRunStatsForTests();
    expect(window.localStorage.getItem(NITRO_RUN_STATS_KEY)).toBeNull();
    expect(getNitroBestRankScore()).toBe(0);
  });

  it("sanitize drops garbage and trims the history (audit L4 pattern)", () => {
    const sanitized = sanitizeImportedNitroRunStats({
      bestRankScore: 480,
      bestDistanceM: "far",
      nitroUsesTotal: 7,
      history: [
        { at: 8, rankScore: 90, rank: 1, distanceM: 1500, nitroUses: 2 },
        [],
      ],
    });
    expect(sanitized.bestRankScore).toBe(480);
    expect(sanitized.bestDistanceM).toBe(0);
    expect(sanitized.nitroUsesTotal).toBe(7);
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedNitroRunStats(9)).toEqual({
      bestRankScore: 0,
      bestDistanceM: 0,
      nitroUsesTotal: 0,
      history: [],
    });
  });
});
