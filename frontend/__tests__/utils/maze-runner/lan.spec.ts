import { beforeEach, describe, expect, it } from "vitest";

import {
  lanMaze,
  resolveMazeVerdict,
  type MazeRemoteState,
} from "../../../src/ts/utils/maze-runner/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("maze-runner LanPlayable (online wave, phase 11)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanMaze);
  });

  it("is a registry member with the maze route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("maze-runner");
    const game = getLanGame("maze-runner");
    expect(game?.route).toBe("/games/maze-runner");
    expect(game?.label).toBe("maze runner");
    expect(game?.icon).toBe("fa-dungeon");
  });

  it("buildStart seeds the match and carries lang + level", () => {
    const start = lanMaze.buildStart({ lang: "farsi", level: 2 });
    expect(start.gameId).toBe("maze-runner");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", level: 2 });
  });

  it("buildStart clamps the level into the balance range", () => {
    expect(lanMaze.buildStart({}).params).toEqual({
      lang: "english",
      level: 1,
    });
    expect(lanMaze.buildStart({ level: 99 }).params).toEqual({
      lang: "english",
      level: 3,
    });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanMaze.buildStart({ lang: "english", level: 2 });
    expect(lanMaze.validateStart(good)).toBe(true);
    expect(lanMaze.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanMaze.validateStart({ ...good, params: { lang: "english", level: 4 } }),
    ).toBe(false);
    expect(
      lanMaze.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(lanMaze.validateStart({ ...good, params: { level: 2 } })).toBe(
      false,
    );
  });

  it("the verdict: the lower total time wins, the exact tie draws", () => {
    expect(resolveMazeVerdict({ timeMs: 8000 }, { timeMs: 9000 })).toBe("won");
    expect(resolveMazeVerdict({ timeMs: 9000 }, { timeMs: 8000 })).toBe("lost");
    expect(resolveMazeVerdict({ timeMs: 8000 }, { timeMs: 8000 })).toBe("draw");
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanMaze.encodeProgress({ runner: 12, gates: 3 })).toEqual({
      runner: 12,
      gates: 3,
    });
    expect(lanMaze.encodeProgress({ runner: "far" })).toEqual({
      runner: 0,
      gates: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: MazeRemoteState = { runner: 9, gates: 2 };
    expect(lanMaze.decodeProgress({ runner: 9, gates: 2 })).toEqual(state);
    expect(lanMaze.decodeProgress({ runner: 9 })).toBeUndefined();
    expect(lanMaze.decodeProgress({ runner: -2, gates: 0 })).toBeUndefined();
    expect(lanMaze.decodeProgress("garbage")).toBeUndefined();
  });
});
