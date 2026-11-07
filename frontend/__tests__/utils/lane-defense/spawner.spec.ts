import { describe, expect, it } from "vitest";

import {
  BALANCE,
  waveEnemyCount,
} from "../../../src/ts/utils/lane-defense/balance";
import { createWaveSpawner } from "../../../src/ts/utils/lane-defense/spawner";

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
  "garden",
  "defender",
  "guardian",
];

describe("lane defense spawner (idea G9 phase 1)", () => {
  it("wave enemy counts step 5 -> 12 with a cap", () => {
    expect(waveEnemyCount(1)).toBe(5);
    expect(waveEnemyCount(2)).toBe(6);
    expect(waveEnemyCount(8)).toBe(12);
    expect(waveEnemyCount(40)).toBe(BALANCE.waveMaxEnemies);
  });

  it("zone filtering: every enemy word stays inside the zone letters", () => {
    const spawner = createWaveSpawner({
      words: WORDS,
      rng: makeRng(11),
      zoneLetters: "eta",
    });
    for (const enemy of spawner.spawnWave(2)) {
      for (const ch of enemy.word) {
        expect(["e", "t", "a"]).toContain(ch);
      }
    }
  });

  it("a tiny zone falls back to pseudo-words from the zone letters", () => {
    const spawner = createWaveSpawner({
      words: WORDS,
      rng: makeRng(11),
      zoneLetters: "fj", //no real english word here
    });
    const spawns = spawner.spawnWave(1);
    expect(spawns.length).toBeGreaterThan(0);
    for (const enemy of spawns) {
      for (const ch of enemy.word) {
        expect(["f", "j"]).toContain(ch);
      }
    }
  });

  it("every 3rd wave carries exactly one slower tank with a long word", () => {
    const spawner = createWaveSpawner({ words: WORDS, rng: makeRng(3) });
    const w3 = spawner.spawnWave(3);
    const tanks = w3.filter((s) => s.isTank);
    expect(tanks).toHaveLength(1);
    expect(tanks[0]?.word.length).toBeGreaterThanOrEqual(BALANCE.tankMinLen);
    const plain = w3.filter((s) => !s.isTank);
    expect(tanks[0]?.speed).toBeLessThan(
      Math.min(...plain.map((s) => s.speed)),
    );
    expect(spawner.spawnWave(2).every((s) => !s.isTank)).toBe(true);
  });

  it("lanes stay within 0..4; the same seed rebuilds the same wave", () => {
    const spawner = createWaveSpawner({ words: WORDS, rng: makeRng(42) });
    const a = spawner.spawnWave(4);
    const b = createWaveSpawner({ words: WORDS, rng: makeRng(42) }).spawnWave(
      4,
    );
    expect(a).toEqual(b);
    for (const enemy of a) {
      expect(enemy.lane).toBeGreaterThanOrEqual(0);
      expect(enemy.lane).toBeLessThan(BALANCE.lanes);
    }
  });
});
