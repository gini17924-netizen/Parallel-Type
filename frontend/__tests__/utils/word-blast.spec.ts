import { describe, it, expect } from "vitest";

import {
  buildWordPools,
  isDifficulty,
  pickTarget,
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
