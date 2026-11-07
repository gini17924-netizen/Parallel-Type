import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import {
  exportBackup,
  importBackup,
} from "../../../src/ts/utils/local-persistence";

//the module memoizes its storage wrapper, so every test gets a fresh module
//instance — same convention as word-blast-scores.spec.ts
let Store!: typeof import("../../../src/ts/utils/balloon-pop/store");

async function freshModule(): Promise<void> {
  vi.resetModules();
  Store = await import("../../../src/ts/utils/balloon-pop/store");
}

describe("balloon-pop scores store (idea G6 phase 1)", () => {
  beforeEach(async () => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    await freshModule();
  });

  afterEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
  });

  it("starts empty", () => {
    expect(Store.getBalloonPopStats()).toEqual({
      bestByStage: {},
      history: [],
    });
  });

  it("keeps the per-stage best and prepends the history newest-first", () => {
    Store.recordBalloonRun({
      stage: 2,
      score: 900,
      popped: 20,
      escaped: 3,
      nowMs: 1000,
    });
    Store.recordBalloonRun({
      stage: 2,
      score: 1400,
      popped: 30,
      escaped: 1,
      nowMs: 2000,
    });
    Store.recordBalloonRun({
      stage: 2,
      score: 1200,
      popped: 25,
      escaped: 2,
      nowMs: 3000,
    });
    const stats = Store.getBalloonPopStats();
    expect(stats.bestByStage["2"]).toEqual({ score: 1400, at: 2000 });
    expect(stats.history).toHaveLength(3);
    expect(stats.history[0]?.score).toBe(1200); //most recent
    expect(stats.history[2]?.score).toBe(900); //oldest
  });

  it("different stages keep independent bests and the history trims to 10", () => {
    for (let i = 1; i <= 12; i++) {
      Store.recordBalloonRun({
        stage: (i % 4) + 1,
        score: i * 100,
        popped: i,
        escaped: 0,
        nowMs: i * 1000,
      });
    }
    const stats = Store.getBalloonPopStats();
    expect(stats.history).toHaveLength(10);
    expect(stats.bestByStage["1"]).toBeDefined();
    expect(stats.bestByStage["2"]).toBeDefined();
    expect(stats.bestByStage["3"]).toBeDefined();
    expect(stats.bestByStage["4"]).toBeDefined();
  });

  it("sanitizer drops garbage stages and entries", () => {
    const sanitized = Store.sanitizeImportedBalloonPopScores({
      bestByStage: {
        "2": { score: 1400, at: 2000 },
        oops: "x",
      },
      history: [
        { at: 1, stage: 2, score: 1400, popped: 30, escaped: 1 },
        "garbage",
      ],
    });
    expect(Object.keys(sanitized["bestByStage"] as object)).toEqual(["2"]);
    expect(sanitized["history"]).toHaveLength(1);
    expect(Store.sanitizeImportedBalloonPopScores("nope")).toEqual({
      bestByStage: {},
      history: [],
    });
  });

  it("backup round-trip: recorded runs survive export -> wipe -> import", async () => {
    Store.recordBalloonRun({
      stage: 3,
      score: 2200,
      popped: 40,
      escaped: 2,
      nowMs: 5000,
    });
    const backup = await exportBackup();
    expect(backup.balloonPopScores).toBeDefined();

    window.localStorage.clear();
    vi.resetModules();
    await importBackup(backup);
    await freshModule();

    const stats = Store.getBalloonPopStats();
    expect(stats.bestByStage["3"]).toEqual({ score: 2200, at: 5000 });
    expect(stats.history).toHaveLength(1);
    expect(stats.history[0]?.popped).toBe(40);
  });
});
