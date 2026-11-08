import { beforeEach, describe, expect, it } from "vitest";

import {
  lanSplitDuel,
  resolveSplitVerdict,
  sideForRole,
  splitLanStreams,
  SPLIT_LAN_LETTERS,
} from "../../../src/ts/utils/split-duel/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("split-duel LanPlayable (online wave, phase 9 — pattern H)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanSplitDuel);
  });

  it("is a registry member with the duel route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("split-duel");
    const game = getLanGame("split-duel");
    expect(game?.route).toBe("/games/split-duel");
    expect(game?.label).toBe("split duel");
    expect(game?.icon).toBe("fa-users");
  });

  it("buildStart seeds the match and carries lang + stream length", () => {
    const start = lanSplitDuel.buildStart({ lang: "farsi", words: 30 });
    expect(start.gameId).toBe("split-duel");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", words: 30 });
  });

  it("buildStart applies the documented defaults", () => {
    const start = lanSplitDuel.buildStart({});
    expect(start.params).toEqual({ lang: "english", words: 20 });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanSplitDuel.buildStart({ lang: "english", words: 20 });
    expect(lanSplitDuel.validateStart(good)).toBe(true);
    expect(lanSplitDuel.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(lanSplitDuel.validateStart({ ...good, params: { words: 20 } })).toBe(
      false,
    );
    expect(
      lanSplitDuel.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
  });

  it("the host sits on the left half, the client on the right", () => {
    expect(sideForRole("host")).toBe("left");
    expect(sideForRole("client")).toBe("right");
  });

  it("both seeded side streams are deterministic and half-locked", () => {
    const pool = ["there", "other", "honest", "noted", "shrug", "hen"];
    const [leftA, rightA] = splitLanStreams(pool, 77, 8);
    const [leftB, rightB] = splitLanStreams(pool, 77, 8);
    expect(leftA).toEqual(leftB); //same seed -> the identical left stream
    expect(rightA).toEqual(rightB); //and the identical right stream
    expect(leftA).toHaveLength(8);
    expect(rightA).toHaveLength(8);
    //every pseudo-word letter belongs to that half only
    for (const word of leftA) {
      for (const ch of word) {
        expect(SPLIT_LAN_LETTERS.left).toContain(ch);
      }
    }
    for (const word of rightA) {
      for (const ch of word) {
        expect(SPLIT_LAN_LETTERS.right).toContain(ch);
      }
    }
    //a different seed builds a different pair
    const [leftC] = splitLanStreams(pool, 78, 8);
    expect(leftC).not.toEqual(leftA);
  });

  it("the verdict: lower time wins, accuracy breaks the tie", () => {
    expect(
      resolveSplitVerdict(
        { finishMs: 9000, acc: 90 },
        { finishMs: 9500, acc: 100 },
      ),
    ).toBe("won");
    expect(
      resolveSplitVerdict(
        { finishMs: 9500, acc: 100 },
        { finishMs: 9000, acc: 90 },
      ),
    ).toBe("lost");
    expect(
      resolveSplitVerdict(
        { finishMs: 9000, acc: 88 },
        { finishMs: 9000, acc: 90 },
      ),
    ).toBe("lost");
    expect(
      resolveSplitVerdict(
        { finishMs: 9000, acc: 92 },
        { finishMs: 9000, acc: 90 },
      ),
    ).toBe("won");
    expect(
      resolveSplitVerdict(
        { finishMs: 9000, acc: 90 },
        { finishMs: 9000, acc: 90 },
      ),
    ).toBe("draw");
  });

  it("the progress codec is the shared word-index pair", () => {
    expect(
      lanSplitDuel.encodeProgress({ wordIndex: 3, correctChars: 14 }),
    ).toEqual({ wordIndex: 3, correctChars: 14 });
    expect(
      lanSplitDuel.decodeProgress({ wordIndex: 2, correctChars: 8 }),
    ).toEqual({
      wordIndex: 2,
      correctChars: 8,
    });
    expect(lanSplitDuel.decodeProgress({ wordIndex: -1 })).toBeUndefined();
    expect(lanSplitDuel.decodeProgress(null)).toBeUndefined();
  });
});
