import { beforeEach, describe, expect, it } from "vitest";

import { lanGhostGp, gpLanStream } from "../../../src/ts/utils/ghost-gp/lan";
import { shuffleWithSeed } from "../../../src/ts/utils/games/seeded-shuffle";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("ghost-gp LanPlayable (online wave, phase 7)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanGhostGp);
  });

  it("is a registry member with the gp route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("ghost-gp");
    const game = getLanGame("ghost-gp");
    expect(game?.route).toBe("/games/ghost-gp");
    expect(game?.label).toBe("ghost gp");
    expect(game?.icon).toBe("fa-ghost");
  });

  it("buildStart seeds the match and carries lang + race length", () => {
    const start = lanGhostGp.buildStart({ lang: "farsi", words: 20 });
    expect(start.gameId).toBe("ghost-gp");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", words: 20 });
    expect(start.words).toBeUndefined(); //seeded games ship no sequence
  });

  it("buildStart applies the documented defaults (standard race)", () => {
    const start = lanGhostGp.buildStart({});
    expect(start.params).toEqual({ lang: "english", words: 35 });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanGhostGp.buildStart({ lang: "english", words: 60 });
    expect(lanGhostGp.validateStart(good)).toBe(true);
    expect(lanGhostGp.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(lanGhostGp.validateStart({ ...good, seed: 2.5 })).toBe(false);
    expect(lanGhostGp.validateStart({ ...good, params: { words: 60 } })).toBe(
      false,
    );
    expect(
      lanGhostGp.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
  });

  it("the seeded stream is deterministic per seed", () => {
    const pool = ["a", "bb", "ccc", "dddd", "e", "ff", "ggg", "hhhh"];
    const first = gpLanStream(pool, 999);
    expect(first).toEqual(shuffleWithSeed(pool, 999)); //the shared shuffle
    expect(gpLanStream(pool, 999)).toEqual(first); //same seed, same order
    expect([...first].sort()).toEqual([...pool].sort());
    expect(gpLanStream(pool, 111)).not.toEqual(first);
  });

  it("gpLanStream falls back to the shared pool without one", () => {
    const stream = gpLanStream([], 5);
    expect(stream).toHaveLength(6);
  });

  it("the progress codec is the shared word-index pair", () => {
    expect(
      lanGhostGp.encodeProgress({ wordIndex: 4, correctChars: 21 }),
    ).toEqual({
      wordIndex: 4,
      correctChars: 21,
    });
    expect(
      lanGhostGp.decodeProgress({ wordIndex: 2, correctChars: 9 }),
    ).toEqual({
      wordIndex: 2,
      correctChars: 9,
    });
    expect(lanGhostGp.decodeProgress({ wordIndex: -3 })).toBeUndefined();
    expect(lanGhostGp.decodeProgress("garbage")).toBeUndefined();
  });
});
