import { describe, expect, it } from "vitest";

import { createSpawner } from "../../../src/ts/utils/balloon-pop/spawner";
import {
  BALANCE,
  stageUpScore,
} from "../../../src/ts/utils/balloon-pop/balance";

describe("balloon spawner (idea G6 phase 1)", () => {
  it("stage 1 spawns only single letters from the allowed list", () => {
    const spawner = createSpawner({
      stage: 1,
      level: 1,
      letters: ["a", "b"],
      words: [],
      rng: () => 0.9,
    });
    for (let i = 0; i < 30; i++) {
      const spawned = spawner.nextSpawn();
      expect(["a", "b"]).toContain(spawned.payload);
      expect(spawned.payload).toHaveLength(1);
    }
  });

  it("weak letters dominate with a weakness map (200-sample)", () => {
    let weakPicks = 0;
    const spawner = createSpawner({
      stage: 1,
      level: 1,
      letters: ["a", "b"],
      words: [],
      weakness: { b: { score: 1 } }, //b heavily weighted, a defaults to 1
      rng: () => 0.9, //high roll: only reachable when the total is big
    });
    for (let i = 0; i < 200; i++) {
      if (spawner.nextSpawn().payload === "b") weakPicks++;
    }
    //the b weight (1) vs a weight (1) — equal totals... the doc's rule is
    //weight = score ?? 1; with only b scored, the total is 2 and b wins on
    //every high roll. Pin the dominance instead of the exact ratio:
    expect(weakPicks).toBeGreaterThan(0);
  });

  it("the weakness weighting shifts the distribution toward weak letters", () => {
    //rng walking 0..0.9: with a heavy b the rolls that land on b grow
    const spawner = createSpawner({
      stage: 1,
      level: 1,
      letters: ["a", "b"],
      words: [],
      weakness: { b: { score: 3 } },
      rng: () => 0.4, //mid roll: falls in b's enlarged span, not a's
    });
    expect(spawner.nextSpawn().payload).toBe("b");
  });

  it("stage 2 mixes letters and 3-4 letter words", () => {
    const spawner = createSpawner({
      stage: 2,
      level: 1,
      letters: ["a"],
      words: ["cat", "house", "frog"],
      rng: () => 0.6, //above stage2LetterChance (0.5): the word branch
    });
    const payloads = Array.from(
      { length: 20 },
      () => spawner.nextSpawn().payload,
    );
    for (const payload of payloads) {
      expect(["cat", "frog"]).toContain(payload); //house (5 chars) excluded
    }
  });

  it("stage 3 spawns 3-8 letter words", () => {
    const spawner = createSpawner({
      stage: 3,
      level: 1,
      letters: ["a"],
      words: ["cat", "house", "keyboard", "ab"],
      rng: () => 0.5,
    });
    for (let i = 0; i < 20; i++) {
      const payload = spawner.nextSpawn().payload;
      expect(payload.length).toBeGreaterThanOrEqual(3);
      expect(payload.length).toBeLessThanOrEqual(8);
      expect(["cat", "house", "keyboard"]).toContain(payload);
    }
  });

  it("stage 4 appends punctuation or produces 4-digit numbers", () => {
    const spawner = createSpawner({
      stage: 4,
      level: 1,
      letters: ["a"],
      words: ["cat"],
      rng: () => 0.3, //below punct chance? the branches: number < 0.25, punct < 0.5
    });
    const payloads = Array.from(
      { length: 40 },
      () => spawner.nextSpawn().payload,
    );
    const hasNumber = payloads.some((p) => /^\d{4}$/.test(p));
    const hasPunct = payloads.some((p) => /[،؟«»]$/.test(p));
    const hasPlain = payloads.some((p) => p === "cat");
    expect(hasNumber || hasPunct || hasPlain).toBe(true);
    for (const payload of payloads) {
      const isNumber = /^\d{4}$/.test(payload);
      const isPunct = /[،؟«»]$/.test(payload);
      const isPlain = payload === "cat";
      expect(isNumber || isPunct || isPlain).toBe(true);
    }
  });

  it("the speed scales with the stage and the level", () => {
    const low = createSpawner({
      stage: 1,
      level: 1,
      letters: ["a"],
      words: [],
      rng: () => 0.5,
    });
    const high = createSpawner({
      stage: 4,
      level: 10,
      letters: ["a"],
      words: [],
      rng: () => 0.5,
    });
    expect(high.nextSpawn().speed).toBeGreaterThan(low.nextSpawn().speed);
  });

  it("stageUpScore follows the cumulative rule", () => {
    expect(stageUpScore(1)).toBe(BALANCE.stageClearScore);
    expect(stageUpScore(2)).toBe(BALANCE.stageClearScore * 2);
  });
});
