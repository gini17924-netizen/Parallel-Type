import { describe, it, expect } from "vitest";

import {
  buildWordPools,
  comboMult,
  isDifficulty,
  levelForScore,
  pickBossWord,
  pickTarget,
  shouldSpawnHeart,
  spawnIntervalMs,
  spawnSpeed,
} from "../../src/ts/utils/word-blast";

const WORDS = [
  "cat",
  "house",
  "keyboard",
  "typing",
  "speed",
  "test",
  "quick",
  "brown",
  "jumped",
  "lazy",
];

describe("buildWordPools", () => {
  it("filters words by the difficulty length window", () => {
    const easy = buildWordPools(WORDS, "easy");
    expect(easy.wordPool.every((w) => w.length >= 3 && w.length <= 5)).toBe(
      true,
    );
    const hard = buildWordPools(WORDS, "hard");
    expect(hard.wordPool.every((w) => w.length >= 5 && w.length <= 10)).toBe(
      true,
    );
  });

  it("hard builds phrases, easy does not", () => {
    const easy = buildWordPools(WORDS, "easy");
    expect(easy.phrasePool).toHaveLength(0);
    const hard = buildWordPools(WORDS, "hard");
    expect(hard.phrasePool.length).toBeGreaterThan(0);
    for (const phrase of hard.phrasePool) {
      //phrases are 3 short words joined by spaces
      expect(phrase.split(" ").length).toBe(3);
    }
  });

  it("is deterministic in pool sizes (no empty pools with a decent list)", () => {
    const normal = buildWordPools(WORDS, "normal");
    expect(normal.wordPool.length).toBeGreaterThan(0);
    expect(normal.phrasePool.length).toBeGreaterThan(0);
  });
});

describe("pickTarget", () => {
  it("never returns phrases on easy", () => {
    const pools = buildWordPools(WORDS, "easy");
    for (let i = 0; i < 50; i++) {
      const target = pickTarget(pools, "easy");
      expect(target).toBeDefined();
      expect(target).not.toContain(" ");
    }
  });

  it("sometimes returns phrases on hard", () => {
    const pools = buildWordPools(WORDS, "hard");
    const withSpace = Array.from({ length: 200 }, () =>
      pickTarget(pools, "hard"),
    ).filter((t) => t?.includes(" "));
    expect(withSpace.length).toBeGreaterThan(0);
  });

  it("falls back to the phrase pool when the word pool is empty", () => {
    const pools = { wordPool: [], phrasePool: ["quick brown"] };
    expect(pickTarget(pools, "hard")).toBe("quick brown");
    expect(
      pickTarget({ wordPool: [], phrasePool: [] }, "easy"),
    ).toBeUndefined();
  });
});

describe("speed and spawn scaling", () => {
  it("hard words fall faster than easy ones at the same level", () => {
    const samples = (difficulty: "easy" | "normal" | "hard"): number[] =>
      Array.from({ length: 200 }, () => spawnSpeed(3, difficulty));
    const easyAvg = samples("easy").reduce((a, b) => a + b, 0) / 200;
    const hardAvg = samples("hard").reduce((a, b) => a + b, 0) / 200;
    expect(hardAvg).toBeGreaterThan(easyAvg);
  });

  it("spawn interval shrinks with level and difficulty", () => {
    expect(spawnIntervalMs(5, "normal")).toBeLessThan(
      spawnIntervalMs(1, "normal"),
    );
    expect(spawnIntervalMs(1, "hard")).toBeLessThan(spawnIntervalMs(1, "easy"));
  });
});

describe("isDifficulty", () => {
  it("validates stored values", () => {
    expect(isDifficulty("easy")).toBe(true);
    expect(isDifficulty("hard")).toBe(true);
    expect(isDifficulty("extreme")).toBe(false);
    expect(isDifficulty(null)).toBe(false);
  });
});

describe("word-blast v2 engine (idea G1)", () => {
  it("combo tiers hit exactly at their boundaries", () => {
    expect(comboMult(0)).toBe(1);
    expect(comboMult(4)).toBe(1);
    expect(comboMult(5)).toBe(1.5);
    expect(comboMult(9)).toBe(1.5);
    expect(comboMult(10)).toBe(2);
    expect(comboMult(19)).toBe(2);
    expect(comboMult(20)).toBe(3);
    expect(comboMult(100)).toBe(3);
  });

  it("levelForScore derives a level from every levelStep (fixes the modulo skip)", () => {
    expect(levelForScore(0)).toBe(1);
    expect(levelForScore(499)).toBe(1);
    expect(levelForScore(500)).toBe(2);
    expect(levelForScore(999)).toBe(2);
    expect(levelForScore(1001)).toBe(3);
  });

  it("pickBossWord takes the longest phrase, else the longest word", () => {
    const pools = buildWordPools(WORDS, "hard"); //hard builds phrases
    const boss = pickBossWord(pools);
    expect(boss).toBeDefined();
    expect(boss).toContain(" ");
    const bossLen = (boss ?? "").length;
    for (const phrase of pools.phrasePool) {
      expect(phrase.length).toBeLessThanOrEqual(bossLen);
    }
    //easy builds no phrases: the longest single word is the boss
    const easyBoss = pickBossWord(buildWordPools(WORDS, "easy"));
    expect(easyBoss).toBeDefined();
    expect(easyBoss).not.toContain(" ");
    expect(
      buildWordPools(WORDS, "easy").wordPool.every(
        (w) => w.length <= (easyBoss ?? "").length,
      ),
    ).toBe(true);
    //empty pools: no boss at all
    expect(pickBossWord({ wordPool: [], phrasePool: [] })).toBeUndefined();
  });

  it("shouldSpawnHeart rolls only on every Nth spawn, with the injected rng", () => {
    const always = (): number => 0; //always under heartChance
    const never = (): number => 1;
    expect(shouldSpawnHeart(0, always)).toBe(false);
    expect(shouldSpawnHeart(39, always)).toBe(false);
    expect(shouldSpawnHeart(41, always)).toBe(false);
    expect(shouldSpawnHeart(40, always)).toBe(true); //40th spawn, lucky roll
    expect(shouldSpawnHeart(40, never)).toBe(false); //unlucky roll
    expect(shouldSpawnHeart(80, always)).toBe(true); //next window
  });

  it("shouldSpawnHeart consumes a roll only at the multiples of 40 (200-sample)", () => {
    let rolls = 0;
    let hearts = 0;
    let count = 0;
    const rng = (): number => {
      rolls++;
      return (count++ % 10) / 10; //0, 0.1, ..., 0.9 cycling
    };
    for (let spawn = 1; spawn <= 200; spawn++) {
      if (shouldSpawnHeart(spawn, rng)) hearts++;
    }
    //five windows in 200 spawns (40, 80, 120, 160, 200), rolls 0/0.1/0.2/0.3/0.4
    expect(rolls).toBe(5);
    expect(hearts).toBe(4); //0.4 is not below heartChance (0.35)
  });
});
