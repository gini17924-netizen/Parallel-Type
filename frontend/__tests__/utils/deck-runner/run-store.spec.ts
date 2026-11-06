import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  _resetDeckRunnerStoresForTests,
  clearActiveRun,
  DECK_RUNNER_RUN_KEY,
  DECK_RUNNER_STATS_KEY,
  getDeckRunnerStats,
  loadActiveRun,
  recordRunEnd,
  saveActiveRun,
} from "../../../src/ts/utils/deck-runner/run-store";

function makeRun(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    seed: 1234,
    language: "english",
    wordSourceId: "en-1k",
    phase: "blind",
    ante: 2,
    blindIndex: 1,
    gold: 9,
    jokers: ["greedy_fox"],
    rerolls: 0,
    score: 0,
    totalScore: 420,
    wordsTyped: 60,
    goldFromWords: 0,
    lastRound: { score: 420, won: true, gold: 5 },
    updatedAt: 1700000000000,
    ...overrides,
  };
}

describe("deck-runner run-store (G24 phase 2)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetDeckRunnerStoresForTests();
  });

  //leave a clean shared fake-indexeddb factory behind: this file populates
  //rows and the jsx-pool app-shell spec asserts loading-bar state on a
  //pristine store (KI-28 cross-file leakage class)
  afterEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
  });

  it("save/load round-trips the active run", () => {
    const run = makeRun();
    saveActiveRun(run as never);
    expect(loadActiveRun()).toEqual(run);
  });

  it("a malformed stored payload falls back to null instead of crashing", () => {
    window.localStorage.setItem(DECK_RUNNER_RUN_KEY, "{not json");
    expect(loadActiveRun()).toBeNull();
  });

  it("clearActiveRun removes the resumable run", () => {
    saveActiveRun(makeRun() as never);
    clearActiveRun();
    expect(loadActiveRun()).toBeNull();
  });

  it("recordRunEnd updates counters, bests, dailyBest and keeps history at 10", () => {
    for (let i = 0; i < 12; i++) {
      recordRunEnd({
        date: `2026-11-0${(i % 7) + 1}T10:00:00.000Z`,
        ante: i + 1,
        score: 100 * (i + 1),
        won: i % 2 === 0,
        jokers: ["greedy_fox"],
      });
    }
    const stats = getDeckRunnerStats();
    expect(stats.runs).toBe(12);
    expect(stats.wins).toBe(6);
    expect(stats.bestScore).toBe(1200);
    expect(stats.bestAnte).toBe(12);
    expect(stats.history).toHaveLength(10); //capped
    expect(stats.dailyBest).toBeDefined();
  });

  it("backup v3 round-trips the run and stats", async () => {
    const { exportBackup, importBackup } =
      await import("../../../src/ts/utils/local-persistence");
    saveActiveRun(makeRun() as never);
    recordRunEnd({
      date: "2026-11-07T10:00:00.000Z",
      ante: 3,
      score: 900,
      won: true,
      jokers: ["greedy_fox"],
    });
    const backup = await exportBackup();
    expect(backup.deckRunnerRun).toBeDefined();
    expect(backup.deckRunnerStats).toBeDefined();

    //wipe + restore
    clearActiveRun();
    window.localStorage.removeItem(DECK_RUNNER_STATS_KEY);
    await importBackup(backup);
    expect(loadActiveRun()?.ante).toBe(2);
    expect(getDeckRunnerStats().bestScore).toBe(900);
  });

  it("a v1 backup without the deck fields keeps current values (absent = keep)", async () => {
    const { importBackup } =
      await import("../../../src/ts/utils/local-persistence");
    saveActiveRun(makeRun() as never);
    recordRunEnd({
      date: "2026-11-07T10:00:00.000Z",
      ante: 3,
      score: 900,
      won: true,
      jokers: [],
    });
    const v1Backup = {
      schemaVersion: 1,
      exportedAt: "2026-11-05T00:00:00.000Z",
      results: [],
      snapshot: undefined,
    };
    await importBackup(v1Backup as never);
    expect(loadActiveRun()?.ante).toBe(2); //untouched
    expect(getDeckRunnerStats().runs).toBe(1);
  });
});
