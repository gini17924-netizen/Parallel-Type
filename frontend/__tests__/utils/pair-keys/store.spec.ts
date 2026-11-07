import { beforeEach, describe, expect, it } from "vitest";

import {
  PAIR_KEYS_STATS_KEY,
  _resetPairKeysForTests,
  getPairKeysBest,
  getPairKeysGames,
  getPairKeysHistory,
  recordPairKeysRun,
  sanitizeImportedPairKeysStats,
} from "../../../src/ts/utils/pair-keys/store";

describe("pair-keys store (idea G18 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetPairKeysForTests();
  });

  it("records the first run as the per-mode best with history", () => {
    const result = recordPairKeysRun({
      mode: "form-name",
      score: 1600,
      moves: 8,
      timeMs: 21000,
      perfect: true,
    });
    expect(result.isNewRecord).toBe(true);
    expect(getPairKeysBest("form-name")?.score).toBe(1600);
    expect(getPairKeysBest("letter")).toBeUndefined(); //per-mode isolation
    expect(getPairKeysGames()).toBe(1);
    expect(getPairKeysHistory()).toHaveLength(1);
  });

  it("keeps the best on a weaker run; history grows newest-first", () => {
    recordPairKeysRun({
      mode: "letter",
      score: 1400,
      moves: 10,
      timeMs: 25000,
      perfect: false,
    });
    const weaker = recordPairKeysRun({
      mode: "letter",
      score: 700,
      moves: 14,
      timeMs: 30000,
      perfect: false,
    });
    expect(weaker.isNewRecord).toBe(false);
    expect(getPairKeysBest("letter")?.score).toBe(1400);
    expect(getPairKeysHistory()[0]?.score).toBe(700);
    expect(getPairKeysGames()).toBe(2);
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordPairKeysRun({
        mode: "letter",
        score: 100 + i,
        moves: 20,
        timeMs: 30000,
        perfect: false,
      });
    }
    const history = getPairKeysHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.score).toBe(111);
    expect(getPairKeysBest("letter")?.score).toBe(111);
  });

  it("the reset hook clears storage and cache", () => {
    recordPairKeysRun({
      mode: "form-name",
      score: 900,
      moves: 11,
      timeMs: 28000,
      perfect: false,
    });
    _resetPairKeysForTests();
    expect(window.localStorage.getItem(PAIR_KEYS_STATS_KEY)).toBeNull();
    expect(getPairKeysBest("form-name")).toBeUndefined();
    expect(getPairKeysGames()).toBe(0);
  });

  it("sanitize drops garbage rows and modes (audit L4)", () => {
    const sanitized = sanitizeImportedPairKeysStats({
      bestByMode: {
        "form-name": { score: 1600, moves: 8, timeMs: 21000 },
        junk: { score: "high" },
      },
      games: 4.7,
      history: [
        {
          at: 10,
          mode: "letter",
          score: 80,
          moves: 18,
          timeMs: 40000,
          perfect: false,
        },
        { junk: true },
      ],
    });
    expect(Object.keys(sanitized.bestByMode)).toEqual(["form-name"]);
    expect(sanitized.games).toBe(4); //floored
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedPairKeysStats(null)).toEqual({
      bestByMode: {},
      games: 0,
      history: [],
    });
  });
});
