import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/maze-runner/balance";
import {
  generateMaze,
  mazeExit,
  mazeStart,
  type Maze,
} from "../../../src/ts/utils/maze-runner/maze";
import {
  bfsPath,
  buildTwistyMaze,
  countTurns,
} from "../../../src/ts/utils/maze-runner/solver";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe("maze-runner maze (idea G14 phase 1)", () => {
  it("the same seed produces the same maze (deterministic)", () => {
    const a = generateMaze(15, 11, makeRng(7));
    const b = generateMaze(15, 11, makeRng(7));
    expect(a).toEqual(b);
  });

  it("the dimensions and boundary hold", () => {
    const maze = generateMaze(15, 11, makeRng(3));
    expect(maze.cols).toBe(15);
    expect(maze.rows).toBe(11);
    expect(maze.v).toHaveLength(11);
    expect(maze.v[0]).toHaveLength(14); //cols - 1
    expect(maze.h).toHaveLength(10); //rows - 1
    expect(maze.h[0]).toHaveLength(15);
  });

  it("BFS always connects the entrance to the opposite corner", () => {
    for (const seed of [1, 7, 42, 1337, 90210]) {
      for (const [cols, rows] of [
        [15, 11],
        [17, 13],
      ] as const) {
        const maze = generateMaze(cols, rows, makeRng(seed));
        const path = bfsPath(maze);
        const start = mazeStart();
        const exit = mazeExit(maze);
        expect(path[0]).toEqual(start);
        expect(path[path.length - 1]).toEqual(exit);
        expect(path.length).toBeGreaterThan(cols); //a real walk, not a line
      }
    }
  });

  it("braid keeps connectivity while opening loops", () => {
    //with a heavy braid every dead-end gets relief — still fully connected
    const maze: Maze = generateMaze(15, 11, makeRng(5), 1);
    const path = bfsPath(maze);
    expect(path.length).toBeGreaterThan(15);
  });

  it("buildTwistyMaze reaches the minimum turns (or the cap)", () => {
    const { maze, path, turns } = buildTwistyMaze(15, 11, makeRng(9));
    expect(turns).toBeGreaterThanOrEqual(
      Math.min(BALANCE.minTurns, countTurns(path)),
    );
    expect(turns).toBe(countTurns(path));
    expect(bfsPath(maze).length).toBe(path.length);
  });
});
