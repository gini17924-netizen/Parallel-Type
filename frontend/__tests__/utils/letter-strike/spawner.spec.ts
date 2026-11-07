import { describe, expect, it } from "vitest";

import {
  BALANCE,
  waveShipCount,
} from "../../../src/ts/utils/letter-strike/balance";
import {
  createWaveSpawner,
  isTypeableWord,
} from "../../../src/ts/utils/letter-strike/spawner";

/** a tiny deterministic LCG so the same seed rebuilds the same wave */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const WORDS = [
  "cat",
  "dog",
  "bird",
  "fish",
  "house",
  "garden", //in range
  "ab", //too short
  "extraordinarily", //too long
  "h3llo", //symbol/digit
];

describe("letter strike spawner (idea G8 phase 1)", () => {
  it("wave ship counts step 4 -> 14 with a cap", () => {
    expect(waveShipCount(1)).toBe(4);
    expect(waveShipCount(2)).toBe(5);
    expect(waveShipCount(11)).toBe(14);
    expect(waveShipCount(30)).toBe(BALANCE.waveMaxShips);
  });

  it("filters non-typeable and out-of-range words", () => {
    expect(isTypeableWord("hello")).toBe(true);
    expect(isTypeableWord("h3llo")).toBe(false);
    expect(isTypeableWord("hello-world")).toBe(false);
    const spawner = createWaveSpawner({ words: WORDS, rng: makeRng(7) });
    const spawns = spawner.spawnWave(1);
    for (const spawn of spawns) {
      expect(spawn.word.length).toBeGreaterThanOrEqual(BALANCE.minWordLen);
      expect(spawn.word.length).toBeLessThanOrEqual(BALANCE.maxWordLen);
      expect(spawn.word).toMatch(/^\p{L}+$/u);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = createWaveSpawner({ words: WORDS, rng: makeRng(42) }).spawnWave(
      3,
    );
    const b = createWaveSpawner({ words: WORDS, rng: makeRng(42) }).spawnWave(
      3,
    );
    expect(a).toEqual(b);
  });

  it("speed scales with the wave", () => {
    const spawner = createWaveSpawner({ words: WORDS, rng: makeRng(42) });
    const w1 = spawner.spawnWave(1);
    const w10 = spawner.spawnWave(10);
    const avg = (list: { speed: number }[]): number =>
      list.reduce((sum, s) => sum + s.speed, 0) / list.length;
    expect(avg(w10)).toBeGreaterThan(avg(w1));
  });

  it("every 4th wave carries exactly one slower boss (10-14 letters)", () => {
    const longWords = ["administration", "communication", "extraordinary"];
    const spawner = createWaveSpawner({
      words: [...WORDS, ...longWords],
      rng: makeRng(3),
    });
    const w4 = spawner.spawnWave(4);
    const bosses = w4.filter((s) => s.isBoss);
    expect(bosses).toHaveLength(1);
    expect(bosses[0]?.word.length).toBeGreaterThanOrEqual(BALANCE.bossMinLen);
    expect(bosses[0]?.word.length).toBeLessThanOrEqual(BALANCE.bossMaxLen);
    //slower than the plain spawns of the same wave
    const plain = w4.filter((s) => !s.isBoss);
    const boss = bosses[0];
    expect(boss?.speed).toBeLessThan(Math.min(...plain.map((s) => s.speed)));
    //non-boss waves carry none
    expect(spawner.spawnWave(3).every((s) => !s.isBoss)).toBe(true);
  });

  it("falls back to the longest word when the language has no boss-length word", () => {
    const spawner = createWaveSpawner({
      words: ["cat", "house", "garden"],
      rng: makeRng(5),
    });
    const w4 = spawner.spawnWave(4);
    const boss = w4.find((s) => s.isBoss);
    expect(boss?.word).toBe("garden"); //the longest available
  });
});
