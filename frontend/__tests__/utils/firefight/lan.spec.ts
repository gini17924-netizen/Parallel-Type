import { beforeEach, describe, expect, it } from "vitest";

import {
  fireLanStream,
  lanFirefight,
  resolveFireVerdict,
  type FireRemoteState,
} from "../../../src/ts/utils/firefight/lan";
import { BALANCE } from "../../../src/ts/utils/firefight/balance";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("firefight LanPlayable (online wave, phase 37 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanFirefight);
  });

  it("is a registry member with the firefight route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("firefight");
    const game = getLanGame("firefight");
    expect(game?.route).toBe("/games/firefight");
    expect(game?.label).toBe("firefight");
    expect(game?.icon).toBe("fa-fire");
  });

  it("buildStart seeds the survival window and carries lang + surviveMs", () => {
    const start = lanFirefight.buildStart({ lang: "farsi", surviveMs: 60_000 });
    expect(start.gameId).toBe("firefight");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", surviveMs: 60_000 });
  });

  it("buildStart applies the documented defaults", () => {
    expect(lanFirefight.buildStart({}).params).toEqual({
      lang: "english",
      surviveMs: BALANCE.surviveMs,
    });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanFirefight.buildStart({});
    expect(lanFirefight.validateStart(good)).toBe(true);
    expect(lanFirefight.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanFirefight.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(
      lanFirefight.validateStart({
        ...good,
        params: { lang: "english", surviveMs: 0 },
      }),
    ).toBe(false);
    expect(
      lanFirefight.validateStart({
        ...good,
        params: { lang: "", surviveMs: 120_000 },
      }),
    ).toBe(false);
  });

  it("the survival verdict: the outcome first, then the raw score, then the longer stand", () => {
    const mine = { won: true, score: 600, elapsedMs: 120_000 };
    expect(
      resolveFireVerdict(mine, { won: false, score: 900, elapsedMs: 40_000 }),
    ).toBe("won"); //surviving beats a higher raw score
    expect(
      resolveFireVerdict({ won: false, score: 900, elapsedMs: 40_000 }, mine),
    ).toBe("lost");
    //same outcome: the higher raw score wins
    expect(
      resolveFireVerdict(mine, { won: true, score: 450, elapsedMs: 120_000 }),
    ).toBe("won");
    expect(
      resolveFireVerdict(mine, { won: true, score: 900, elapsedMs: 120_000 }),
    ).toBe("lost");
    //equal outcome and score: the longer stand wins
    expect(
      resolveFireVerdict(mine, { won: true, score: 600, elapsedMs: 90_000 }),
    ).toBe("won");
    expect(
      resolveFireVerdict(mine, { won: true, score: 600, elapsedMs: 120_000 }),
    ).toBe("draw");
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(
      lanFirefight.encodeProgress({ score: 450, extinguished: 7 }),
    ).toEqual({ score: 450, extinguished: 7 });
    expect(lanFirefight.encodeProgress({ score: "many" })).toEqual({
      score: 0,
      extinguished: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: FireRemoteState = { score: 630, extinguished: 9 };
    expect(
      lanFirefight.decodeProgress({ score: 630, extinguished: 9 }),
    ).toEqual(state);
    expect(lanFirefight.decodeProgress({ score: 630 })).toBeUndefined();
    expect(
      lanFirefight.decodeProgress({ score: -1, extinguished: 0 }),
    ).toBeUndefined();
    expect(
      lanFirefight.decodeProgress({ score: 4, extinguished: "many" }),
    ).toBeUndefined();
    expect(lanFirefight.decodeProgress("garbage")).toBeUndefined();
  });

  it("the seeded stream is deterministic: identical words and spreads", () => {
    const pool = [
      "flame",
      "ember",
      "smoke",
      "blaze",
      "spark",
      "torch",
      "kindle",
      "scorch",
    ];
    const a = fireLanStream(pool, 37);
    const b = fireLanStream(pool, 37);
    //same seed -> the identical word sequence
    for (let i = 0; i < 8; i++) {
      expect(a.wordFor()).toBe(b.wordFor());
    }
    //same call ORDER (words interleaved with spread picks) -> the
    //identical values: the ignition/spread evolution matches on both
    //machines
    const c = fireLanStream(pool, 37);
    const seqC = [c.wordFor(), c.rng(), c.wordFor(), c.rng(), c.wordFor()];
    const e = fireLanStream(pool, 37);
    const seqE = [e.wordFor(), e.rng(), e.wordFor(), e.rng(), e.wordFor()];
    expect(seqC).toEqual(seqE);
    //a different seed reshuffles (the same call pattern, other values)
    const d = fireLanStream(pool, 38);
    const seqD = [d.wordFor(), d.rng(), d.wordFor(), d.rng(), d.wordFor()];
    expect(seqC.some((value, i) => value !== seqD[i])).toBe(true);
    //the served words stay inside the 4-7 letter window
    const f = fireLanStream(pool, 7);
    for (let i = 0; i < 20; i++) {
      const word = f.wordFor();
      expect(word).toMatch(/^\p{L}{4,7}$/u);
    }
  });

  it("the word stream falls back when the pool has no window words", () => {
    const stream = fireLanStream(["ax", "be", "cat"], 5);
    expect(stream.wordFor()).toMatch(/^(flame|ember|smoke|blaze|spark|torch)$/);
  });
});
