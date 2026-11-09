import { beforeEach, describe, expect, it } from "vitest";

import {
  lanBalloon,
  resolveBalloonVerdict,
  type BalloonRemoteState,
} from "../../../src/ts/utils/balloon-pop/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("balloon-pop LanPlayable (online wave, phase 23 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanBalloon);
  });

  it("is a registry member with the balloon route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("balloon-pop");
    const game = getLanGame("balloon-pop");
    expect(game?.route).toBe("/games/balloon-pop");
    expect(game?.label).toBe("balloon pop");
    expect(game?.icon).toBe("fa-circle");
  });

  it("buildStart seeds the match and carries lang + stage + duration", () => {
    const start = lanBalloon.buildStart({
      lang: "farsi",
      stage: 3,
      durationMs: 60_000,
    });
    expect(start.gameId).toBe("balloon-pop");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({
      lang: "farsi",
      stage: 3,
      durationMs: 60_000,
    });
  });

  it("buildStart applies the documented defaults", () => {
    const start = lanBalloon.buildStart({});
    expect(start.params).toEqual({
      lang: "english",
      stage: 1,
      durationMs: 120_000,
    });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanBalloon.buildStart({});
    expect(lanBalloon.validateStart(good)).toBe(true);
    expect(lanBalloon.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanBalloon.validateStart({
        ...good,
        params: { lang: "english", stage: 5, durationMs: 120_000 },
      }),
    ).toBe(false);
    expect(
      lanBalloon.validateStart({
        ...good,
        params: { lang: "english", durationMs: 120_000 },
      }),
    ).toBe(false);
    expect(
      lanBalloon.validateStart({
        ...good,
        params: { stage: 1, durationMs: 120_000 },
      }),
    ).toBe(false);
  });

  it("the horn verdict: more pops wins, the score breaks the tie", () => {
    const mine = { pops: 25, score: 900 };
    expect(resolveBalloonVerdict(mine, { pops: 20, score: 5000 })).toBe("won");
    expect(resolveBalloonVerdict(mine, { pops: 30, score: 100 })).toBe("lost");
    expect(resolveBalloonVerdict(mine, { pops: 25, score: 1000 })).toBe("lost");
    expect(resolveBalloonVerdict(mine, { pops: 25, score: 800 })).toBe("won");
    expect(resolveBalloonVerdict(mine, { pops: 25, score: 900 })).toBe("draw");
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanBalloon.encodeProgress({ pops: 18, score: 640 })).toEqual({
      pops: 18,
      score: 640,
    });
    expect(lanBalloon.encodeProgress({ pops: "many" })).toEqual({
      pops: 0,
      score: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: BalloonRemoteState = { pops: 12, score: 480 };
    expect(lanBalloon.decodeProgress({ pops: 12, score: 480 })).toEqual(state);
    expect(lanBalloon.decodeProgress({ pops: 12 })).toBeUndefined();
    expect(lanBalloon.decodeProgress({ pops: -3, score: 0 })).toBeUndefined();
    expect(lanBalloon.decodeProgress("garbage")).toBeUndefined();
  });
});
