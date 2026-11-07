import { describe, expect, it } from "vitest";

import {
  getDailyPlayable,
  listDailyPlayables,
  registerDailyPlayable,
  _resetDailyRegistryForTests,
  type DailyPlayable,
  type DailyStage,
  type DailyStageResult,
} from "../../../src/ts/utils/games/game-registry";

function fakePlayable(gameId: string): DailyPlayable {
  return {
    gameId,
    runDailyStage: async (stage: DailyStage): Promise<DailyStageResult> => ({
      gameId: stage.gameId,
      normalized: 500,
      raw: { score: 42 },
      won: true,
    }),
  };
}

describe("daily gauntlet registry (idea G22 phase 1)", () => {
  it("registers a wrapper and hands it back by gameId", () => {
    _resetDailyRegistryForTests();
    const impl = fakePlayable("word-blast");
    registerDailyPlayable(impl);
    expect(getDailyPlayable("word-blast")).toBe(impl);
  });

  it("a double registration throws (a fork bug)", () => {
    _resetDailyRegistryForTests();
    registerDailyPlayable(fakePlayable("sprint"));
    expect(() => registerDailyPlayable(fakePlayable("sprint"))).toThrow(
      "daily playable already registered: sprint",
    );
  });

  it("list returns the wrappers in registration order", () => {
    _resetDailyRegistryForTests();
    registerDailyPlayable(fakePlayable("word-blast"));
    registerDailyPlayable(fakePlayable("sprint"));
    registerDailyPlayable(fakePlayable("bot-duel"));
    expect(listDailyPlayables().map((it) => it.gameId)).toEqual([
      "word-blast",
      "sprint",
      "bot-duel",
    ]);
  });

  it("the contract: runDailyStage resolves the stage's result", async () => {
    _resetDailyRegistryForTests();
    registerDailyPlayable(fakePlayable("word-blast"));
    const impl = getDailyPlayable("word-blast");
    expect(impl).toBeDefined();
    const stage: DailyStage = {
      gameId: "word-blast",
      title: "daily word blast",
      seed: 12345,
      params: { targetScore: 3000 },
    };
    const result = await impl?.runDailyStage(stage);
    expect(result?.gameId).toBe("word-blast");
    expect(result?.normalized).toBe(500);
    expect(result?.won).toBe(true);
  });

  it("an unknown gameId looks up to undefined", () => {
    _resetDailyRegistryForTests();
    expect(getDailyPlayable("nope")).toBeUndefined();
  });

  it("the reset hook empties the registry", () => {
    _resetDailyRegistryForTests();
    registerDailyPlayable(fakePlayable("sprint"));
    _resetDailyRegistryForTests();
    expect(listDailyPlayables()).toHaveLength(0);
  });
});
