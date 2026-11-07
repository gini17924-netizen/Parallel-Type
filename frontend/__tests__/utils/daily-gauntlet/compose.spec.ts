import { describe, expect, it } from "vitest";

import {
  buildDaily,
  dayKeyOf,
  hashKey,
} from "../../../src/ts/utils/daily-gauntlet/compose";
import type { DailyPlayable } from "../../../src/ts/utils/games/game-registry";

function fakePlayable(gameId: string): DailyPlayable {
  return {
    gameId,
    runDailyStage: async (stage) => ({
      gameId: stage.gameId,
      normalized: 0,
      raw: {},
      won: false,
    }),
  };
}

describe("daily composer (idea G22 phase 3)", () => {
  it("hashKey is deterministic and spread out", () => {
    expect(hashKey("2026-11-08")).toBe(hashKey("2026-11-08"));
    expect(hashKey("2026-11-08")).not.toBe(hashKey("2026-11-09"));
    expect(hashKey("a")).not.toBe(hashKey("b"));
  });

  it("dayKeyOf pads the local date", () => {
    const key = dayKeyOf(new Date(2026, 10, 8)); //Nov 8 2026
    expect(key).toBe("2026-11-08");
    const early = dayKeyOf(new Date(2026, 2, 5)); //Mar 5 2026
    expect(early).toBe("2026-03-05");
  });

  it("composes 3 distinct stages, stable across reloads", () => {
    const games = [
      fakePlayable("word-blast"),
      fakePlayable("sprint"),
      fakePlayable("bot-duel"),
    ];
    const a = buildDaily("2026-11-08", games);
    const b = buildDaily("2026-11-08", games);
    expect(a).toEqual(b); //reload-stable
    expect(a).toHaveLength(3);
    const ids = a.map((stage) => stage.gameId);
    expect(new Set(ids).size).toBe(3); //no repeats
  });

  it("each stage's seed derives from dayKey + gameId", () => {
    const games = [
      fakePlayable("word-blast"),
      fakePlayable("sprint"),
      fakePlayable("bot-duel"),
    ];
    const stages = buildDaily("2026-11-08", games);
    for (const stage of stages) {
      expect(stage.seed).toBe(hashKey(`2026-11-08:${stage.gameId}`));
    }
  });

  it("the fallback: 2 registered games compose 2 stages", () => {
    const games = [fakePlayable("word-blast"), fakePlayable("sprint")];
    const stages = buildDaily("2026-11-08", games);
    expect(stages).toHaveLength(2);
    expect(new Set(stages.map((s) => s.gameId)).size).toBe(2);
  });

  it("a different day composes a different order (usually)", () => {
    const games = [
      fakePlayable("word-blast"),
      fakePlayable("sprint"),
      fakePlayable("bot-duel"),
    ];
    const monday = buildDaily("2026-11-02", games)
      .map((s) => s.gameId)
      .join();
    const tuesday = buildDaily("2026-11-03", games)
      .map((s) => s.gameId)
      .join();
    //hash-driven: different days pick different orders
    expect(monday === tuesday).toBe(false);
  });

  it("stages carry titles and the day's params", () => {
    const games = [
      fakePlayable("word-blast"),
      fakePlayable("sprint"),
      fakePlayable("bot-duel"),
    ];
    const stages = buildDaily("2026-11-08", games);
    for (const stage of stages) {
      expect(stage.title.length).toBeGreaterThan(0);
      expect(stage.title).not.toBe(stage.gameId); //the title table hit
      expect(stage.params).toBeDefined();
    }
    const blast = stages.find((s) => s.gameId === "word-blast");
    expect(blast?.params).toMatchObject({ difficulty: "normal" });
  });
});
