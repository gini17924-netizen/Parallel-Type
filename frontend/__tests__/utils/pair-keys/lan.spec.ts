import { beforeEach, describe, expect, it } from "vitest";

import {
  lanPairKeys,
  resolvePairVerdict,
  type PairRemoteState,
} from "../../../src/ts/utils/pair-keys/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("pair-keys LanPlayable (online wave, phase 25 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanPairKeys);
  });

  it("is a registry member with the pair-keys route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("pair-keys");
    const game = getLanGame("pair-keys");
    expect(game?.route).toBe("/games/pair-keys");
    expect(game?.label).toBe("pair keys");
    expect(game?.icon).toBe("fa-clone");
  });

  it("buildStart seeds the match and carries lang + mode + level", () => {
    const start = lanPairKeys.buildStart({
      lang: "farsi",
      mode: "letter",
      level: 2,
    });
    expect(start.gameId).toBe("pair-keys");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", mode: "letter", level: 2 });
  });

  it("buildStart applies the documented defaults", () => {
    const start = lanPairKeys.buildStart({});
    expect(start.params).toEqual({
      lang: "english",
      mode: "form-name",
      level: 1,
    });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanPairKeys.buildStart({});
    expect(lanPairKeys.validateStart(good)).toBe(true);
    expect(lanPairKeys.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanPairKeys.validateStart({
        ...good,
        params: { lang: "english", mode: "letter" },
      }),
    ).toBe(false);
    expect(
      lanPairKeys.validateStart({
        ...good,
        params: { lang: "english", mode: "lunatic", level: 1 },
      }),
    ).toBe(false);
    expect(
      lanPairKeys.validateStart({
        ...good,
        params: { lang: "english", mode: "letter", level: 3 },
      }),
    ).toBe(false);
  });

  it("the horn verdict: the lower finish time wins, fewer moves breaks the tie", () => {
    const mine = { finishMs: 20_000, moves: 12 };
    expect(resolvePairVerdict(mine, { finishMs: 25_000, moves: 8 })).toBe(
      "won",
    );
    expect(resolvePairVerdict(mine, { finishMs: 25_000, moves: 8 })).toBe(
      "won",
    );
    expect(resolvePairVerdict(mine, { finishMs: 30_000, moves: 2 })).toBe(
      "won",
    );
    expect(resolvePairVerdict(mine, { finishMs: 20_000, moves: 14 })).toBe(
      "won",
    );
    expect(resolvePairVerdict(mine, { finishMs: 20_000, moves: 10 })).toBe(
      "lost",
    );
    expect(resolvePairVerdict(mine, { finishMs: 20_000, moves: 12 })).toBe(
      "draw",
    );
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanPairKeys.encodeProgress({ found: 5, moves: 9 })).toEqual({
      found: 5,
      moves: 9,
    });
    expect(lanPairKeys.encodeProgress({ found: "half" })).toEqual({
      found: 0,
      moves: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: PairRemoteState = { found: 6, moves: 11 };
    expect(lanPairKeys.decodeProgress({ found: 6, moves: 11 })).toEqual(state);
    expect(lanPairKeys.decodeProgress({ found: 6 })).toBeUndefined();
    expect(lanPairKeys.decodeProgress({ found: -1, moves: 0 })).toBeUndefined();
    expect(lanPairKeys.decodeProgress("garbage")).toBeUndefined();
  });
});
