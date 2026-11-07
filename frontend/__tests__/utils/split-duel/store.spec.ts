import { beforeEach, describe, expect, it } from "vitest";

import {
  DUEL_LOCAL_STATS_KEY,
  _resetDuelStatsForTests,
  getDuelHistory,
  getDuelMatches,
  getDuelWinsBySlot,
  recordDuelMatch,
  sanitizeImportedDuelStats,
} from "../../../src/ts/utils/split-duel/store";

describe("split-duel store (idea G19 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetDuelStatsForTests();
  });

  it("records a match: the win counters, the total and the history", () => {
    recordDuelMatch({ mode: "simultaneous", winnerSlot: 1, marginMs: 1200 });
    recordDuelMatch({ mode: "turn", winnerSlot: 2, marginMs: 300 });
    recordDuelMatch({ mode: "simultaneous", winnerSlot: 0, marginMs: 0 });
    expect(getDuelMatches()).toBe(3);
    const wins = getDuelWinsBySlot();
    expect(wins["1"]).toBe(1);
    expect(wins["2"]).toBe(1);
    expect(getDuelHistory()).toHaveLength(3);
    expect(getDuelHistory()[0]?.winnerSlot).toBe(0); //newest first
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordDuelMatch({ mode: "turn", winnerSlot: 1, marginMs: i * 10 });
    }
    const history = getDuelHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.marginMs).toBe(110);
    expect(getDuelWinsBySlot()["1"]).toBe(12);
  });

  it("the reset hook clears storage and cache", () => {
    recordDuelMatch({ mode: "turn", winnerSlot: 1, marginMs: 50 });
    _resetDuelStatsForTests();
    expect(window.localStorage.getItem(DUEL_LOCAL_STATS_KEY)).toBeNull();
    expect(getDuelMatches()).toBe(0);
  });

  it("sanitize drops garbage rows and clamps the counters (audit L4)", () => {
    const sanitized = sanitizeImportedDuelStats({
      matches: 7.9,
      winsBySlot: { "1": 4, "2": -3 },
      history: [
        { at: 10, mode: "turn", winnerSlot: 2, marginMs: 400 },
        { junk: true },
        { at: 11, mode: "bogus", winnerSlot: 1, marginMs: 1 },
      ],
    });
    expect(sanitized.matches).toBe(7);
    expect(sanitized.winsBySlot).toEqual({ "1": 4, "2": 0 });
    expect(sanitized.history).toHaveLength(1);
    expect(sanitizeImportedDuelStats(null)).toEqual({
      matches: 0,
      winsBySlot: { "1": 0, "2": 0 },
      history: [],
    });
  });
});
