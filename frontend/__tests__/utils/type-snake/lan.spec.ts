import { beforeEach, describe, expect, it } from "vitest";

import {
  lanTypeSnake,
  resolveSnakeVerdict,
  typeSnakeLanWordStream,
  type SnakeRemoteState,
} from "../../../src/ts/utils/type-snake/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("type-snake LanPlayable (online wave, phase 29 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanTypeSnake);
  });

  it("is a registry member with the type-snake route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("type-snake");
    const game = getLanGame("type-snake");
    expect(game?.route).toBe("/games/type-snake");
    expect(game?.label).toBe("type snake");
    expect(game?.icon).toBe("fa-dragon");
  });

  it("buildStart seeds the death race and carries lang", () => {
    const start = lanTypeSnake.buildStart({ lang: "farsi" });
    expect(start.gameId).toBe("type-snake");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi" });
  });

  it("buildStart applies the documented default language", () => {
    expect(lanTypeSnake.buildStart({}).params).toEqual({ lang: "english" });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanTypeSnake.buildStart({});
    expect(lanTypeSnake.validateStart(good)).toBe(true);
    expect(lanTypeSnake.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(lanTypeSnake.validateStart({ ...good, params: { lang: "" } })).toBe(
      false,
    );
    expect(lanTypeSnake.validateStart({ ...good, params: {} })).toBe(false);
    expect(lanTypeSnake.validateStart({ ...good, params: { lang: 42 } })).toBe(
      false,
    );
  });

  it("the death-race verdict: the higher score wins, the longer survival breaks the tie", () => {
    const mine = { score: 600, elapsedMs: 90_000 };
    expect(resolveSnakeVerdict(mine, { score: 450, elapsedMs: 60_000 })).toBe(
      "won",
    );
    expect(resolveSnakeVerdict(mine, { score: 900, elapsedMs: 60_000 })).toBe(
      "lost",
    );
    //equal score: still alive longer means the better run
    expect(resolveSnakeVerdict(mine, { score: 600, elapsedMs: 120_000 })).toBe(
      "lost",
    );
    expect(resolveSnakeVerdict(mine, { score: 600, elapsedMs: 60_000 })).toBe(
      "won",
    );
    expect(resolveSnakeVerdict(mine, { score: 600, elapsedMs: 90_000 })).toBe(
      "draw",
    );
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanTypeSnake.encodeProgress({ length: 9, score: 450 })).toEqual({
      length: 9,
      score: 450,
    });
    expect(lanTypeSnake.encodeProgress({ length: "long" })).toEqual({
      length: 0,
      score: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: SnakeRemoteState = { length: 12, score: 630 };
    expect(lanTypeSnake.decodeProgress({ length: 12, score: 630 })).toEqual(
      state,
    );
    expect(lanTypeSnake.decodeProgress({ length: 12 })).toBeUndefined();
    expect(
      lanTypeSnake.decodeProgress({ length: -1, score: 0 }),
    ).toBeUndefined();
    expect(
      lanTypeSnake.decodeProgress({ length: 4, score: "many" }),
    ).toBeUndefined();
    expect(lanTypeSnake.decodeProgress("garbage")).toBeUndefined();
  });

  it("the seeded word stream is deterministic and cycles the 2-3 letter pool", () => {
    const pool = ["alpha", "hi", "run", "key", "tap", "win", "ace", "zz"];
    const streamA = typeSnakeLanWordStream(pool, 29);
    const streamB = typeSnakeLanWordStream(pool, 29);
    //same seed -> the identical food words, spawn after spawn
    for (let i = 0; i < 8; i++) {
      expect(streamA()).toBe(streamB());
    }
    //a different seed reshuffles
    const streamC = typeSnakeLanWordStream(pool, 30);
    const a = [streamA(), streamA(), streamA()];
    const c = [streamC(), streamC(), streamC()];
    expect(a.some((word, i) => word !== c[i])).toBe(true);
    //the stream only ever serves 2-3 letter words from the filtered pool
    const served = new Set(
      [...Array(24)].map(() => typeSnakeLanWordStream(pool, 7)()),
    );
    for (const word of served) {
      expect(word).toMatch(/^\p{L}{2,3}$/u);
    }
  });

  it("the word stream falls back when the pool has no short words", () => {
    const stream = typeSnakeLanWordStream(["alpha", "bravo", "delta"], 5);
    expect(stream()).toMatch(/^(hi|run|key|tap|win|ace)$/);
  });
});
