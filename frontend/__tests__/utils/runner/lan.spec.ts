import { beforeEach, describe, expect, it } from "vitest";

import {
  lanRunner,
  resolveRunnerVerdict,
  runnerLanPickWord,
  type RunnerRemoteState,
} from "../../../src/ts/utils/runner/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("runner LanPlayable (online wave, phase 17)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanRunner);
  });

  it("is a registry member with the runner route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("runner");
    const game = getLanGame("runner");
    expect(game?.route).toBe("/games/runner");
    expect(game?.label).toBe("endless runner");
    expect(game?.icon).toBe("fa-running");
  });

  it("buildStart seeds the match and carries lang + target meters", () => {
    const start = lanRunner.buildStart({ lang: "farsi", meters: 300 });
    expect(start.gameId).toBe("runner");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", meters: 300 });
  });

  it("buildStart applies the documented defaults", () => {
    const start = lanRunner.buildStart({});
    expect(start.params).toEqual({ lang: "english", meters: 400 });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanRunner.buildStart({ lang: "english", meters: 400 });
    expect(lanRunner.validateStart(good)).toBe(true);
    expect(lanRunner.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanRunner.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(lanRunner.validateStart({ ...good, params: { meters: 400 } })).toBe(
      false,
    );
  });

  it("the seeded pickWord is deterministic and length-windowed", () => {
    const pool = ["a", "run", "jump", "typed", "runner", "slid", "gate"];
    const pickA = runnerLanPickWord(pool, 88);
    const pickB = runnerLanPickWord(pool, 88);
    //the same call sequence -> the identical words on both machines
    const seqA = [pickA(3, 6), pickA(3, 4), pickA(4, 6)];
    const seqB = [pickB(3, 6), pickB(3, 4), pickB(4, 6)];
    expect(seqA).toEqual(seqB);
    //every pick respects the length window
    expect(seqA[0]?.length).toBeGreaterThanOrEqual(3);
    expect(seqA[0]?.length).toBeLessThanOrEqual(6);
    expect(seqA[1]?.length).toBeGreaterThanOrEqual(3); //the 3..4 window
    expect(seqA[1]?.length).toBeLessThanOrEqual(4);
    //a different seed reshuffles
    const pickC = runnerLanPickWord(pool, 89);
    expect([pickC(3, 6), pickC(3, 4)]).not.toEqual(seqA);
  });

  it("runnerLanPickWord survives an empty pool with a fallback", () => {
    const pick = runnerLanPickWord([], 5);
    const word = pick(3, 6);
    expect(["run", "jump", "type"]).toContain(word);
  });

  it("the finish-line verdict: the lower finish time wins", () => {
    expect(resolveRunnerVerdict({ finishMs: 8000 }, { finishMs: 9000 })).toBe(
      "won",
    );
    expect(resolveRunnerVerdict({ finishMs: 9000 }, { finishMs: 8000 })).toBe(
      "lost",
    );
    expect(resolveRunnerVerdict({ finishMs: 8000 }, { finishMs: 8000 })).toBe(
      "draw",
    );
  });

  it("progress encoding coerces garbage to the defaults", () => {
    expect(lanRunner.encodeProgress({ meters: 320, lives: 2 })).toEqual({
      meters: 320,
      lives: 2,
    });
    expect(lanRunner.encodeProgress({ meters: "far" })).toEqual({
      meters: 0,
      lives: 3, //the balance default
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: RunnerRemoteState = { meters: 280, lives: 1 };
    expect(lanRunner.decodeProgress({ meters: 280, lives: 1 })).toEqual(state);
    expect(lanRunner.decodeProgress({ meters: 280 })).toBeUndefined();
    expect(lanRunner.decodeProgress({ meters: -3, lives: 0 })).toBeUndefined();
    expect(lanRunner.decodeProgress("garbage")).toBeUndefined();
  });
});
