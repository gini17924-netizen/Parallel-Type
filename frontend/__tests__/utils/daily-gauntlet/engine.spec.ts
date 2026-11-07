import { describe, expect, it } from "vitest";

import {
  advanceGauntlet,
  checkGauntletDay,
  createGauntlet,
  currentStage,
  gauntletTotal,
  voidGauntlet,
  type GauntletState,
} from "../../../src/ts/utils/daily-gauntlet/engine";
import type {
  DailyStage,
  DailyStageResult,
} from "../../../src/ts/utils/games/game-registry";

const STAGES: DailyStage[] = [
  { gameId: "word-blast", title: "word blast", seed: 1, params: {} },
  { gameId: "sprint", title: "sprint", seed: 2, params: {} },
  { gameId: "bot-duel", title: "bot duel", seed: 3, params: {} },
];

function result(gameId: string, normalized: number): DailyStageResult {
  return {
    gameId,
    normalized,
    raw: { score: normalized },
    won: normalized > 500,
  };
}

function playedAll(): GauntletState {
  let state = createGauntlet("2026-11-08", STAGES);
  state = advanceGauntlet(state, result("word-blast", 600));
  state = advanceGauntlet(state, result("sprint", 700));
  state = advanceGauntlet(state, result("bot-duel", 800));
  return state;
}

describe("gauntlet engine (idea G22 phase 3)", () => {
  it("a fresh gauntlet is ready with the first stage current", () => {
    const state = createGauntlet("2026-11-08", STAGES);
    expect(state.phase).toBe("ready");
    expect(state.locked).toBe(false);
    expect(currentStage(state)?.gameId).toBe("word-blast");
    expect(gauntletTotal(state)).toBe(0);
  });

  it("each advance locks the day and totals the normalizeds", () => {
    let state = createGauntlet("2026-11-08", STAGES);
    state = advanceGauntlet(state, result("word-blast", 600));
    expect(state.locked).toBe(true); //locked after stage 1 (doc §۰.۵)
    expect(state.phase).toBe("between");
    expect(currentStage(state)?.gameId).toBe("sprint"); //resume target
    expect(gauntletTotal(state)).toBe(600);
    state = advanceGauntlet(state, result("sprint", 700));
    state = advanceGauntlet(state, result("bot-duel", 800));
    expect(state.phase).toBe("complete");
    expect(state.stageIndex).toBe(3);
    expect(gauntletTotal(state)).toBe(2100);
    expect(currentStage(state)).toBeUndefined();
  });

  it("a normalized outside 0..1000 clamps", () => {
    let state = createGauntlet("2026-11-08", STAGES);
    state = advanceGauntlet(state, result("word-blast", 5000));
    expect(state.results[0]?.normalized).toBe(1000);
    state = advanceGauntlet(state, result("sprint", -20));
    expect(state.results[1]?.normalized).toBe(0);
  });

  it("a result for the wrong stage is ignored", () => {
    let state = createGauntlet("2026-11-08", STAGES);
    state = advanceGauntlet(state, result("sprint", 700)); //stage 0 is blast
    expect(state.results).toHaveLength(0);
    expect(state.phase).toBe("ready");
    expect(state.locked).toBe(false); //nothing happened — no lock
  });

  it("advancing past completion changes nothing", () => {
    const state = playedAll();
    const again = advanceGauntlet(state, result("word-blast", 1));
    expect(again).toEqual(state);
  });

  it("the dayKey rolling over mid-run voids with a reason", () => {
    let state = createGauntlet("2026-11-08", STAGES);
    state = advanceGauntlet(state, result("word-blast", 600));
    const voided = checkGauntletDay(state, "2026-11-09");
    expect(voided.phase).toBe("voided");
    expect(voided.voidReason).toContain("rolled over");
    //the data stays for the record page, but a voided run never records
    expect(gauntletTotal(voided)).toBe(600);
    //a complete day survives the rollover check
    const done = playedAll();
    expect(checkGauntletDay(done, "2026-11-09").phase).toBe("complete");
  });

  it("an explicit void marks the phase without erasing the day", () => {
    let state = createGauntlet("2026-11-08", STAGES);
    state = voidGauntlet(state, "test");
    expect(state.phase).toBe("voided");
    expect(currentStage(state)).toBeUndefined();
  });

  it("the state round-trips through JSON (the resume rule)", () => {
    let state = createGauntlet("2026-11-08", STAGES);
    state = advanceGauntlet(state, result("word-blast", 600));
    const revived = structuredClone(state);
    expect(revived).toEqual(state);
    const next = advanceGauntlet(revived, result("sprint", 700));
    expect(next.results).toHaveLength(2);
    expect(next.locked).toBe(true);
  });
});
