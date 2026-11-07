import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/runner/balance";
import {
  createRunnerEngine,
  type RunnerEngine,
} from "../../../src/ts/utils/runner/engine";
import {
  KINDS,
  kindIcon,
  nextObstacle,
  wordLenMax,
} from "../../../src/ts/utils/runner/gen";

const WORDS = ["cat", "sun", "map", "fox", "day", "ring", "mesh", "task"];

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function makeEngine(): RunnerEngine {
  return createRunnerEngine({
    pickWord: (minLen, maxLen) => {
      const fitting = WORDS.filter(
        (word) => word.length >= minLen && word.length <= maxLen,
      );
      return (fitting[0] ?? "cat").slice(0, Math.max(minLen, 3));
    },
    rng: makeRng(7),
  });
}

describe("runner gen (idea G15 phase 1, mode B)", () => {
  it("the three kinds cycle with valid icons", () => {
    expect(KINDS).toEqual(["jump", "slide", "destroy"]);
    expect(kindIcon("jump")).toBe("↑");
    expect(kindIcon("slide")).toBe("↓");
    expect(kindIcon("destroy")).toBe("✕");
  });

  it("the word cap shrinks with speed", () => {
    expect(wordLenMax(BALANCE.speedStartPxPerS)).toBe(BALANCE.wordLenMaxStart);
    expect(wordLenMax(BALANCE.speedMaxPxPerS)).toBe(BALANCE.wordLenMaxMin);
    expect(wordLenMax(BALANCE.speedMaxPxPerS + 500)).toBe(
      BALANCE.wordLenMaxMin,
    );
  });

  it("the gap decays per obstacle and clamps at the minimum", () => {
    const first = nextObstacle({
      id: 1,
      index: 0,
      speedPxPerS: BALANCE.speedStartPxPerS,
      rng: makeRng(7),
      pickWord: () => "cat",
    });
    const late = nextObstacle({
      id: 2,
      index: 200,
      speedPxPerS: BALANCE.speedStartPxPerS,
      rng: makeRng(7),
      pickWord: () => "cat",
    });
    expect(first.gapPx).toBe(BALANCE.gapStartPx);
    expect(late.gapPx).toBe(BALANCE.gapMinPx);
  });
});

describe("runner engine (idea G15 phase 1, mode B)", () => {
  it("the distance grows and the speed rises with it", () => {
    const engine = makeEngine();
    engine.tick(1000);
    const after = engine.state();
    expect(after.distancePx).toBeGreaterThan(0);
    const before = after.distancePx;
    for (let i = 0; i < 200; i++) engine.tick(50);
    const state = engine.state();
    expect(state.distancePx).toBeGreaterThan(before);
    expect(state.speedPxPerS).toBeGreaterThan(BALANCE.speedStartPxPerS);
  });

  it("typing the active obstacle's word clears it and builds the combo", () => {
    const engine = makeEngine();
    //run until an obstacle is close and active
    let guard = 0;
    while (engine.state().word.length === 0 && guard++ < 100) engine.tick(50);
    const word = engine.state().word;
    for (const ch of word) engine.feedKey(ch);
    const state = engine.state();
    expect(state.combo).toBe(1);
    expect(state.bestCombo).toBe(1);
    expect(state.hits).toBe(0);
  });

  it("an obstacle passing untyped costs a life; three end the run", () => {
    const engine = makeEngine();
    //never type: obstacles stream past — each costs a life
    let guard = 0;
    while (engine.state().phase === "running" && guard++ < 400) {
      engine.tick(50);
    }
    const state = engine.state();
    expect(state.phase).toBe("done");
    expect(state.lives).toBe(0);
    expect(state.hits).toBe(BALANCE.lives);
    expect(state.result?.distanceM).toBeGreaterThan(0);
  });

  it("a wrong key restarts the word without damage", () => {
    const engine = makeEngine();
    let guard = 0;
    while (engine.state().word.length === 0 && guard++ < 100) engine.tick(50);
    const before = engine.state();
    engine.feedKey("Ω");
    const state = engine.state();
    expect(state.typed).toBe(0);
    expect(state.lives).toBe(before.lives);
    expect(state.hits).toBe(before.hits);
  });

  it("the snapshot hands out fresh obstacle copies (the KI-34 lesson)", () => {
    const engine = makeEngine();
    engine.tick(100);
    const a = engine.state().obstacles;
    const b = engine.state().obstacles;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
