import { beforeEach, describe, expect, it } from "vitest";

import { DAILY_PARAMS } from "../../../src/ts/utils/daily-gauntlet/params";
import {
  _resetDailyStageBridgeForTests,
  hasPendingDailyStage,
  resolveDailyStage,
  takePendingDailyStage,
} from "../../../src/ts/utils/daily-gauntlet/stage-bridge";
import {
  getDailyPlayable,
  listDailyPlayables,
  _resetDailyRegistryForTests,
  type DailyStage,
} from "../../../src/ts/utils/games/game-registry";
import {
  normalizeBotDuelDaily,
  registerDailyBotDuel,
} from "../../../src/ts/utils/bot-duel/daily";
import {
  normalizeSprintDaily,
  registerDailySprint,
} from "../../../src/ts/utils/sprint/daily";
import {
  normalizeWordBlastDaily,
  registerDailyWordBlast,
} from "../../../src/ts/utils/word-blast/daily";

const STAGE: DailyStage = {
  gameId: "word-blast",
  title: "daily word blast",
  seed: 4242,
  params: {},
};

describe("daily wrappers (idea G22 phase 2)", () => {
  beforeEach(() => {
    _resetDailyRegistryForTests();
    _resetDailyStageBridgeForTests();
  });

  it("word-blast normalize: off, on-target, ceiling", () => {
    expect(normalizeWordBlastDaily({ score: 0 })).toBe(0);
    expect(
      normalizeWordBlastDaily({ score: DAILY_PARAMS.wordBlast.targetScore }),
    ).toBe(1000);
    expect(
      normalizeWordBlastDaily({
        score: DAILY_PARAMS.wordBlast.targetScore * 5,
      }),
    ).toBe(1000); //the ceiling
    expect(normalizeWordBlastDaily({ score: -50 })).toBe(0); //the floor
    expect(normalizeWordBlastDaily({ score: NaN })).toBe(0);
  });

  it("sprint normalize: off, on-target, ceiling", () => {
    expect(normalizeSprintDaily({ wpm: 0 })).toBe(0);
    expect(normalizeSprintDaily({ wpm: DAILY_PARAMS.sprint.targetWpm })).toBe(
      1000,
    );
    expect(normalizeSprintDaily({ wpm: 250 })).toBe(1000); //the ceiling
    expect(normalizeSprintDaily({ wpm: 50 })).toBe(500);
  });

  it("bot-duel normalize: the documented table", () => {
    //win: 650 + accuracy×3
    expect(normalizeBotDuelDaily({ result: "won", accuracy: 0 })).toBe(650);
    expect(normalizeBotDuelDaily({ result: "won", accuracy: 100 })).toBe(950);
    //loss: accuracy×2
    expect(normalizeBotDuelDaily({ result: "lost", accuracy: 100 })).toBe(200);
    expect(normalizeBotDuelDaily({ result: "lost", accuracy: 0 })).toBe(0);
    //draw: fixed 400
    expect(normalizeBotDuelDaily({ result: "draw", accuracy: 50 })).toBe(400);
    //junk accuracy clamps
    expect(normalizeBotDuelDaily({ result: "won", accuracy: 999 })).toBe(950);
  });

  it("registering the three wrappers fills the registry", () => {
    registerDailyWordBlast();
    registerDailySprint();
    registerDailyBotDuel();
    expect(listDailyPlayables().map((it) => it.gameId)).toEqual([
      "word-blast",
      "sprint",
      "bot-duel",
    ]);
    expect(getDailyPlayable("sprint")).toBeDefined();
  });

  it("runDailyStage arms the bridge; the game resolves the promise", async () => {
    registerDailyWordBlast();
    const impl = getDailyPlayable("word-blast");
    expect(impl).toBeDefined();
    const pending = impl?.runDailyStage(STAGE);
    expect(hasPendingDailyStage()).toBe(true);
    expect(takePendingDailyStage("word-blast")?.seed).toBe(4242);
    expect(takePendingDailyStage("sprint")).toBeUndefined(); //another game
    resolveDailyStage({
      gameId: "word-blast",
      normalized: 750,
      raw: { score: 2250 },
      won: true,
    });
    const result = await pending;
    expect(result?.normalized).toBe(750);
    expect(hasPendingDailyStage()).toBe(false); //consumed
  });

  it("a resolve for the wrong gameId is ignored", async () => {
    registerDailySprint();
    const impl = getDailyPlayable("sprint");
    const pending = impl?.runDailyStage({ ...STAGE, gameId: "sprint" });
    resolveDailyStage({
      gameId: "word-blast", //not the armed game
      normalized: 999,
      raw: {},
      won: true,
    });
    expect(hasPendingDailyStage()).toBe(true); //still armed
    resolveDailyStage({
      gameId: "sprint",
      normalized: 300,
      raw: { wpm: 30 },
      won: false,
    });
    const result = await pending;
    expect(result?.normalized).toBe(300);
  });
});
