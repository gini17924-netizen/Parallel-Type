import { beforeEach, describe, expect, it } from "vitest";

import {
  lanStack,
  resolveStackVerdict,
  stackLanStream,
  type StackRemoteState,
} from "../../../src/ts/utils/stack-attack/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";
import { shuffleWithSeed } from "../../../src/ts/utils/games/seeded-shuffle";

describe("stack-attack LanPlayable (online wave, phase 21 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanStack);
  });

  it("is a registry member with the stack route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("stack-attack");
    const game = getLanGame("stack-attack");
    expect(game?.route).toBe("/games/stack-attack");
    expect(game?.label).toBe("stack attack");
    expect(game?.icon).toBe("fa-cubes");
  });

  it("buildStart seeds the match and carries lang + duration", () => {
    const start = lanStack.buildStart({ lang: "farsi", durationMs: 60_000 });
    expect(start.gameId).toBe("stack-attack");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", durationMs: 60_000 });
  });

  it("buildStart applies the documented defaults", () => {
    const start = lanStack.buildStart({});
    expect(start.params).toEqual({ lang: "english", durationMs: 120_000 });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanStack.buildStart({});
    expect(lanStack.validateStart(good)).toBe(true);
    expect(lanStack.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanStack.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(
      lanStack.validateStart({ ...good, params: { durationMs: 120_000 } }),
    ).toBe(false);
  });

  it("the seeded block stream is deterministic per seed", () => {
    const pool = ["block", "stack", "row", "clear"];
    const first = stackLanStream(pool, 404);
    expect(first).toEqual(shuffleWithSeed(pool, 404)); //the shared shuffle
    expect(stackLanStream(pool, 404)).toEqual(first);
    expect(stackLanStream(pool, 405)).not.toEqual(first);
  });

  it("the horn verdict: rows win, the score breaks the tie", () => {
    const mine = { rows: 4, score: 900 };
    expect(resolveStackVerdict(mine, { rows: 3, score: 5000 })).toBe("won");
    expect(resolveStackVerdict(mine, { rows: 5, score: 100 })).toBe("lost");
    expect(resolveStackVerdict(mine, { rows: 4, score: 1000 })).toBe("lost");
    expect(resolveStackVerdict(mine, { rows: 4, score: 800 })).toBe("won");
    expect(resolveStackVerdict(mine, { rows: 4, score: 900 })).toBe("draw");
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanStack.encodeProgress({ rows: 6, score: 480 })).toEqual({
      rows: 6,
      score: 480,
    });
    expect(lanStack.encodeProgress({ rows: "many" })).toEqual({
      rows: 0,
      score: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: StackRemoteState = { rows: 2, score: 210 };
    expect(lanStack.decodeProgress({ rows: 2, score: 210 })).toEqual(state);
    expect(lanStack.decodeProgress({ rows: 2 })).toBeUndefined();
    expect(lanStack.decodeProgress({ rows: -1, score: 0 })).toBeUndefined();
    expect(lanStack.decodeProgress("garbage")).toBeUndefined();
  });
});
