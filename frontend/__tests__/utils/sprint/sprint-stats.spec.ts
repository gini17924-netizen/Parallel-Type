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
let Store!: typeof import("../../../src/ts/utils/sprint/sprint-stats");

async function freshModule(): Promise<void> {
  vi.resetModules();
  Store = await import("../../../src/ts/utils/sprint/sprint-stats");
}

const NOON = new Date("2026-11-07T12:00:00").getTime();

describe("sprint stats store (idea G5 phase 1)", () => {
  beforeEach(async () => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    await freshModule();
  });

  afterEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
  });

  it("keeps the per-language best and stamps it on the record run", () => {
    Store.recordSprintResult({
      lang: "english",
      wpm: 100,
      raw: 110,
      acc: 95,
      daily: false,
      nowMs: NOON,
    });
    Store.recordSprintResult({
      lang: "english",
      wpm: 120,
      raw: 130,
      acc: 96,
      daily: false,
      nowMs: NOON + 1000,
    });
    Store.recordSprintResult({
      lang: "english",
      wpm: 90,
      raw: 95,
      acc: 93,
      daily: false,
      nowMs: NOON + 2000,
    });
    const stats = Store.getSprintStats();
    expect(stats.bestByLang["english"]?.wpm).toBe(120);
    expect(stats.bestByLang["english"]?.at).toBe(NOON + 1000);
  });

  it("keeps the newest 20 history entries", () => {
    for (let i = 1; i <= 25; i++) {
      Store.recordSprintResult({
        lang: "english",
        wpm: i,
        raw: i,
        acc: 90,
        daily: false,
        nowMs: NOON + i * 1000,
      });
    }
    const history = Store.getSprintStats().history;
    expect(history).toHaveLength(20);
    expect(history[0]?.wpm).toBe(25); //most recent
    expect(history[19]?.wpm).toBe(6); //the oldest five are gone
  });

  it("the daily streak grows on consecutive days and resets on a gap", () => {
    //day 1
    Store.recordSprintResult({
      lang: "english",
      wpm: 100,
      raw: 105,
      acc: 95,
      daily: true,
      nowMs: NOON,
    });
    //day 2: consecutive -> streak 2; a same-day rerun only lifts the best
    Store.recordSprintResult({
      lang: "english",
      wpm: 110,
      raw: 115,
      acc: 95,
      daily: true,
      nowMs: NOON + DAY_MS,
    });
    Store.recordSprintResult({
      lang: "english",
      wpm: 130,
      raw: 135,
      acc: 97,
      daily: true,
      nowMs: NOON + DAY_MS + 3600000,
    });
    let daily = Store.getSprintStats().daily;
    expect(daily.streak).toBe(2);
    expect(daily.bestWpm).toBe(130);
    expect(daily.dayKey).toBe(Store.dayKeyOf(NOON + DAY_MS));
    //day 4 (a day skipped): the streak restarts at 1
    Store.recordSprintResult({
      lang: "english",
      wpm: 120,
      raw: 125,
      acc: 95,
      daily: true,
      nowMs: NOON + DAY_MS * 3,
    });
    daily = Store.getSprintStats().daily;
    expect(daily.streak).toBe(1);
    expect(daily.maxStreak).toBe(2);
    expect(daily.done).toBe(true);
  });

  it("non-daily results never touch the daily streak", () => {
    Store.recordSprintResult({
      lang: "english",
      wpm: 100,
      raw: 105,
      acc: 95,
      daily: false,
      nowMs: NOON,
    });
    const daily = Store.getSprintStats().daily;
    expect(daily.done).toBe(false);
    expect(daily.streak).toBe(0);
    expect(daily.dayKey).toBeUndefined();
  });

  it("sanitizer: garbage counters fall back and history entries are validated", () => {
    const sanitized = Store.sanitizeImportedSprintStats({
      bestByLang: {
        english: { wpm: 120, at: 5 },
        oops: "x",
      },
      history: [
        { at: 1, lang: "english", wpm: 100, raw: 110, acc: 95, daily: false },
        "garbage",
      ],
      daily: {
        dayKey: "2026-11-6",
        done: true,
        bestWpm: 110,
        streak: 3,
        maxStreak: 5,
      },
    });
    expect(sanitized["bestByLang"]).toEqual({ english: { wpm: 120, at: 5 } });
    expect(sanitized["history"]).toHaveLength(1);
    expect(sanitized["daily"]).toEqual({
      dayKey: "2026-11-6",
      done: true,
      bestWpm: 110,
      streak: 3,
      maxStreak: 5,
    });
  });

  it("backup round-trip: recorded sprints survive export -> wipe -> import", async () => {
    Store.recordSprintResult({
      lang: "english",
      wpm: 102,
      raw: 110,
      acc: 95,
      daily: true,
      nowMs: NOON,
    });
    const backup = await exportBackup();
    expect(backup.sprintStats).toBeDefined();

    window.localStorage.clear();
    vi.resetModules();
    await importBackup(backup);
    await freshModule();

    const stats = Store.getSprintStats();
    expect(stats.bestByLang["english"]?.wpm).toBe(102);
    expect(stats.history).toHaveLength(1);
    expect(stats.daily.streak).toBe(1);
    expect(stats.daily.done).toBe(true);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
