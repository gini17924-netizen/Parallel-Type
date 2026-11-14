import { beforeEach, describe, expect, it } from "vitest";

import {
  ACHIEVEMENTS,
  evaluateAchievements,
  type AchievementSnapshot,
} from "../../src/ts/utils/achievements/definitions";
import {
  cabinetBadges,
  resetAchievements,
  syncAchievements,
  unlockedAchievements,
  unlockedCount,
} from "../../src/ts/utils/achievements/state";

const TIERS = new Set(["bronze", "silver", "gold"]);

const EMPTY: AchievementSnapshot = {
  totalTests: 0,
  bestWpm: 0,
  bestAcc: 0,
  gauntletMaxStreak: 0,
  gamesWithBest: 0,
  lanGamesChampioned: 0,
  customThemesCount: 0,
};

describe("phase 97 — the achievement definitions (pure criteria)", () => {
  it("every badge carries a complete identity", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(12);
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.title.trim(), a.id).not.toBe("");
      expect(a.description.trim(), a.id).not.toBe("");
      expect(a.icon.trim(), a.id).not.toBe("");
      expect(TIERS.has(a.tier), `tier of ${a.id}`).toBe(true);
    }
  });

  it("an empty snapshot earns nothing", () => {
    expect(evaluateAchievements(EMPTY).size).toBe(0);
  });

  it("the test-count ladder unlocks step by step", () => {
    const ids = (tests: number): Set<string> =>
      evaluateAchievements({ ...EMPTY, totalTests: tests });
    expect([...ids(1)]).toEqual(["first-steps"]);
    expect([...ids(10)]).toEqual(["first-steps", "ten-tests"]);
    expect([...ids(100)]).toEqual([
      "first-steps",
      "ten-tests",
      "fifty-tests",
      "century",
    ]);
  });

  it("the speed and accuracy criteria read their snapshot fields", () => {
    expect([
      ...evaluateAchievements({ ...EMPTY, bestWpm: 100, bestAcc: 98 }),
    ]).toEqual(["speed-60", "speed-100", "sharp-eye"]);
  });

  it("the games, lan and maker criteria read theirs too", () => {
    expect(
      [
        ...evaluateAchievements({
          ...EMPTY,
          gamesWithBest: 8,
          lanGamesChampioned: 2,
          customThemesCount: 1,
        }),
      ].sort(),
    ).toEqual(["arcade-hero", "gamer", "lan-champion", "theme-smith"]);
  });
});

describe("phase 97 — the unlocked store (sync semantics)", () => {
  beforeEach(() => {
    resetAchievements();
  });

  it("sync stamps the newly-earned badges once", () => {
    const fresh = syncAchievements({ ...EMPTY, totalTests: 1 });
    expect(fresh).toEqual(["first-steps"]);
    expect(unlockedCount()).toBe(1);
    const at = unlockedAchievements()["first-steps"];
    expect(typeof at).toBe("number");
    //a repeat sync earns nothing new and keeps the original timestamp
    expect(syncAchievements({ ...EMPTY, totalTests: 1 })).toEqual([]);
    expect(unlockedAchievements()["first-steps"]).toBe(at);
  });

  it("the timestamp survives later unlocks", () => {
    syncAchievements({ ...EMPTY, totalTests: 1 });
    const firstAt = unlockedAchievements()["first-steps"];
    const fresh = syncAchievements({ ...EMPTY, totalTests: 100 });
    expect(fresh).toEqual(["ten-tests", "fifty-tests", "century"]);
    expect(unlockedAchievements()["first-steps"]).toBe(firstAt);
    expect(unlockedCount()).toBe(4);
  });

  it("the cabinet lists every definition with its unlock state", () => {
    syncAchievements({ ...EMPTY, bestWpm: 150 });
    const badges = cabinetBadges();
    expect(badges).toHaveLength(ACHIEVEMENTS.length);
    const lightning = badges.find((b) => b.id === "speed-150");
    expect(lightning?.unlockedAt).toBeDefined();
    const first = badges.find((b) => b.id === "first-steps");
    expect(first?.unlockedAt).toBeUndefined();
  });

  it("reset wipes the store", () => {
    syncAchievements({ ...EMPTY, totalTests: 10 });
    resetAchievements();
    expect(unlockedCount()).toBe(0);
    expect(syncAchievements({ ...EMPTY, totalTests: 10 })).toEqual([
      "first-steps",
      "ten-tests",
    ]);
  });
});
