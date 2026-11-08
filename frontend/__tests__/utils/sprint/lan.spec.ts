import { beforeEach, describe, expect, it } from "vitest";

import {
  lanSprint,
  buildSprintStream,
  resolveSprintVerdict,
  sprintLanStream,
  type SprintRemoteState,
} from "../../../src/ts/utils/sprint/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("sprint LanPlayable (online wave, phase 5)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanSprint);
  });

  it("is a registry member with the sprint route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("sprint");
    const game = getLanGame("sprint");
    expect(game?.route).toBe("/games/sprint");
    expect(game?.label).toBe("sprint");
    expect(game?.icon).toBe("fa-bolt");
  });

  it("buildStart seeds the match and carries lang + stream length", () => {
    const start = lanSprint.buildStart({ lang: "farsi", words: 80 });
    expect(start.gameId).toBe("sprint");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", words: 80 });
    expect(start.words).toBeUndefined(); //seeded games ship no sequence
  });

  it("buildStart applies the documented defaults", () => {
    const start = lanSprint.buildStart({});
    expect(start.params).toEqual({ lang: "english", words: 60 });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanSprint.buildStart({ lang: "english", words: 60 });
    expect(lanSprint.validateStart(good)).toBe(true);
    expect(lanSprint.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(lanSprint.validateStart({ ...good, seed: 1.5 })).toBe(false);
    expect(
      lanSprint.validateStart({ ...good, params: { lang: "", words: 60 } }),
    ).toBe(false);
    expect(
      lanSprint.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(lanSprint.validateStart({ ...good, gameId: "wrong" as never })).toBe(
      false,
    );
  });

  it("the seeded stream is deterministic per seed and order-sensitive", () => {
    const pool = ["a", "bb", "ccc", "dddd", "e", "ff", "ggg", "hhhh"];
    const first = buildSprintStream(pool, 12345);
    const again = buildSprintStream(pool, 12345);
    expect(first).toEqual(again); //same seed -> the exact same order
    expect([...first].sort()).toEqual([...pool].sort()); //a shuffle, not a mutation
    const other = buildSprintStream(pool, 54321);
    expect(first).not.toEqual(other); //different seed -> different order
  });

  it("sprintLanStream falls back to the shared pool without one", () => {
    const stream = sprintLanStream([], 77);
    expect(stream).toHaveLength(6);
    expect(stream).toEqual(
      buildSprintStream(
        ["parallel", "typing", "speed", "focus", "rhythm", "words"],
        77,
      ),
    );
  });

  it("the horn verdict: words win, chars break the tie", () => {
    const mine: SprintRemoteState = { words: 10, chars: 40 };
    expect(resolveSprintVerdict(mine, { words: 9, chars: 100 })).toBe("won");
    expect(resolveSprintVerdict(mine, { words: 11, chars: 1 })).toBe("lost");
    expect(resolveSprintVerdict(mine, { words: 10, chars: 41 })).toBe("lost");
    expect(resolveSprintVerdict(mine, { words: 10, chars: 39 })).toBe("won");
    expect(resolveSprintVerdict(mine, { words: 10, chars: 40 })).toBe("draw");
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanSprint.encodeProgress({ words: 7, chars: 33 })).toEqual({
      words: 7,
      chars: 33,
    });
    expect(lanSprint.encodeProgress({ words: "nine" })).toEqual({
      words: 0,
      chars: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    expect(lanSprint.decodeProgress({ words: 3, chars: 12 })).toEqual({
      words: 3,
      chars: 12,
    });
    expect(lanSprint.decodeProgress({ words: 3 })).toBeUndefined();
    expect(lanSprint.decodeProgress({ words: -1, chars: 0 })).toBeUndefined();
    expect(lanSprint.decodeProgress("garbage")).toBeUndefined();
  });
});
