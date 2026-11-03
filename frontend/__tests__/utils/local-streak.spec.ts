import { describe, it, expect } from "vitest";

import {
  computeStreakFromResults,
  updateLocalStreak,
  type LocalStreakState,
} from "../../src/ts/utils/local-streak";

/** local noon of a day — safely inside its calendar day, DST-proof */
function noon(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 12, 0, 0).getTime();
}

const FRESH: LocalStreakState = {
  lastResultTimestamp: 0,
  length: 0,
  maxLength: 0,
};

describe("updateLocalStreak (mirrors backend UserDAL.updateStreak)", () => {
  it("first-ever result starts the streak at 1", () => {
    const update = updateLocalStreak(FRESH, noon(2026, 11, 1));
    expect(update.length).toBe(1);
    expect(update.maxLength).toBe(1);
    expect(update.streakLost).toBe(false);
    expect(update.lastResultTimestamp).toBe(noon(2026, 11, 1));
  });

  it("second result on the same day keeps the streak unchanged", () => {
    const day1 = updateLocalStreak(FRESH, noon(2026, 11, 1));
    const update = updateLocalStreak(day1, noon(2026, 11, 1) + 3600_000);
    expect(update.length).toBe(1);
    expect(update.lastResultTimestamp).toBe(noon(2026, 11, 1) + 3600_000);
  });

  it("a result on the next calendar day increments", () => {
    const day1 = updateLocalStreak(FRESH, noon(2026, 11, 1));
    const update = updateLocalStreak(day1, noon(2026, 11, 2));
    expect(update.length).toBe(2);
    expect(update.streakLost).toBe(false);
  });

  it("typing past midnight counts as the next day (23:59 → 00:01)", () => {
    const late = new Date(2026, 10, 1, 23, 59).getTime();
    const early = new Date(2026, 10, 2, 0, 1).getTime();
    const update = updateLocalStreak(
      { lastResultTimestamp: late, length: 1, maxLength: 1 },
      early,
    );
    expect(update.length).toBe(2);
  });

  it("a missed day resets to 1 and flags the loss; maxLength survives", () => {
    let state = updateLocalStreak(FRESH, noon(2026, 11, 1));
    state = updateLocalStreak(state, noon(2026, 11, 2));
    state = updateLocalStreak(state, noon(2026, 11, 3));
    const update = updateLocalStreak(state, noon(2026, 11, 5)); //day 4 missed
    expect(update.length).toBe(1);
    expect(update.streakLost).toBe(true);
    expect(update.maxLength).toBe(3);
  });
});

describe("computeStreakFromResults (display derivation)", () => {
  it("counts from yesterday when today has no result yet", () => {
    const results = [
      { timestamp: noon(2026, 11, 2) },
      { timestamp: noon(2026, 11, 3) },
    ];
    expect(computeStreakFromResults(results, noon(2026, 11, 4))).toBe(2);
  });

  it("is 0 when neither today nor yesterday has a result", () => {
    const results = [
      { timestamp: noon(2026, 11, 2) },
      { timestamp: noon(2026, 11, 3) },
    ];
    expect(computeStreakFromResults(results, noon(2026, 11, 5))).toBe(0);
  });
});

describe("incremental updates and the display scan agree", () => {
  it("right after every save, snapshot streak === displayed streak", () => {
    //deterministic schedule (day of November): 3-day run, 2-day run,
    //5-day run, then a 2-day run
    const schedule = [1, 2, 3, 5, 6, 9, 10, 11, 12, 13, 20, 21];
    let state: LocalStreakState = FRESH;
    const results: { timestamp: number }[] = [];
    for (const day of schedule) {
      const timestamp = noon(2026, 11, day);
      results.push({ timestamp });
      state = updateLocalStreak(state, timestamp);
      expect(state.length).toBe(computeStreakFromResults(results, timestamp));
    }
    expect(state.length).toBe(2);
    expect(state.maxLength).toBe(5);
  });
});
