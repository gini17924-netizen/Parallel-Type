import { describe, it, expect, beforeEach } from "vitest";
import * as LocalPersistence from "../../src/ts/utils/local-persistence";
import { SnapshotResult } from "../../src/ts/constants/default-snapshot";
import { Mode } from "@monkeytype/schemas/shared";

function makeResult(overrides: Partial<SnapshotResult<Mode>> = {}): SnapshotResult<Mode> {
  return {
    _id: "test_id_1",
    wpm: 100,
    rawWpm: 110,
    charStats: { correct: 50, incorrect: 1, extra: 0, missed: 2 },
    acc: 95,
    mode: "words",
    mode2: "10",
    timestamp: 1700000000000,
    restartCount: 0,
    incompleteTestSeconds: 0,
    afkDuration: 0,
    testDuration: 12,
    ...overrides,
  } as unknown as SnapshotResult<Mode>;
}

describe("LocalPersistence (desktop offline)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("makeLocalResultId", () => {
    it("returns a prefixed id", () => {
      const id = LocalPersistence.makeLocalResultId();
      expect(id.startsWith("local_")).toBe(true);
      expect(id.length).toBeGreaterThan("local_".length);
    });

    it("returns unique ids", () => {
      const ids = new Set(Array.from({ length: 50 }, () => LocalPersistence.makeLocalResultId()));
      expect(ids.size).toBe(50);
    });
  });

  describe("loadLocalResults", () => {
    it("returns an empty array when nothing is stored", () => {
      expect(LocalPersistence.loadLocalResults()).toEqual([]);
    });

    it("returns stored results", () => {
      const result = makeResult();
      window.localStorage.setItem("mtDesktopLocalResults", JSON.stringify([result]));
      const loaded = LocalPersistence.loadLocalResults();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]._id).toBe("test_id_1");
    });

    it("returns an empty array on corrupt json", () => {
      window.localStorage.setItem("mtDesktopLocalResults", "{not json");
      expect(LocalPersistence.loadLocalResults()).toEqual([]);
    });

    it("returns an empty array when the stored value is not an array", () => {
      window.localStorage.setItem("mtDesktopLocalResults", JSON.stringify({ a: 1 }));
      expect(LocalPersistence.loadLocalResults()).toEqual([]);
    });

    it("filters out entries without a string _id or numeric timestamp", () => {
      const valid = makeResult();
      const broken = [
        { foo: "bar" },
        { _id: 5, timestamp: 1 },
        { _id: "x" },
        null,
      ];
      window.localStorage.setItem(
        "mtDesktopLocalResults",
        JSON.stringify([valid, ...broken]),
      );
      const loaded = LocalPersistence.loadLocalResults();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]._id).toBe("test_id_1");
    });
  });

  describe("appendLocalResult", () => {
    it("appends a result and strips heavy fields", () => {
      const result = makeResult({
        chartData: [[1, 2]] as unknown as SnapshotResult<Mode>["chartData"],
        keySpacing: "toolong" as unknown as SnapshotResult<Mode>["keySpacing"],
        keyDuration: "toolong" as unknown as SnapshotResult<Mode>["keyDuration"],
      });
      LocalPersistence.appendLocalResult(result);
      const stored = JSON.parse(
        window.localStorage.getItem("mtDesktopLocalResults") ?? "[]",
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]._id).toBe("test_id_1");
      expect(stored[0]).not.toHaveProperty("chartData");
      expect(stored[0]).not.toHaveProperty("keySpacing");
      expect(stored[0]).not.toHaveProperty("keyDuration");
    });

    it("sorts by timestamp and keeps only the newest 1000 results", () => {
      for (let i = 0; i < 1005; i++) {
        LocalPersistence.appendLocalResult(
          makeResult({ _id: `id_${i}`, timestamp: i }),
        );
      }
      const loaded = LocalPersistence.loadLocalResults();
      expect(loaded).toHaveLength(1000);
      expect(loaded[0]._id).toBe("id_5"); //oldest dropped
      expect(loaded[999]._id).toBe("id_1004"); //newest kept
    });

    it("does not lose previous results on later appends", () => {
      LocalPersistence.appendLocalResult(makeResult({ _id: "a", timestamp: 1 }));
      LocalPersistence.appendLocalResult(makeResult({ _id: "b", timestamp: 2 }));
      const loaded = LocalPersistence.loadLocalResults();
      expect(loaded.map((r) => r._id)).toEqual(["a", "b"]);
    });
  });

  describe("snapshot fields", () => {
    it("returns undefined when nothing is stored", () => {
      expect(LocalPersistence.loadLocalSnapshotFields()).toBeUndefined();
    });

    it("round-trips snapshot fields", () => {
      const snap = {
        personalBests: {
          time: {},
          words: { 10: [{ wpm: 110.81, acc: 85.45, timestamp: 1 }] },
          quote: {},
          zen: {},
          custom: {},
        },
        typingStats: { timeTyping: 5.09, startedTests: 1, completedTests: 1 },
        xp: 0,
        streak: 0,
        maxStreak: 0,
      };
      LocalPersistence.saveLocalSnapshotFields(snap as never);
      const loaded = LocalPersistence.loadLocalSnapshotFields();
      expect(loaded?.typingStats).toEqual(snap.typingStats);
      expect(loaded?.personalBests.words[10][0].wpm).toBe(110.81);
      expect(loaded?.xp).toBe(0);
    });

    it("falls back to defaults for missing fields", () => {
      window.localStorage.setItem(
        "mtDesktopLocalSnapshot",
        JSON.stringify({ xp: 25 }),
      );
      const loaded = LocalPersistence.loadLocalSnapshotFields();
      expect(loaded?.xp).toBe(25);
      expect(loaded?.typingStats).toEqual({
        timeTyping: 0,
        startedTests: 0,
        completedTests: 0,
      });
      expect(loaded?.streak).toBe(0);
      expect(loaded?.maxStreak).toBe(0);
    });

    it("returns undefined on corrupt json", () => {
      window.localStorage.setItem("mtDesktopLocalSnapshot", "{{{");
      expect(LocalPersistence.loadLocalSnapshotFields()).toBeUndefined();
    });
  });
});
