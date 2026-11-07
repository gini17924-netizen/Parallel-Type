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
let Store!: typeof import("../../../src/ts/utils/bot-duel/duel-store");

async function freshModule(): Promise<void> {
  vi.resetModules();
  Store = await import("../../../src/ts/utils/bot-duel/duel-store");
}

describe("bot-duel stats store (idea G2 phase 2)", () => {
  beforeEach(async () => {
    //fresh IndexedDB per test: exportBackup reads the results store, and
    //fake-indexeddb's global factory persists across files like a profile
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    await freshModule();
  });

  afterEach(() => {
    //leave a clean shared factory behind (cross-file leakage vaccination)
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
  });

  it("starts empty: no tier records, no history", () => {
    expect(Store.getBotDuelStats().byTier).toEqual({});
    expect(Store.getBotDuelStats().history).toEqual([]);
    expect(Store.getBotDuelTierStats("60")).toEqual({
      wins: 0,
      losses: 0,
      draws: 0,
      bestFinishMs: null,
    });
  });

  it("accumulates wins/losses/draws per tier independently", () => {
    Store.recordDuelResult({
      botWpm: 60,
      words: 30,
      result: "won",
      finishMs: 21000,
      accuracy: 97,
    });
    Store.recordDuelResult({
      botWpm: 60,
      words: 30,
      result: "won",
      finishMs: 19500,
      accuracy: 95,
    });
    Store.recordDuelResult({
      botWpm: 60,
      words: 30,
      result: "lost",
      finishMs: null,
      accuracy: 80,
    });
    Store.recordDuelResult({
      botWpm: 60,
      words: 30,
      result: "draw",
      finishMs: 20000,
      accuracy: 90,
    });
    Store.recordDuelResult({
      botWpm: 100,
      words: 30,
      result: "lost",
      finishMs: null,
      accuracy: 85,
    });

    const tier60 = Store.getBotDuelTierStats("60");
    expect(tier60.wins).toBe(2);
    expect(tier60.losses).toBe(1);
    expect(tier60.draws).toBe(1);
    //the fastest win is kept, the slower one and the loss do not touch it
    expect(tier60.bestFinishMs).toBe(19500);
    expect(Store.getBotDuelTierStats("100").losses).toBe(1);
    expect(Store.getBotDuelTierStats("100").wins).toBe(0);
    //a loss never plants a finish time
    expect(Store.getBotDuelTierStats("100").bestFinishMs).toBeNull();
  });

  it("keeps the recent history newest-first and trims it to 10", () => {
    for (let i = 1; i <= 12; i++) {
      Store.recordDuelResult({
        botWpm: 60,
        words: 30,
        result: i % 2 === 0 ? "won" : "lost",
        finishMs: i % 2 === 0 ? 20000 + i : null,
        accuracy: 90,
      });
    }
    const history = Store.getBotDuelStats().history;
    expect(history).toHaveLength(10);
    expect(history[0]?.result).toBe("won"); //the 12th (most recent) race
    expect(history[1]?.result).toBe("lost");
    //the oldest two are gone
    expect(history[9]?.result).toBe("lost");
  });

  it("sanitizes an imported payload: garbage tiers and entries are dropped", () => {
    const sanitized = Store.sanitizeImportedBotDuelStats({
      byTier: {
        "60": { wins: 2, losses: 1, draws: 0, bestFinishMs: 19500 },
        oops: "garbage",
      },
      history: [
        {
          at: 1,
          botWpm: 60,
          words: 30,
          result: "won",
          finishMs: 21000,
          accuracy: 97,
        },
        "garbage",
      ],
      extra: "ignored",
    });
    expect(Object.keys(sanitized["byTier"] as object)).toEqual(["60"]);
    expect(sanitized["history"]).toHaveLength(1);
    //a non-object payload produces the empty shape
    expect(Store.sanitizeImportedBotDuelStats("nope")).toEqual({
      byTier: {},
      history: [],
    });
  });

  it("backup round-trip: recorded results survive export -> wipe -> import", async () => {
    Store.recordDuelResult({
      botWpm: 60,
      words: 30,
      result: "won",
      finishMs: 21000,
      accuracy: 97,
    });
    Store.recordDuelResult({
      botWpm: 100,
      words: 30,
      result: "lost",
      finishMs: null,
      accuracy: 91,
    });
    const backup = await exportBackup();
    expect(backup.botDuelStats).toBeDefined();

    //everything is gone, then the backup brings it back
    window.localStorage.clear();
    vi.resetModules();
    await importBackup(backup);
    await freshModule();

    expect(Store.getBotDuelTierStats("60")?.wins).toBe(1);
    expect(Store.getBotDuelTierStats("60")?.bestFinishMs).toBe(21000);
    expect(Store.getBotDuelTierStats("100")?.losses).toBe(1);
    expect(Store.getBotDuelStats().history).toHaveLength(2);
    expect(Store.getBotDuelStats().history[0]?.accuracy).toBe(91);
  });
});
