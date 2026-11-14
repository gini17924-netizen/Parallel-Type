import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  computeDailyStreak,
  computeWeeklyStreak,
  dayKeyFromTimestamp,
} from "../../src/ts/utils/streaks/engine";
import { buildStreakView } from "../../src/ts/utils/streaks/state";
import {
  appendLocalResult,
  makeLocalResultId,
} from "../../src/ts/utils/local-persistence";
import type { SnapshotResult } from "../../src/ts/constants/default-snapshot";
import {
  _resetGauntletStoresForTests,
  recordGauntletCompletion,
} from "../../src/ts/utils/daily-gauntlet/store";

const NOW = Date.parse("2026-11-14T18:00:00"); // a Saturday

const daysAgo = (days: number, hour = 12): number =>
  Date.parse("2026-11-14T00:00:00") - days * 86_400_000 + hour * 3_600_000;

describe("phase 98 — the pure streak engine", () => {
  it("day keys are local YYYY-MM-DD", () => {
    expect(dayKeyFromTimestamp(NOW)).toBe("2026-11-14");
  });

  it("an empty history has no streaks", () => {
    expect(computeDailyStreak([], NOW)).toEqual({ current: 0, longest: 0 });
    expect(computeWeeklyStreak([], NOW)).toEqual({ current: 0, longest: 0 });
  });

  it("today's entry keeps the streak alive at its run length", () => {
    const summary = computeDailyStreak(
      [daysAgo(0), daysAgo(1), daysAgo(2)],
      NOW,
    );
    expect(summary.current).toBe(3);
    expect(summary.longest).toBe(3);
  });

  it("yesterday's last entry still counts (the not-typed-YET rule)", () => {
    const summary = computeDailyStreak([daysAgo(1), daysAgo(2)], NOW);
    expect(summary.current).toBe(2);
  });

  it("a full missed day breaks the current streak but the longest survives", () => {
    const summary = computeDailyStreak(
      [
        daysAgo(0),
        daysAgo(1),
        daysAgo(2),
        daysAgo(9),
        daysAgo(10),
        daysAgo(11),
      ],
      NOW,
    );
    expect(summary.current).toBe(3);
    expect(summary.longest).toBe(3);
  });

  it("the longest streak beats the current one", () => {
    const summary = computeDailyStreak(
      [
        daysAgo(0),
        daysAgo(1),
        daysAgo(20),
        daysAgo(21),
        daysAgo(22),
        daysAgo(23),
        daysAgo(24),
      ],
      NOW,
    );
    expect(summary.current).toBe(2);
    expect(summary.longest).toBe(5);
  });

  it("duplicate entries on the same day count once", () => {
    const summary = computeDailyStreak(
      [daysAgo(0), daysAgo(0), daysAgo(1)],
      NOW,
    );
    expect(summary.current).toBe(2);
  });

  it("weekly streaks cross year boundaries through the absolute week index", () => {
    //the last days of 2025 and the first days of 2026 are ADJACENT weeks
    //(december 28 is the Sunday of one monday-week, january 2 opens the next)
    const newYearsEve = Date.parse("2025-12-28T12:00:00");
    const jan2 = Date.parse("2026-01-02T12:00:00");
    const jan9 = Date.parse("2026-01-09T12:00:00");
    const summary = computeWeeklyStreak(
      [newYearsEve, jan2, jan9],
      Date.parse("2026-01-14T12:00:00"),
    );
    expect(summary.current).toBe(3);
  });
});

describe("phase 98 — the unified streak view (the real stores)", () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("local-persistence");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it("daily and weekly read the local results' days", async () => {
    await appendLocalResult(makeResult(daysAgo(0)));
    await appendLocalResult(makeResult(daysAgo(1)));
    await appendLocalResult(makeResult(daysAgo(1)));
    const view = await buildStreakView(NOW);
    expect(view.daily.current).toBe(2);
    expect(view.daily.longest).toBe(2);
  });

  it("the per-game rows carry the gauntlet from its calendar", async () => {
    recordGauntletCompletion({
      dayKey: "2026-11-13",
      total: 2100,
      stagesWon: 3,
    });
    const view = await buildStreakView(NOW);
    const gauntlet = view.perGame.find((g) => g.gameId === "daily-gauntlet");
    expect(gauntlet?.summary.current).toBe(1);
    //yesterday's last entry keeps the chain alive
    expect(gauntlet?.summary.longest).toBe(1);
  });

  it("the word blast row reads the history", async () => {
    const view = await buildStreakView(NOW);
    expect(
      view.perGame.find((g) => g.gameId === "word-blast")?.summary.current,
    ).toBe(0);
  });
});

function makeResult(timestamp: number): SnapshotResult<"time"> {
  //a minimal row: only the fields the streak view reads (timestamp) plus
  //the store's key — the full Result shape is upstream's concern
  return {
    _id: makeLocalResultId(),
    timestamp,
    mode: "time",
    mode2: "60",
    wpm: 70,
    acc: 95,
    rawWpm: 75,
    consistency: 80,
    charStats: [100, 0, 0, 0],
    restartCount: 0,
    testDuration: 60,
    blindMode: false,
    language: "english",
    funbox: [],
  } as unknown as SnapshotResult<"time">;
}
