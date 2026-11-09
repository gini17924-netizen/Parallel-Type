import { beforeEach, describe, expect, it } from "vitest";

import {
  craneLanStream,
  lanCrane,
  resolveCraneVerdict,
  type CraneRemoteState,
} from "../../../src/ts/utils/crane/lan";
import { BALANCE } from "../../../src/ts/utils/crane/balance";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("crane LanPlayable (online wave, phase 39 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanCrane);
  });

  it("is a registry member with the crane route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("crane");
    const game = getLanGame("crane");
    expect(game?.route).toBe("/games/crane");
    expect(game?.label).toBe("crane stack");
    expect(game?.icon).toBe("fa-anchor");
  });

  it("buildStart seeds the horn window and carries lang + durationMs", () => {
    const start = lanCrane.buildStart({ lang: "farsi", durationMs: 45_000 });
    expect(start.gameId).toBe("crane");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", durationMs: 45_000 });
  });

  it("buildStart applies the documented defaults", () => {
    expect(lanCrane.buildStart({}).params).toEqual({
      lang: "english",
      durationMs: 90_000,
    });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanCrane.buildStart({});
    expect(lanCrane.validateStart(good)).toBe(true);
    expect(lanCrane.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanCrane.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(
      lanCrane.validateStart({
        ...good,
        params: { lang: "english", durationMs: 0 },
      }),
    ).toBe(false);
    expect(
      lanCrane.validateStart({
        ...good,
        params: { lang: "", durationMs: 90_000 },
      }),
    ).toBe(false);
  });

  it("the horn verdict: the higher score wins, the exact parity is a draw", () => {
    expect(resolveCraneVerdict({ score: 600 }, { score: 450 })).toBe("won");
    expect(resolveCraneVerdict({ score: 450 }, { score: 600 })).toBe("lost");
    expect(resolveCraneVerdict({ score: 600 }, { score: 600 })).toBe("draw");
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanCrane.encodeProgress({ score: 450, perfectCount: 3 })).toEqual({
      score: 450,
      perfectCount: 3,
    });
    expect(lanCrane.encodeProgress({ score: "many" })).toEqual({
      score: 0,
      perfectCount: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: CraneRemoteState = { score: 630, perfectCount: 5 };
    expect(lanCrane.decodeProgress({ score: 630, perfectCount: 5 })).toEqual(
      state,
    );
    expect(lanCrane.decodeProgress({ score: 630 })).toBeUndefined();
    expect(
      lanCrane.decodeProgress({ score: -1, perfectCount: 0 }),
    ).toBeUndefined();
    expect(
      lanCrane.decodeProgress({ score: 4, perfectCount: "many" }),
    ).toBeUndefined();
    expect(lanCrane.decodeProgress("garbage")).toBeUndefined();
  });

  it("the seeded stream is deterministic and rides the level", () => {
    const a = craneLanStream(39);
    const b = craneLanStream(39);
    //same seed -> the identical sequences, level after level
    for (const level of [1, 2, 4, 10]) {
      expect(a.seqFor(level)).toEqual(b.seqFor(level));
    }
    //same call order (sequences interleaved with zone shifts) -> identical
    const c = craneLanStream(39);
    const seqC = [...c.seqFor(1), c.rng(), ...c.seqFor(2), c.rng()];
    const d = craneLanStream(39);
    const seqD = [...d.seqFor(1), d.rng(), ...d.seqFor(2), d.rng()];
    expect(seqC).toEqual(seqD);
    //a different seed reshuffles (the same call pattern, other values)
    const e = craneLanStream(40);
    const seqE = [...e.seqFor(1), e.rng(), ...e.seqFor(2), e.rng()];
    expect(seqC.some((value, i) => value !== seqE[i])).toBe(true);
  });

  it("the sequences ride the level and stay on the home-row keys", () => {
    const stream = craneLanStream(39);
    //level 1: 4 keys; level 10: capped at 6
    expect(stream.seqFor(1)).toHaveLength(BALANCE.seqMinLen);
    expect(stream.seqFor(10)).toHaveLength(BALANCE.seqMaxLen);
    //every key comes from the fixed home-row set
    for (const key of [...stream.seqFor(5), ...stream.seqFor(9)]) {
      expect("fjdksla".includes(key)).toBe(true);
    }
  });
});
