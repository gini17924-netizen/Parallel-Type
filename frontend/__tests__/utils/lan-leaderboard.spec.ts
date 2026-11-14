import { beforeEach, describe, expect, it } from "vitest";

import {
  clearLanChat,
  getLanChatLog,
  sendLanChat,
} from "../../src/ts/states/lan-chat";
import {
  gauntletBoardFor,
  hydrateGauntletBoard,
  receiveGauntletResult,
  recordGauntletResult,
  resetGauntletBoard,
} from "../../src/ts/utils/lan/leaderboard";

describe("phase 84 — the gauntlet comparison board", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetGauntletBoard();
    hydrateGauntletBoard();
    clearLanChat();
  });

  it("keeps each name's BEST run per day", () => {
    recordGauntletResult({
      name: "P1",
      dayKey: "2026-11-14",
      stages: 2,
      score: 300,
      timestamp: 1,
    });
    recordGauntletResult({
      name: "P1",
      dayKey: "2026-11-14",
      stages: 3,
      score: 500,
      timestamp: 2,
    });
    recordGauntletResult({
      name: "P1",
      dayKey: "2026-11-14",
      stages: 1,
      score: 120,
      timestamp: 3,
    });
    const rows = gauntletBoardFor("2026-11-14");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ name: "P1", stages: 3, score: 500 });
  });

  it("ranks the day's rows strongest first", () => {
    recordGauntletResult({
      name: "slow",
      dayKey: "2026-11-14",
      stages: 1,
      score: 90,
      timestamp: 1,
    });
    recordGauntletResult({
      name: "fast",
      dayKey: "2026-11-14",
      stages: 3,
      score: 610,
      timestamp: 2,
    });
    const rows = gauntletBoardFor("2026-11-14");
    expect(rows.map((r) => r.name)).toEqual(["fast", "slow"]);
  });

  it("a different day is a different table", () => {
    recordGauntletResult({
      name: "P1",
      dayKey: "2026-11-14",
      stages: 3,
      score: 500,
      timestamp: 1,
    });
    expect(gauntletBoardFor("2026-11-15")).toEqual([]);
    expect(gauntletBoardFor("2026-11-14")).toHaveLength(1);
  });

  it("the wire receiver clamps the stages and prefers the roster name", () => {
    receiveGauntletResult(
      { dayKey: "2026-11-14", stages: 99, score: 400, name: "claimed" },
      2,
    );
    const rows = gauntletBoardFor("2026-11-14");
    expect(rows[0]?.stages).toBe(3); //99 clamped to the 3-stage max
  });

  it("a wire row without a score is dropped", () => {
    receiveGauntletResult({ dayKey: "2026-11-14", stages: 2, name: "x" }, 1);
    expect(gauntletBoardFor("2026-11-14")).toEqual([]);
  });
});

describe("phase 80 cross-check — the chat log isolation", () => {
  it("chat and the gauntlet board stay independent", () => {
    sendLanChat("hello");
    receiveGauntletResult(
      { dayKey: "2026-11-14", stages: 2, score: 300, name: "P2" },
      2,
    );
    expect(getLanChatLog()[0]?.text).toBe("hello");
    expect(gauntletBoardFor("2026-11-14")[0]?.score).toBe(300);
  });
});
