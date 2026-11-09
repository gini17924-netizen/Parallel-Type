import { beforeEach, describe, expect, it } from "vitest";

import {
  lanWordle,
  resolveWordleVerdict,
  type WordleRemoteState,
} from "../../../src/ts/utils/wordle/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("wordle LanPlayable (online wave, phase 27 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanWordle);
  });

  it("is a registry member with the wordle route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("wordle");
    const game = getLanGame("wordle");
    expect(game?.route).toBe("/games/wordle");
    expect(game?.label).toBe("wordle");
    expect(game?.icon).toBe("fa-font");
  });

  it("buildStart seeds the match and carries lang + mode", () => {
    const start = lanWordle.buildStart({ lang: "farsi", mode: "fa" });
    expect(start.gameId).toBe("wordle");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", mode: "fa" });
  });

  it("buildStart applies the documented defaults and the random mode", () => {
    expect(lanWordle.buildStart({}).params).toEqual({
      lang: "english",
      mode: "en",
    });
    expect(lanWordle.buildStart({ mode: "random" }).params).toEqual({
      lang: "english",
      mode: "random",
    });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanWordle.buildStart({});
    expect(lanWordle.validateStart(good)).toBe(true);
    expect(lanWordle.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanWordle.validateStart({
        ...good,
        params: { lang: "english", mode: "lunatic" },
      }),
    ).toBe(false);
    expect(lanWordle.validateStart({ ...good, params: { mode: "en" } })).toBe(
      false,
    );
  });

  it("the horn verdict: fewer guesses wins, the elapsed time breaks the tie", () => {
    const mine = { guesses: 4, elapsedMs: 90_000 };
    expect(resolveWordleVerdict(mine, { guesses: 5, elapsedMs: 60_000 })).toBe(
      "won",
    );
    expect(resolveWordleVerdict(mine, { guesses: 3, elapsedMs: 90_000 })).toBe(
      "lost",
    );
    expect(resolveWordleVerdict(mine, { guesses: 4, elapsedMs: 120_000 })).toBe(
      "won",
    );
    expect(resolveWordleVerdict(mine, { guesses: 4, elapsedMs: 60_000 })).toBe(
      "lost",
    );
    expect(resolveWordleVerdict(mine, { guesses: 4, elapsedMs: 90_000 })).toBe(
      "draw",
    );
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanWordle.encodeProgress({ guesses: 3, solved: true })).toEqual({
      guesses: 3,
      solved: 1,
    });
    expect(lanWordle.encodeProgress({ guesses: "four" })).toEqual({
      guesses: 0,
      solved: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: WordleRemoteState = { guesses: 2, solved: true };
    expect(lanWordle.decodeProgress({ guesses: 2, solved: 1 })).toEqual(state);
    expect(lanWordle.decodeProgress({ guesses: 2, solved: true })).toEqual(
      state,
    );
    expect(lanWordle.decodeProgress({ guesses: 2 })).toBeUndefined();
    expect(
      lanWordle.decodeProgress({ guesses: -1, solved: 1 }),
    ).toBeUndefined();
    expect(lanWordle.decodeProgress("garbage")).toBeUndefined();
  });
});
