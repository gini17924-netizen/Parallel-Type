import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { SnapshotResult } from "../../src/ts/constants/default-snapshot";
import { Mode } from "@monkeytype/schemas/shared";

//the persistence module memoizes its database connection, so every test gets
//a fresh module instance. the fake-indexeddb global store persists across
//resets (like a real browser profile), so tests use disjoint id/timestamp
//ranges and tolerate leftovers.
let LocalPersistence!: typeof import("../../src/ts/utils/local-persistence");

async function freshModule(): Promise<void> {
  vi.resetModules();
  LocalPersistence = await import("../../src/ts/utils/local-persistence");
}

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

describe("LocalPersistence (desktop offline, IndexedDB)", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await freshModule();
  });

  describe("makeLocalResultId", () => {
    it("returns a prefixed id", () => {
      const id = LocalPersistence.makeLocalResultId();
      expect(id.startsWith("local_")).toBe(true);
      expect(id.length).toBeGreaterThan("local_".length);
    });

    it("returns unique ids", () => {
      const ids = new Set(
        Array.from({ length: 50 }, () => LocalPersistence.makeLocalResultId()),
      );
      expect(ids.size).toBe(50);
    });
  });

  describe("loadLocalResults", () => {
    it("returns an empty array when the store is empty", async () => {
      expect(await LocalPersistence.loadLocalResults()).toEqual([]);
    });

    it("returns stored results", async () => {
      await LocalPersistence.appendLocalResult(makeResult({ _id: "r1" }));
      const loaded = await LocalPersistence.loadLocalResults();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]._id).toBe("r1");
    });

    it("returns results sorted oldest first", async () => {
      await LocalPersistence.appendLocalResult(
        makeResult({ _id: "new", timestamp: 2000000000000 }),
      );
      await LocalPersistence.appendLocalResult(
        makeResult({ _id: "old", timestamp: 1800000000000 }),
      );
      const loaded = await LocalPersistence.loadLocalResults();
      const ids = loaded.map((r) => r._id);
      expect(ids.indexOf("old")).toBeLessThan(ids.indexOf("new"));
    });
  });

  describe("appendLocalResult", () => {
    it("strips heavy fields before storing", async () => {
      const result = makeResult({
        _id: "heavy",
        chartData: [[1, 2]] as unknown as SnapshotResult<Mode>["chartData"],
        keySpacing: "toolong" as unknown as SnapshotResult<Mode>["keySpacing"],
        keyDuration: "toolong" as unknown as SnapshotResult<Mode>["keyDuration"],
      });
      await LocalPersistence.appendLocalResult(result);
      const loaded = await LocalPersistence.loadLocalResults();
      const stored = loaded.find((r) => r._id === "heavy") as unknown as Record<
        string,
        unknown
      >;
      expect(stored).toBeDefined();
      expect(stored).not.toHaveProperty("chartData");
      expect(stored).not.toHaveProperty("keySpacing");
      expect(stored).not.toHaveProperty("keyDuration");
    });

    it("keeps the newest 1000 results and drops the oldest", async () => {
      //the cap is global; rows left over from earlier tests shift the
      //drop boundary, so compute it from the live count
      const preCount = (await LocalPersistence.loadLocalResults()).length;
      for (let i = 0; i < 1005; i++) {
        await LocalPersistence.appendLocalResult(
          makeResult({ _id: `cap_${i}`, timestamp: 1600000000000 + i }),
        );
      }
      const overflow = preCount + 1005 - 1000;
      const loaded = await LocalPersistence.loadLocalResults();
      const ids = new Set(loaded.map((r) => r._id));
      expect(loaded).toHaveLength(1000);
      expect(ids.has("cap_0")).toBe(false); //oldest dropped
      expect(ids.has(`cap_${overflow - 1}`)).toBe(false); //last dropped
      expect(ids.has(`cap_${overflow}`)).toBe(true); //first survivor
      expect(ids.has("cap_1004")).toBe(true); //newest kept
    });

    it("upserts: re-appending the same _id does not duplicate", async () => {
      await LocalPersistence.appendLocalResult(
        makeResult({ _id: "dup", wpm: 50, timestamp: 1900000000000 }),
      );
      await LocalPersistence.appendLocalResult(
        makeResult({ _id: "dup", wpm: 70, timestamp: 1900000000001 }),
      );
      const loaded = await LocalPersistence.loadLocalResults();
      const dups = loaded.filter((r) => r._id === "dup");
      expect(dups).toHaveLength(1);
      expect(dups[0].wpm).toBe(70);
    });
  });

  describe("legacy localStorage migration", () => {
    it("migrates 0.1.x results into IndexedDB and removes the legacy key", async () => {
      const legacy = [
        makeResult({ _id: "legacy_a", timestamp: 1750000000000 }),
        makeResult({ _id: "legacy_b", timestamp: 1750000000001 }),
        { broken: true },
      ];
      window.localStorage.setItem(
        "mtDesktopLocalResults",
        JSON.stringify(legacy),
      );
      await freshModule(); //simulate a fresh 0.2.0 boot with 0.1.x data
      const loaded = await LocalPersistence.loadLocalResults();
      const ids = loaded.map((r) => r._id);
      expect(ids).toContain("legacy_a");
      expect(ids).toContain("legacy_b");
      expect(window.localStorage.getItem("mtDesktopLocalResults")).toBeNull();
    });

    it("ignores a corrupt legacy payload", async () => {
      window.localStorage.setItem("mtDesktopLocalResults", "{not json");
      await freshModule();
      await expect(LocalPersistence.loadLocalResults()).resolves.toBeDefined();
      expect(window.localStorage.getItem("mtDesktopLocalResults")).toBeNull();
    });
  });

  describe("results database resilience", () => {
    it("repairs a database that exists at a higher version without the store", async () => {
      //simulate a database left behind by an older/broken build: version 2
      //with no results store. opening must repair instead of throwing
      //VersionError (a fixed-version open would)
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("mtDesktopResults", 2);
        req.onupgradeneeded = () => {
          //intentionally create no stores
        };
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
      await freshModule();

      await LocalPersistence.appendLocalResult(
        makeResult({ _id: "repair_probe", timestamp: 1850000000000 }),
      );
      const loaded = await LocalPersistence.loadLocalResults();
      expect(loaded.map((r) => r._id)).toContain("repair_probe");
    });
  });

  describe("snapshot fields (localStorage)", () => {
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

  describe("backup / restore", () => {
    it("exports results and snapshot fields", async () => {
      //timestamps newer than every other test, so these two are the
      //newest rows of the shared store
      await LocalPersistence.appendLocalResult(
        makeResult({ _id: "bk_1", timestamp: 2100000000001 }),
      );
      await LocalPersistence.appendLocalResult(
        makeResult({ _id: "bk_2", timestamp: 2100000000002 }),
      );
      LocalPersistence.saveLocalSnapshotFields({
        personalBests: {
          time: {},
          words: { 10: [{ wpm: 100, acc: 95, timestamp: 1 }] },
          quote: {},
          zen: {},
          custom: {},
        },
        typingStats: { timeTyping: 12, startedTests: 2, completedTests: 2 },
        xp: 7,
        streak: 1,
        maxStreak: 3,
      } as never);

      const backup = await LocalPersistence.exportBackup();
      expect(backup.schemaVersion).toBe(1);
      //rows from earlier tests may still exist; these two are the newest
      expect(backup.results.slice(-2).map((r) => r._id)).toEqual([
        "bk_1",
        "bk_2",
      ]);
      expect(backup.snapshot?.xp).toBe(7);
      expect(backup.exportedAt).toBeTruthy();
    });

    it("restores a backup, replacing existing data", async () => {
      await LocalPersistence.appendLocalResult(
        makeResult({ _id: "existing", timestamp: 1900000000000 }),
      );
      const backup = {
        schemaVersion: 1,
        exportedAt: "2026-10-27T00:00:00.000Z",
        results: [
          makeResult({ _id: "b_1", timestamp: 1700000000001 }),
          makeResult({ _id: "b_2", timestamp: 1700000000002 }),
        ],
        snapshot: {
          personalBests: {
            time: {},
            words: { 25: [{ wpm: 80, acc: 90, timestamp: 2 }] },
            quote: {},
            zen: {},
            custom: {},
          },
          typingStats: { timeTyping: 30, startedTests: 5, completedTests: 4 },
          xp: 100,
          streak: 2,
          maxStreak: 9,
        },
      };
      const imported = await LocalPersistence.importBackup(backup as never);
      expect(imported).toBe(2);

      const loaded = await LocalPersistence.loadLocalResults();
      expect(loaded.map((r) => r._id)).toEqual(["b_1", "b_2"]); //replaced, not merged
      const snap = LocalPersistence.loadLocalSnapshotFields();
      expect(snap?.xp).toBe(100);
      expect(snap?.personalBests.words[25][0].wpm).toBe(80);
      expect(snap?.typingStats).toEqual({
        timeTyping: 30,
        startedTests: 5,
        completedTests: 4,
      });
    });

    it("caps restored results at 1000", async () => {
      const results = Array.from({ length: 1005 }, (_, i) =>
        makeResult({ _id: `imp_${i}`, timestamp: 1600000000000 + i }),
      );
      const imported = await LocalPersistence.importBackup({
        schemaVersion: 1,
        exportedAt: "2026-10-27T00:00:00.000Z",
        results,
      } as never);
      expect(imported).toBe(1000);
      const loaded = await LocalPersistence.loadLocalResults();
      expect(loaded).toHaveLength(1000);
      expect(loaded[0]._id).toBe("imp_5"); //oldest dropped
    });

    it("strips heavy fields on restore", async () => {
      const imported = await LocalPersistence.importBackup({
        schemaVersion: 1,
        exportedAt: "2026-10-27T00:00:00.000Z",
        results: [
          makeResult({
            _id: "heavy_restore",
            chartData: [[1]] as unknown as SnapshotResult<Mode>["chartData"],
            keySpacing: "toolong" as unknown as SnapshotResult<Mode>["keySpacing"],
          }),
        ],
      } as never);
      expect(imported).toBe(1);
      const loaded = await LocalPersistence.loadLocalResults();
      const stored = loaded[0] as unknown as Record<string, unknown>;
      expect(stored).not.toHaveProperty("chartData");
      expect(stored).not.toHaveProperty("keySpacing");
    });

    it("throws on an invalid backup", async () => {
      await expect(
        LocalPersistence.importBackup({ hello: 1 } as never),
      ).rejects.toThrow("Invalid backup file");
      await expect(
        LocalPersistence.importBackup({ schemaVersion: 99, results: [] } as never),
      ).rejects.toThrow("Invalid backup file");
    });
  });
});
