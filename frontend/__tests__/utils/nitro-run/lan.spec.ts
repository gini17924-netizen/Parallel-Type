import { beforeEach, describe, expect, it } from "vitest";

import {
  lanNitro,
  nitroLanStream,
  resolveNitroVerdict,
  type NitroRemoteState,
} from "../../../src/ts/utils/nitro-run/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";
import { shuffleWithSeed } from "../../../src/ts/utils/games/seeded-shuffle";

describe("nitro-run LanPlayable (online wave, phase 13)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanNitro);
  });

  it("is a registry member with the nitro route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("nitro-run");
    const game = getLanGame("nitro-run");
    expect(game?.route).toBe("/games/nitro-run");
    expect(game?.label).toBe("nitro run");
    expect(game?.icon).toBe("fa-car-side");
  });

  it("buildStart seeds the match and carries lang + target meters", () => {
    const start = lanNitro.buildStart({ lang: "farsi", meters: 1500 });
    expect(start.gameId).toBe("nitro-run");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", meters: 1500 });
  });

  it("buildStart applies the documented defaults", () => {
    const start = lanNitro.buildStart({});
    expect(start.params).toEqual({ lang: "english", meters: 1000 });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanNitro.buildStart({ lang: "english", meters: 1000 });
    expect(lanNitro.validateStart(good)).toBe(true);
    expect(lanNitro.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanNitro.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(lanNitro.validateStart({ ...good, params: { meters: 1000 } })).toBe(
      false,
    );
  });

  it("the seeded stream is deterministic per seed", () => {
    const pool = ["a", "bb", "ccc", "dddd"];
    const first = nitroLanStream(pool, 321);
    expect(first).toEqual(shuffleWithSeed(pool, 321)); //the shared shuffle
    expect(nitroLanStream(pool, 321)).toEqual(first);
    expect(nitroLanStream(pool, 123)).not.toEqual(first);
  });

  it("the finish-line verdict: the lower finish time wins", () => {
    expect(resolveNitroVerdict({ finishMs: 8000 }, { finishMs: 9000 })).toBe(
      "won",
    );
    expect(resolveNitroVerdict({ finishMs: 9000 }, { finishMs: 8000 })).toBe(
      "lost",
    );
    expect(resolveNitroVerdict({ finishMs: 8000 }, { finishMs: 8000 })).toBe(
      "draw",
    );
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanNitro.encodeProgress({ meters: 420, words: 19 })).toEqual({
      meters: 420,
      words: 19,
    });
    expect(lanNitro.encodeProgress({ meters: "far" })).toEqual({
      meters: 0,
      words: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: NitroRemoteState = { meters: 300, words: 15 };
    expect(lanNitro.decodeProgress({ meters: 300, words: 15 })).toEqual(state);
    expect(lanNitro.decodeProgress({ meters: 300 })).toBeUndefined();
    expect(lanNitro.decodeProgress({ meters: -5, words: 0 })).toBeUndefined();
    expect(lanNitro.decodeProgress("garbage")).toBeUndefined();
  });
});
