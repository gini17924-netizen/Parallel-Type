import { describe, expect, it } from "vitest";

import {
  canPlace,
  clearFullRows,
  emptyGrid,
  place,
  refillRows,
  supportedBelow,
} from "../../../src/ts/utils/stack-attack/grid";

function filled(): ReturnType<typeof emptyGrid> {
  const grid = emptyGrid(4, 3);
  place(grid, 3, 0, "abc", 1); //the bottom row full
  return grid;
}

describe("stack attack grid (idea G12 phase 1)", () => {
  it("canPlace rejects occupied cells and out-of-bounds columns", () => {
    const grid = emptyGrid(4, 3);
    expect(canPlace(grid, 2, 0, 3)).toBe(true);
    place(grid, 2, 0, "abc", 1);
    expect(canPlace(grid, 2, 1, 2)).toBe(false); //occupied
    expect(canPlace(grid, 2, -1, 2)).toBe(false); //out of bounds
    expect(canPlace(grid, 2, 2, 2)).toBe(false); //overruns the right edge
    expect(canPlace(grid, 2, 0, 1)).toBe(false);
  });

  it("place writes the block's letters in order", () => {
    const grid = emptyGrid(2, 5);
    place(grid, 1, 1, "word", 7);
    expect(grid[1]?.[1]?.letter).toBe("w");
    expect(grid[1]?.[2]?.letter).toBe("o");
    expect(grid[1]?.[3]?.letter).toBe("r");
    expect(grid[1]?.[4]?.letter).toBe("d");
  });

  it("supportedBelow: the floor and occupied cells both support", () => {
    const grid = emptyGrid(3, 3);
    expect(supportedBelow(grid, 1, 0, 2)).toBe(false); //empty below
    expect(supportedBelow(grid, 2, 0, 2)).toBe(true); //the floor
    place(grid, 2, 0, "cat", 1);
    expect(supportedBelow(grid, 1, 0, 2)).toBe(true);
  });

  it("clearFullRows clears one row and shifts the above down", () => {
    const grid = emptyGrid(4, 4);
    place(grid, 3, 0, "abcd", 1); //the bottom row full
    place(grid, 1, 0, "xyz", 2); //a marker two rows up (not a full row)
    const lines = clearFullRows(grid);
    expect(lines).toBe(1);
    //the engine's real sequence: clear then re-pad the top — the marker
    //visually fell one row (one row below it was removed)
    refillRows(grid, 4, 4);
    expect(grid[2]?.[0]?.letter).toBe("x");
    expect(grid[3]?.every((c) => c === undefined)).toBe(true);
  });

  it("clearFullRows handles two rows at once", () => {
    const grid = emptyGrid(4, 2);
    place(grid, 2, 0, "ab", 1);
    place(grid, 3, 0, "cd", 2); //two full rows (2-wide grid)
    const lines = clearFullRows(grid);
    expect(lines).toBe(2);
    expect(grid.every((row) => row.every((c) => c === undefined))).toBe(true);
  });

  it("refillRows restores the height after clears", () => {
    const grid = filled();
    clearFullRows(grid);
    expect(grid.length).toBe(3);
    refillRows(grid, 4, 3);
    expect(grid.length).toBe(4);
    expect(grid[0]?.every((c) => c === undefined)).toBe(true);
  });
});
