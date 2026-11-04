import { describe, expect, it } from "vitest";

import type { Mode } from "@monkeytype/schemas/shared";

import type {
  Snapshot,
  SnapshotResult,
} from "../../src/ts/constants/default-snapshot";
import {
  applyDeleteSnapshotSideEffects,
  recomputePersonalBestsAfterDelete,
  recomputeStreak,
  reverseTypingStats,
} from "../../src/ts/utils/local-result-maintenance";

//DAY = Nov 2026 local noon; consecutive days for streak scenarios
const DAY = (day: number, hour = 12): number =>
  new Date(2026, 10, day, hour, 0, 0).getTime();

function makeResult(
  overrides: Partial<SnapshotResult<Mode>> & { _id: string },
): SnapshotResult<Mode> {
  return {
    wpm: 80,
    rawWpm: 90,
    acc: 95,
    consistency: 80,
    mode: "time",
    mode2: "30",
    timestamp: DAY(2),
    restartCount: 0,
    incompleteTestSeconds: 0,
    afkDuration: 0,
    testDuration: 30,
    punctuation: false,
    numbers: false,
    difficulty: "normal",
    language: "english",
    lazyMode: false,
    funbox: [],
    charStats: [100, 0, 0, 0],
    isPb: false,
    ...overrides,
  } as unknown as SnapshotResult<Mode>;
}

/** mirrors the save-path bucket shape: mode → mode2 → PersonalBest entries */
function personalBestsFrom(
  results: SnapshotResult<Mode>[],
): Snapshot["personalBests"] {
  const pb: Record<string, Record<string, unknown[]>> = {
    time: {},
    words: {},
    quote: {},
    zen: {},
    custom: {},
  };
  for (const r of results) {
    const bucket = (pb[r.mode] ??= {});
    (bucket[r.mode2] ??= []).push({
      language: r.language,
      difficulty: r.difficulty,
      lazyMode: r.lazyMode ?? false,
      punctuation: r.punctuation ?? false,
      numbers: r.numbers ?? false,
      wpm: r.wpm,
      acc: r.acc,
      raw: r.rawWpm,
      timestamp: r.timestamp,
      consistency: r.consistency,
    });
  }
  return pb as Snapshot["personalBests"];
}

function entriesOf(
  personalBests: Snapshot["personalBests"],
): { wpm: number; timestamp: number }[] {
  const byMode = personalBests as Record<
    string,
    Record<string, { wpm: number; timestamp: number }[]>
  >;
  return byMode["time"]?.["30"] ?? [];
}

describe("reverseTypingStats", () => {
  it("reverses the saved contribution exactly", () => {
    const stats = reverseTypingStats(
      { timeTyping: 100, startedTests: 5, completedTests: 4 },
      {
        testDuration: 30,
        afkDuration: 10,
        incompleteTestSeconds: 5,
        restartCount: 2,
      },
    );
    //saved time = 30 + 5 - 10 = 25
    expect(stats.timeTyping).toBe(75);
    expect(stats.startedTests).toBe(2); //5 - (2 restarts + 1)
    expect(stats.completedTests).toBe(3);
  });

  it("parses legacy string counters and clamps at zero", () => {
    const stats = reverseTypingStats(
      //legacy rows stored counters as strings; the cast mirrors that
      {
        timeTyping: "10" as unknown as number,
        startedTests: 1,
        completedTests: 1,
      },
      {
        testDuration: 60,
        afkDuration: 0,
        incompleteTestSeconds: 0,
        restartCount: 0,
      },
    );
    expect(stats.timeTyping).toBe(0); //10 - 60 clamped
    expect(stats.startedTests).toBe(0); //1 - 1
    expect(stats.completedTests).toBe(0);
  });
});

describe("recomputeStreak", () => {
  it("recomputes from the remaining results", () => {
    const remaining = [
      makeResult({ _id: "r1", timestamp: DAY(7) }),
      makeResult({ _id: "r2", timestamp: DAY(8) }),
    ];
    expect(recomputeStreak(remaining, DAY(9))).toEqual({
      streak: 2,
      streakLastResultTimestamp: DAY(8),
    });
  });

  it("drops to zero when deleting the last day of a streak", () => {
    const all = [
      makeResult({ _id: "r1", timestamp: DAY(7) }),
      makeResult({ _id: "r2", timestamp: DAY(8) }),
    ];
    const remaining = all.filter((r) => r._id !== "r2");
    expect(recomputeStreak(remaining, DAY(9)).streak).toBe(0);
    expect(recomputeStreak(remaining, DAY(9)).streakLastResultTimestamp).toBe(
      DAY(7),
    );
  });

  it("returns a zero pointer when nothing remains", () => {
    expect(recomputeStreak([], DAY(9))).toEqual({
      streak: 0,
      streakLastResultTimestamp: 0,
    });
  });
});

describe("recomputePersonalBestsAfterDelete", () => {
  it("replaces a deleted PB with the remaining best and promotes it", () => {
    const best = makeResult({
      _id: "pb",
      wpm: 120,
      isPb: true,
      timestamp: DAY(3),
    });
    const second = makeResult({
      _id: "second",
      wpm: 90,
      isPb: false,
      timestamp: DAY(2),
    });
    const pbFixture = personalBestsFrom([best, second]);
    const result = recomputePersonalBestsAfterDelete(pbFixture, best, [second]);
    expect(result.promotedId).toBe("second");
    //the helper mutates the passed structure in place
    const entries = entriesOf(pbFixture);
    expect(entries[0]?.wpm).toBe(90);
    //timestamp policy: the promoted source result's own timestamp
    expect(entries[0]?.timestamp).toBe(DAY(2));
  });

  it("removes the bucket entry when nothing eligible remains", () => {
    const best = makeResult({ _id: "pb", wpm: 120, isPb: true });
    const pbFixture = personalBestsFrom([best]);
    const result = recomputePersonalBestsAfterDelete(pbFixture, best, []);
    expect(result.promotedId).toBeUndefined();
    expect(entriesOf(pbFixture)).toHaveLength(0);
  });

  it("ignores quote, bailed-out and ineligible-funbox results", () => {
    const best = makeResult({ _id: "pb", wpm: 120, isPb: true });
    const ineligible = [
      makeResult({ _id: "q", wpm: 200, mode: "quote" }),
      makeResult({ _id: "b", wpm: 200, bailedOut: true }),
      makeResult({
        _id: "s",
        wpm: 200,
        stopOnLetter: true,
        acc: 50,
      } as Partial<SnapshotResult<Mode>> & { _id: string }),
      makeResult({ _id: "f", wpm: 200, funbox: ["58008"] }), //canGetPb false
    ];
    const pbFixture = personalBestsFrom([best]);
    //the deleted row itself is not part of the remaining set
    const remaining = ineligible;
    const result = recomputePersonalBestsAfterDelete(
      pbFixture,
      best,
      remaining,
    );
    expect(result.promotedId).toBeUndefined();
    expect(entriesOf(pbFixture)).toHaveLength(0);
  });

  it("does not touch the bucket when the deleted row was not a PB", () => {
    const best = makeResult({ _id: "best", wpm: 120, isPb: true });
    const pbFixture = personalBestsFrom([best]);
    //same bucket identity, but the row is not a PB: nothing may change
    const normal = makeResult({ _id: "normal", wpm: 60, isPb: false });
    const result = recomputePersonalBestsAfterDelete(pbFixture, normal, [best]);
    expect(result.promotedId).toBeUndefined();
    expect(entriesOf(pbFixture)).toHaveLength(1);
  });
});

describe("applyDeleteSnapshotSideEffects", () => {
  it("leaves XP unchanged and applies stats/streak/PB together", () => {
    const best = makeResult({
      _id: "del",
      wpm: 120,
      isPb: true,
      testDuration: 30,
    });
    const remaining = [
      makeResult({ _id: "keep", wpm: 90, isPb: false, timestamp: DAY(8) }),
    ];
    const snapshot = {
      typingStats: { timeTyping: 100, startedTests: 3, completedTests: 3 },
      xp: 4210,
      streak: 2,
      maxStreak: 7,
      streakLastResultTimestamp: DAY(8),
      personalBests: personalBestsFrom([best, ...remaining]),
    } as unknown as Snapshot;

    const { promotedId } = applyDeleteSnapshotSideEffects(
      snapshot,
      best,
      remaining,
      DAY(9),
    );
    expect(promotedId).toBe("keep");
    expect(snapshot.xp).toBe(4210); //XP retained by design
    expect(snapshot.streak).toBe(1); //remaining result is one day back
    expect(snapshot.maxStreak).toBe(7); //historical record untouched
    expect(snapshot.streakLastResultTimestamp).toBe(DAY(8));
  });
});
