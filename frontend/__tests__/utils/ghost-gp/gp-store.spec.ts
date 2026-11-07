import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import {
  exportBackup,
  importBackup,
} from "../../../src/ts/utils/local-persistence";

//the module memoizes its storage wrapper (cache inside
//LocalStorageWithSchema), so every test gets a fresh module instance —
//same convention as word-blast-scores.spec.ts
let Store!: typeof import("../../../src/ts/utils/ghost-gp/gp-store");

async function freshModule(): Promise<void> {
  vi.resetModules();
  Store = await import("../../../src/ts/utils/ghost-gp/gp-store");
}

describe("ghost-gp stats store (idea G3 phase 1)", () => {
  beforeEach(async () => {
    //exportBackup reads the IndexedDB results store: fake-indexeddb with a
    //fresh factory per test (the cross-file leakage vaccination)
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    await freshModule();
  });

  afterEach(() => {
    //leave a clean shared factory behind (cross-file leakage vaccination)
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
  });

  it("starts at the zeroed counters", () => {
    expect(Store.getGhostGpStats()).toEqual({
      races: 0,
      winsVsGhost: 0,
      losses: 0,
      draws: 0,
      bestFinishMs: null,
      ghostsRaced: [],
    });
  });

  it("accumulates races and keeps the fastest WON finish across ghosts", () => {
    Store.recordGhostRace({
      result: "won",
      finishMs: 14000,
      ghostWpm: 80,
      lang: "english",
    });
    Store.recordGhostRace({
      result: "won",
      finishMs: 12500,
      ghostWpm: 60,
      lang: "english",
    });
    Store.recordGhostRace({
      result: "lost",
      finishMs: null,
      ghostWpm: 120,
      lang: "english",
    });
    Store.recordGhostRace({
      result: "draw",
      finishMs: 13000,
      ghostWpm: 100,
      lang: "persian",
    });

    const stats = Store.getGhostGpStats();
    expect(stats.races).toBe(4);
    expect(stats.winsVsGhost).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.draws).toBe(1);
    expect(stats.bestFinishMs).toBe(12500); //the loss and draw never plant it
    expect(stats.ghostsRaced).toHaveLength(4);
    expect(stats.ghostsRaced[0]).toEqual({
      wpm: 100,
      lang: "persian",
      at: expect.any(Number),
    });
  });

  it("trims the recently-raced ghosts to 10", () => {
    for (let i = 1; i <= 12; i++) {
      Store.recordGhostRace({
        result: i % 3 === 0 ? "lost" : "won",
        finishMs: i % 3 === 0 ? null : 10000 + i * 100,
        ghostWpm: 40 + i,
        lang: "english",
      });
    }
    const ghosts = Store.getGhostGpStats().ghostsRaced;
    expect(ghosts).toHaveLength(10);
    expect(ghosts[0]?.wpm).toBe(52); //the 12th (most recent) race
    expect(ghosts[9]?.wpm).toBe(43); //the 3rd race; the first two are gone
    expect(Store.getGhostGpStats().races).toBe(12); //races count everything
  });

  it("sanitizer: garbage counters fall back and ghost entries are validated", () => {
    const sanitized = Store.sanitizeImportedGhostGpStats({
      races: 5,
      winsVsGhost: "oops",
      losses: 2,
      bestFinishMs: 9000,
      ghostsRaced: [
        { wpm: 60, lang: "english", at: 7 },
        "garbage",
        { wpm: "x", lang: "english", at: 8 },
      ],
    });
    expect(sanitized).toEqual({
      races: 5,
      winsVsGhost: 0,
      losses: 2,
      draws: 0,
      bestFinishMs: 9000,
      ghostsRaced: [{ wpm: 60, lang: "english", at: 7 }],
    });
    expect(Store.sanitizeImportedGhostGpStats("nope")["ghostsRaced"]).toEqual(
      [],
    );
  });

  it("backup round-trip: recorded races survive export -> wipe -> import", async () => {
    Store.recordGhostRace({
      result: "won",
      finishMs: 12500,
      ghostWpm: 60,
      lang: "english",
    });
    Store.recordGhostRace({
      result: "lost",
      finishMs: null,
      ghostWpm: 120,
      lang: "persian",
    });
    const backup = await exportBackup();
    expect(backup.ghostGpStats).toBeDefined();

    window.localStorage.clear();
    vi.resetModules();
    await importBackup(backup);
    await freshModule();

    const stats = Store.getGhostGpStats();
    expect(stats.races).toBe(2);
    expect(stats.winsVsGhost).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.bestFinishMs).toBe(12500);
    expect(stats.ghostsRaced).toHaveLength(2);
  });
});
