import { describe, expect, it } from "vitest";

import {
  createFireSim,
  neighborsOf,
} from "../../../src/ts/utils/firefight/sim";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe("firefight sim (idea G16 phase 1)", () => {
  it("neighborsOf: corners have 2, edges 3, centers 4", () => {
    //3x3 grid: idx 0 = corner (top-left), idx 1 = edge, idx 4 = center
    expect(neighborsOf(0, 3, 3)).toEqual([3, 1]);
    expect(neighborsOf(1, 3, 3)).toEqual([4, 0, 2]);
    expect(neighborsOf(4, 3, 3)).toEqual([1, 7, 3, 5]);
  });

  it("a burning cell ignites one intact neighbor per spread tick", () => {
    const sim = createFireSim({
      wordFor: () => "fire",
      rng: makeRng(7),
      cols: 3,
      rows: 3,
    });
    expect(sim.burningIndices()).toHaveLength(1);
    const ignited = sim.burningIndices()[0] ?? 0;
    //advance past the first spread interval (6s at the start)
    for (let i = 0; i < 130; i++) sim.tick(50);
    expect(sim.burningIndices().length).toBeGreaterThan(1);
    //the original cell is still burning (the burn duration is 12s)
    expect(sim.burningIndices()).toContain(ignited);
    expect(sim.cells[ignited]?.state).toBe("burning");
  });

  it("a burning cell turns to ashes after the burn duration", () => {
    const sim = createFireSim({
      wordFor: () => "fire",
      rng: makeRng(7),
      cols: 3,
      rows: 3,
    });
    const ignited = sim.burningIndices()[0] ?? 0;
    //12s of burn: THE cell goes to ashes at exactly its burn duration
    for (let i = 0; i < 260; i++) sim.tick(50);
    expect(sim.cells[ignited]?.state).toBe("ashes");
    expect(sim.cells[ignited]?.word).toBeUndefined();
  });

  it("the spread interval shrinks from 6s toward 2.5s over the run", () => {
    const sim = createFireSim({
      wordFor: () => "fire",
      rng: makeRng(7),
      cols: 3,
      rows: 3,
    });
    expect(sim.spreadIntervalAt(0)).toBe(6000);
    expect(sim.spreadIntervalAt(120_000)).toBe(2500);
    expect(sim.spreadIntervalAt(60_000)).toBe(4250); //the midpoint
  });

  it("the ash ratio tracks the burned cells", () => {
    const sim = createFireSim({
      wordFor: () => "fire",
      rng: makeRng(7),
      cols: 3,
      rows: 3,
    });
    expect(sim.ashRatio()).toBe(0);
    for (let i = 0; i < 300; i++) sim.tick(50);
    expect(sim.ashCount()).toBeGreaterThan(0);
    expect(sim.ashRatio()).toBeGreaterThan(0);
    expect(sim.ashRatio()).toBeLessThanOrEqual(1);
  });
});
