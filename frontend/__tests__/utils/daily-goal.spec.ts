import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("../../src/ts/states/notifications", () => ({
  showSuccessNotification: vi.fn(),
  showErrorNotification: vi.fn(),
  showNoticeNotification: vi.fn(),
}));

import {
  getDailyGoalMinutes,
  setDailyGoalMinutes,
  todayTypingSeconds,
  maybeNotifyDailyGoal,
  DEFAULT_GOAL_MINUTES,
} from "../../src/ts/utils/daily-goal";
import type { SnapshotResult } from "../../src/ts/constants/default-snapshot";
import type { Mode } from "@monkeytype/schemas/shared";
import { showSuccessNotification } from "../../src/ts/states/notifications";

describe("daily goal (desktop offline)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    vi.clearAllMocks();
  });

  it("defaults to 10 minutes and clamps the editable range", () => {
    expect(getDailyGoalMinutes()).toBe(DEFAULT_GOAL_MINUTES);
    setDailyGoalMinutes(25);
    expect(getDailyGoalMinutes()).toBe(25);
    setDailyGoalMinutes(0);
    expect(getDailyGoalMinutes()).toBe(1); //clamped
    setDailyGoalMinutes(9999);
    expect(getDailyGoalMinutes()).toBe(240); //clamped
  });

  it("counts only today's active typing seconds", () => {
    const now = Date.now();
    const yesterday = now - 86_400_000;
    const seconds = todayTypingSeconds([
      { timestamp: now, testDuration: 120, afkDuration: 0 },
      { timestamp: now, testDuration: 60, afkDuration: 30 }, //30 active
      { timestamp: yesterday, testDuration: 600, afkDuration: 0 }, //not today
    ]);
    expect(seconds).toBe(150);
  });

  it("notifies once per day when the goal is reached", async () => {
    const { appendLocalResult } =
      await import("../../src/ts/utils/local-persistence");
    const mk = (seconds: number, tsOffset = 0): SnapshotResult<Mode> =>
      ({
        _id: `dg_${seconds}_${tsOffset}`,
        wpm: 80,
        rawWpm: 90,
        charStats: [40, 0, 0, 0],
        acc: 100,
        mode: "time" as const,
        mode2: "30",
        timestamp: Date.now() + tsOffset,
        restartCount: 0,
        incompleteTestSeconds: 0,
        afkDuration: 0,
        testDuration: seconds,
      }) as unknown as SnapshotResult<Mode>;
    setDailyGoalMinutes(1); //60 seconds
    await appendLocalResult(mk(30));
    await maybeNotifyDailyGoal();
    expect(showSuccessNotification).not.toHaveBeenCalled(); //30s < 60s
    await appendLocalResult(mk(40));
    await maybeNotifyDailyGoal();
    expect(showSuccessNotification).toHaveBeenCalledTimes(1); //70s ≥ 60s
    await appendLocalResult(mk(50));
    await maybeNotifyDailyGoal();
    expect(showSuccessNotification).toHaveBeenCalledTimes(1); //once per day
  });
});
