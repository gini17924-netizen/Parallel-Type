import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/maze-runner/balance";
import { generateMaze } from "../../../src/ts/utils/maze-runner/maze";
import {
  bfsPath,
  countTurns,
  gateWordPicker,
  placeGates,
} from "../../../src/ts/utils/maze-runner/solver";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const WORDS = ["cat", "sun", "map", "fox", "day", "ring", "mesh", "task"];

describe("maze-runner solver (idea G14 phase 1)", () => {
  it("countTurns counts the direction changes", () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    expect(countTurns(straight)).toBe(0);
    const zigzag = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];
    expect(countTurns(zigzag)).toBe(2);
  });

  it("gates sit ON the path, spaced every k cells, never at the exit", () => {
    const maze = generateMaze(15, 11, makeRng(11));
    const path = bfsPath(maze);
    const gates = placeGates(path, BALANCE.gateEvery, () => "cat");
    expect(gates.length).toBeGreaterThan(0);
    for (let g = 0; g < gates.length; g++) {
      const gate = gates[g];
      expect(gate?.pathIndex).toBe((g + 1) * BALANCE.gateEvery);
      const onPath = path[gate?.pathIndex ?? -1];
      expect(gate?.cell).toEqual(onPath);
      expect(gate?.pathIndex).toBeLessThan(path.length - 1); //never the exit
    }
  });

  it("the gate word picker filters by length and stays deterministic", () => {
    const pool = WORDS.filter((word) => word.length === 3);
    expect(pool.length).toBeGreaterThan(2);
    const pick = gateWordPicker(WORDS, 3, 3, makeRng(7));
    const first = pick(0);
    expect(first).toHaveLength(3);
    const pick2 = gateWordPicker(WORDS, 3, 3, makeRng(7));
    expect(pick2(0)).toBe(first); //same seed → same words
    //the cycling: indexes beyond the pool wrap back to the start
    expect(pick(pool.length)).toBe(first);
  });

  it("a tiny maze still yields a connected path (the braid fallback)", () => {
    const maze = generateMaze(5, 4, makeRng(2));
    const path = bfsPath(maze);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 4, y: 3 });
  });
});
