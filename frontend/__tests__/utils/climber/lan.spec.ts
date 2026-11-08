import { beforeEach, describe, expect, it } from "vitest";

import {
  climberLanWordFor,
  lanClimber,
  resolveClimberVerdict,
  type ClimberRemoteState,
} from "../../../src/ts/utils/climber/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("climber LanPlayable (online wave, phase 15)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanClimber);
  });

  it("is a registry member with the climber route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("climber");
    const game = getLanGame("climber");
    expect(game?.route).toBe("/games/climber");
    expect(game?.label).toBe("sky climber");
    expect(game?.icon).toBe("fa-arrow-up");
  });

  it("buildStart seeds the match and carries lang + target height", () => {
    const start = lanClimber.buildStart({ lang: "farsi", height: 40 });
    expect(start.gameId).toBe("climber");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", height: 40 });
  });

  it("buildStart applies the documented defaults", () => {
    const start = lanClimber.buildStart({});
    expect(start.params).toEqual({ lang: "english", height: 30 });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanClimber.buildStart({ lang: "english", height: 30 });
    expect(lanClimber.validateStart(good)).toBe(true);
    expect(lanClimber.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanClimber.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(lanClimber.validateStart({ ...good, params: { height: 30 } })).toBe(
      false,
    );
  });

  it("the seeded word-for is deterministic and stable per index", () => {
    const pool = ["alpha", "beta", "gamma", "delta"];
    const wordForA = climberLanWordFor(pool, 55);
    const wordForB = climberLanWordFor(pool, 55);
    //same seed -> the identical platform words at every index
    for (const index of [0, 1, 2, 5, 9]) {
      expect(wordForA(index)).toBe(wordForB(index));
    }
    //a different seed reshuffles
    const wordForC = climberLanWordFor(pool, 56);
    expect([0, 1, 2, 3].some((i) => wordForA(i) !== wordForC(i))).toBe(true);
  });

  it("climberLanWordFor survives an empty pool with a fallback", () => {
    const wordFor = climberLanWordFor([], 7);
    expect(wordFor(0)).toBe("climb");
    expect(wordFor(2)).toBe("fast");
    expect(wordFor(3)).toBe("climb"); //the 3-word fallback cycles
  });

  it("the finish-line verdict: the lower finish time wins", () => {
    expect(resolveClimberVerdict({ finishMs: 8000 }, { finishMs: 9000 })).toBe(
      "won",
    );
    expect(resolveClimberVerdict({ finishMs: 9000 }, { finishMs: 8000 })).toBe(
      "lost",
    );
    expect(resolveClimberVerdict({ finishMs: 8000 }, { finishMs: 8000 })).toBe(
      "draw",
    );
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanClimber.encodeProgress({ height: 12, score: 340 })).toEqual({
      height: 12,
      score: 340,
    });
    expect(lanClimber.encodeProgress({ height: "sky" })).toEqual({
      height: 0,
      score: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: ClimberRemoteState = { height: 25, score: 800 };
    expect(lanClimber.decodeProgress({ height: 25, score: 800 })).toEqual(
      state,
    );
    expect(lanClimber.decodeProgress({ height: 25 })).toBeUndefined();
    expect(lanClimber.decodeProgress({ height: -1, score: 0 })).toBeUndefined();
    expect(lanClimber.decodeProgress("garbage")).toBeUndefined();
  });
});
