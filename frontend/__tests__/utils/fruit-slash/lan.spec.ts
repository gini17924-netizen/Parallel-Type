import { beforeEach, describe, expect, it } from "vitest";

import {
  fruitLanSpawn,
  lanFruitSlash,
  resolveFruitVerdict,
  type FruitRemoteState,
} from "../../../src/ts/utils/fruit-slash/lan";
import { BALANCE } from "../../../src/ts/utils/fruit-slash/balance";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("fruit-slash LanPlayable (online wave, phase 35 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanFruitSlash);
  });

  it("is a registry member with the fruit-slash route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("fruit-slash");
    const game = getLanGame("fruit-slash");
    expect(game?.route).toBe("/games/fruit-slash");
    expect(game?.label).toBe("fruit slash");
    expect(game?.icon).toBe("fa-apple-alt");
  });

  it("buildStart seeds the horn window and carries lang + durationMs", () => {
    const start = lanFruitSlash.buildStart({
      lang: "farsi",
      durationMs: 45_000,
    });
    expect(start.gameId).toBe("fruit-slash");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", durationMs: 45_000 });
  });

  it("buildStart applies the documented defaults", () => {
    expect(lanFruitSlash.buildStart({}).params).toEqual({
      lang: "english",
      durationMs: BALANCE.durationMs,
    });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanFruitSlash.buildStart({});
    expect(lanFruitSlash.validateStart(good)).toBe(true);
    expect(lanFruitSlash.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanFruitSlash.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(
      lanFruitSlash.validateStart({
        ...good,
        params: { lang: "english", durationMs: 0 },
      }),
    ).toBe(false);
    expect(
      lanFruitSlash.validateStart({
        ...good,
        params: { lang: "", durationMs: 90_000 },
      }),
    ).toBe(false);
  });

  it("the horn verdict: the higher score wins, the exact parity is a draw", () => {
    expect(resolveFruitVerdict({ score: 600 }, { score: 450 })).toBe("won");
    expect(resolveFruitVerdict({ score: 450 }, { score: 600 })).toBe("lost");
    expect(resolveFruitVerdict({ score: 600 }, { score: 600 })).toBe("draw");
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanFruitSlash.encodeProgress({ score: 450, bombs: 1 })).toEqual({
      score: 450,
      bombs: 1,
    });
    expect(lanFruitSlash.encodeProgress({ score: "many" })).toEqual({
      score: 0,
      bombs: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: FruitRemoteState = { score: 630, bombs: 2 };
    expect(lanFruitSlash.decodeProgress({ score: 630, bombs: 2 })).toEqual(
      state,
    );
    expect(lanFruitSlash.decodeProgress({ score: 630 })).toBeUndefined();
    expect(
      lanFruitSlash.decodeProgress({ score: -1, bombs: 0 }),
    ).toBeUndefined();
    expect(
      lanFruitSlash.decodeProgress({ score: 4, bombs: "two" }),
    ).toBeUndefined();
    expect(lanFruitSlash.decodeProgress("garbage")).toBeUndefined();
  });

  it("the seeded spawn is deterministic: identical words and bombs per level", () => {
    const pool = [
      "fig",
      "date",
      "kiwi",
      "mango",
      "berry",
      "melon",
      "peach",
      "guava",
      "lychee",
      "papaya",
    ];
    const spawnA = fruitLanSpawn(pool, 35);
    const spawnB = fruitLanSpawn(pool, 35);
    //same seed -> the identical fruits and bombs, level after level
    for (const level of [1, 2, 5, 11]) {
      expect(spawnA(level)).toEqual(spawnB(level));
    }
    //a different seed reshuffles (several picks across levels)
    const spawnC = fruitLanSpawn(pool, 36);
    const wordsA = [spawnA(1), spawnA(2), spawnA(3), spawnA(4)].map(
      (spawn) => spawn.word,
    );
    const wordsC = [spawnC(1), spawnC(2), spawnC(3), spawnC(4)].map(
      (spawn) => spawn.word,
    );
    expect(wordsA.some((word, i) => word !== wordsC[i])).toBe(true);
  });

  it("the seeded spawn mirrors the page's level-riding word window", () => {
    const pool = ["fig", "date", "kiwi", "mango", "melon", "papaya"];
    const spawn = fruitLanSpawn(pool, 35);
    //level 1: 4-letter words only; level 5: 4-6 letters
    for (let i = 0; i < 20; i++) {
      const low = spawn(1);
      expect(low.word.length).toBeGreaterThanOrEqual(BALANCE.minWordLen);
      expect(low.word.length).toBeLessThanOrEqual(BALANCE.minWordLen);
      const high = spawn(6);
      expect(high.word.length).toBeLessThanOrEqual(BALANCE.maxWordLen);
    }
    //the bomb mix stays a boolean decision (the seeded chance)
    const spawnLong = fruitLanSpawn(pool, 99);
    for (let i = 0; i < 30; i++) {
      expect(typeof spawnLong(3).isBomb).toBe("boolean");
    }
  });
});
