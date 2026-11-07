import { beforeEach, describe, expect, it } from "vitest";

import {
  clearGauntletState,
  GAUNTLET_STATS_KEY,
  GAUNTLET_STATE_KEY,
  getGauntletCalendarEntry,
  getGauntletStats,
  loadGauntletState,
  previousDayKey,
  recordGauntletCompletion,
  saveGauntletState,
  sanitizeImportedGauntletStats,
  _resetGauntletStoresForTests,
} from "../../../src/ts/utils/daily-gauntlet/store";
import { createGauntlet } from "../../../src/ts/utils/daily-gauntlet/engine";

describe("gauntlet stores (idea G22 phase 3)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetGauntletStoresForTests();
  });

  it("saves, loads and clears the resumable day state", () => {
    expect(loadGauntletState()).toBeUndefined(); //the empty fallback
    const state = createGauntlet("2026-11-08", [
      { gameId: "word-blast", title: "word blast", seed: 1, params: {} },
    ]);
    saveGauntletState(structuredClone(state));
    const loaded = loadGauntletState();
    expect(loaded?.dayKey).toBe("2026-11-08");
    expect(loaded?.stages[0]?.gameId).toBe("word-blast");
    clearGauntletState();
    expect(loadGauntletState()).toBeUndefined();
    expect(window.localStorage.getItem(GAUNTLET_STATE_KEY)).toBeNull();
  });

  it("previousDayKey walks back one local day", () => {
    expect(previousDayKey("2026-11-08")).toBe("2026-11-07");
    expect(previousDayKey("2026-03-01")).toBe("2026-02-28");
    expect(previousDayKey("2027-01-01")).toBe("2026-12-31");
  });

  it("a completion stamps the calendar, best and history", () => {
    const first = recordGauntletCompletion({
      dayKey: "2026-11-08",
      total: 1800,
      stagesWon: 2,
    });
    expect(first.streak).toBe(1);
    expect(first.isNewBest).toBe(true);
    expect(getGauntletCalendarEntry("2026-11-08")?.total).toBe(1800);
    expect(getGauntletStats().bestTotal).toBe(1800);
    //a weaker day keeps the best
    const second = recordGauntletCompletion({
      dayKey: "2026-11-09",
      total: 1500,
      stagesWon: 1,
    });
    expect(second.isNewBest).toBe(false);
    expect(getGauntletStats().bestTotal).toBe(1800);
  });

  it("the streak continues from yesterday and resets after a gap", () => {
    recordGauntletCompletion({
      dayKey: "2026-11-08",
      total: 1800,
      stagesWon: 3,
    });
    const nextDay = recordGauntletCompletion({
      dayKey: "2026-11-09",
      total: 1500,
      stagesWon: 2,
    });
    expect(nextDay.streak).toBe(2); //yesterday played
    const afterGap = recordGauntletCompletion({
      dayKey: "2026-11-20",
      total: 1200,
      stagesWon: 1,
    });
    expect(afterGap.streak).toBe(1); //the chain broke
    expect(getGauntletStats().maxStreak).toBe(2);
  });

  it("the stats store key holds the payload (backup-visible)", () => {
    recordGauntletCompletion({
      dayKey: "2026-11-08",
      total: 900,
      stagesWon: 1,
    });
    expect(window.localStorage.getItem(GAUNTLET_STATS_KEY)).not.toBeNull();
  });

  it("sanitize drops garbage and keeps the numbers finite (audit L4)", () => {
    const sanitized = sanitizeImportedGauntletStats({
      streak: 3.9,
      maxStreak: 5,
      bestTotal: 2100,
      calendar: {
        "2026-11-08": { total: 1800, stagesWon: 2 },
        junk: { total: "high" },
      },
      history: [
        { at: 10, dayKey: "2026-11-08", total: 1800, stagesWon: 2 },
        { junk: true },
      ],
    });
    expect(sanitized.streak).toBe(3);
    expect(Object.keys(sanitized.calendar)).toEqual(["2026-11-08"]);
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedGauntletStats(null).streak).toBe(0);
  });
});
