import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import {
  exportBackup,
  importBackup,
} from "../../../src/ts/utils/local-persistence";

//the modules memoize their storage wrappers (cache inside
//LocalStorageWithSchema), so every test gets fresh module instances —
//same convention as word-blast-scores.spec.ts
let Store!: typeof import("../../../src/ts/utils/wordle/wordle-store");

async function freshModule(): Promise<void> {
  vi.resetModules();
  Store = await import("../../../src/ts/utils/wordle/wordle-store");
}

describe("wordle stores (idea G4 phase 1)", () => {
  beforeEach(async () => {
    //exportBackup reads the IndexedDB results store: fake-indexeddb with a
    //fresh factory per test (the cross-file leakage vaccination)
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    await freshModule();
  });

  afterEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
  });

  it("keeps fa and en states fully isolated", () => {
    Store.saveWordleState("fa", {
      dayKey: "2026-11-7",
      lang: "fa",
      guesses: ["سلام‌ها"],
      finished: null,
    });
    Store.saveWordleState("en", {
      dayKey: "2026-11-7",
      lang: "en",
      guesses: ["crane"],
      finished: "won",
    });
    expect(Store.loadWordleState("fa", "2026-11-7").guesses).toEqual(["سلام‌ها"]);
    expect(Store.loadWordleState("en", "2026-11-7").finished).toBe("won");
  });

  it("a new dayKey rolls the puzzle state over", () => {
    Store.saveWordleState("en", {
      dayKey: "2026-11-6",
      lang: "en",
      guesses: ["crane"],
      finished: null,
    });
    const rolled = Store.loadWordleState("en", "2026-11-7");
    expect(rolled).toEqual({
      dayKey: "2026-11-7",
      lang: "en",
      guesses: [],
      finished: null,
    });
  });

  it("records wins: streak extends on consecutive days, restarts on a gap", () => {
    Store.recordWordleGame({
      lang: "en",
      dayKey: "2026-11-5",
      won: true,
      guessCount: 4,
    });
    Store.recordWordleGame({
      lang: "en",
      dayKey: "2026-11-6",
      won: true,
      guessCount: 3,
    });
    let stats = Store.getWordleStats("en");
    expect(stats.played).toBe(2);
    expect(stats.won).toBe(2);
    expect(stats.streak).toBe(2);
    expect(stats.maxStreak).toBe(2);
    expect(stats.distribution).toEqual([0, 0, 1, 1, 0, 0]);

    //a gap day: the streak restarts
    Store.recordWordleGame({
      lang: "en",
      dayKey: "2026-11-9",
      won: true,
      guessCount: 5,
    });
    stats = Store.getWordleStats("en");
    expect(stats.streak).toBe(1);
    expect(stats.maxStreak).toBe(2);
    expect(stats.distribution).toEqual([0, 0, 1, 1, 1, 0]);
  });

  it("a loss zeroes the streak without touching the distribution", () => {
    Store.recordWordleGame({
      lang: "en",
      dayKey: "2026-11-5",
      won: true,
      guessCount: 2,
    });
    Store.recordWordleGame({
      lang: "en",
      dayKey: "2026-11-6",
      won: false,
      guessCount: 6,
    });
    const stats = Store.getWordleStats("en");
    expect(stats.played).toBe(2);
    expect(stats.won).toBe(1);
    expect(stats.streak).toBe(0);
    //the distribution counts wins by guess count only
    expect(stats.distribution).toEqual([0, 1, 0, 0, 0, 0]);
    //a loss does not plant the last-completed day: the next win restarts
    Store.recordWordleGame({
      lang: "en",
      dayKey: "2026-11-7",
      won: true,
      guessCount: 6,
    });
    expect(Store.getWordleStats("en").streak).toBe(1);
  });

  it("per-language stats live in their own keys", () => {
    Store.recordWordleGame({
      lang: "fa",
      dayKey: "2026-11-6",
      won: true,
      guessCount: 3,
    });
    expect(Store.getWordleStats("en").played).toBe(0);
    expect(Store.getWordleStats("fa").played).toBe(1);
  });

  it("backup round-trip: both languages survive export -> wipe -> import", async () => {
    Store.saveWordleState("en", {
      dayKey: "2026-11-7",
      lang: "en",
      guesses: ["crane"],
      finished: null,
    });
    Store.recordWordleGame({
      lang: "en",
      dayKey: "2026-11-7",
      won: true,
      guessCount: 4,
    });
    Store.recordWordleGame({
      lang: "fa",
      dayKey: "2026-11-7",
      won: false,
      guessCount: 6,
    });
    const backup = await exportBackup();
    expect(backup.wordleState).toBeDefined();
    expect(backup.wordleStats).toBeDefined();

    window.localStorage.clear();
    vi.resetModules();
    await importBackup(backup);
    await freshModule();

    expect(Store.loadWordleState("en", "2026-11-7").guesses).toEqual(["crane"]);
    expect(Store.getWordleStats("en").played).toBe(1);
    expect(Store.getWordleStats("en").streak).toBe(1);
    expect(Store.getWordleStats("fa").played).toBe(1);
    expect(Store.getWordleStats("fa").streak).toBe(0);
  });
});
