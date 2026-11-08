import { beforeEach, describe, expect, it } from "vitest";

import {
  lanWordBlast,
  resolveWordBlastVerdict,
  type WordBlastRemoteState,
} from "../../../src/ts/utils/word-blast/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("word-blast LanPlayable (online wave, phase 19 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanWordBlast);
  });

  it("is a registry member with the blast route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("word-blast");
    const game = getLanGame("word-blast");
    expect(game?.route).toBe("/games/word-blast");
    expect(game?.label).toBe("word blast");
    expect(game?.icon).toBe("fa-bomb");
  });

  it("buildStart seeds the match and carries lang + difficulty + duration", () => {
    const start = lanWordBlast.buildStart({
      lang: "farsi",
      difficulty: "hard",
      durationMs: 60_000,
    });
    expect(start.gameId).toBe("word-blast");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({
      lang: "farsi",
      difficulty: "hard",
      durationMs: 60_000,
    });
  });

  it("buildStart applies the documented defaults", () => {
    const start = lanWordBlast.buildStart({});
    expect(start.params).toEqual({
      lang: "english",
      difficulty: "normal",
      durationMs: 90_000,
    });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanWordBlast.buildStart({});
    expect(lanWordBlast.validateStart(good)).toBe(true);
    expect(lanWordBlast.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanWordBlast.validateStart({
        ...good,
        params: { lang: "english", difficulty: "lunatic", durationMs: 90_000 },
      }),
    ).toBe(false);
    expect(
      lanWordBlast.validateStart({
        ...good,
        params: { lang: "english", durationMs: 90_000 },
      }),
    ).toBe(false);
    expect(
      lanWordBlast.validateStart({
        ...good,
        params: { lang: "english", difficulty: "normal" },
      }),
    ).toBe(false);
  });

  it("the horn verdict: the higher score wins, the parity draws", () => {
    expect(resolveWordBlastVerdict({ score: 1200 }, { score: 900 })).toBe(
      "won",
    );
    expect(resolveWordBlastVerdict({ score: 900 }, { score: 1200 })).toBe(
      "lost",
    );
    expect(resolveWordBlastVerdict({ score: 1000 }, { score: 1000 })).toBe(
      "draw",
    );
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanWordBlast.encodeProgress({ score: 850, combo: 12 })).toEqual({
      score: 850,
      combo: 12,
    });
    expect(lanWordBlast.encodeProgress({ score: "high" })).toEqual({
      score: 0,
      combo: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: WordBlastRemoteState = { score: 640, combo: 8 };
    expect(lanWordBlast.decodeProgress({ score: 640, combo: 8 })).toEqual(
      state,
    );
    expect(lanWordBlast.decodeProgress({ score: 640 })).toBeUndefined();
    expect(
      lanWordBlast.decodeProgress({ score: -2, combo: 0 }),
    ).toBeUndefined();
    expect(lanWordBlast.decodeProgress("garbage")).toBeUndefined();
  });
});
