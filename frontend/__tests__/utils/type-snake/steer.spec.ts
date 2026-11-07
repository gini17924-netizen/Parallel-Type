import { describe, expect, it } from "vitest";

import { keyOf } from "../../../src/ts/utils/type-snake/grid";
import { nextCell } from "../../../src/ts/utils/type-snake/steer";

const COLS = 24;
const ROWS = 18;

describe("type snake steering (idea G11 phase 1)", () => {
  it("walks dx first (the fixed tiebreak)", () => {
    const next = nextCell(
      { x: 0, y: 0 },
      { x: 3, y: 2 },
      new Set(),
      COLS,
      ROWS,
    );
    expect(next).toEqual({ x: 1, y: 0 }); //dx before dy
  });

  it("takes the dy route when the dx step is blocked", () => {
    const blocked = new Set([keyOf({ x: 1, y: 0 })]);
    const next = nextCell({ x: 0, y: 0 }, { x: 3, y: 2 }, blocked, COLS, ROWS);
    expect(next).toEqual({ x: 0, y: 1 });
  });

  it("refuses walls and body cells", () => {
    //at the left wall: dx toward x<0 is refused, dy survives
    const next = nextCell(
      { x: 0, y: 5 },
      { x: 0, y: 8 },
      new Set(),
      COLS,
      ROWS,
    );
    expect(next).toEqual({ x: 0, y: 6 });
    //a body cell on the route: the other axis is taken
    const blocked = new Set([keyOf({ x: 0, y: 6 })]);
    const next2 = nextCell({ x: 0, y: 5 }, { x: 0, y: 8 }, blocked, COLS, ROWS);
    //dx=0; dy blocked -> survival fallback picks the most open neighbor
    expect(next2).not.toBeNull();
    expect(next2 && keyOf(next2)).not.toBe(keyOf({ x: 0, y: 6 }));
  });

  it("the survival fallback picks the most open neighbor", () => {
    //both route steps (dx, dy) are blocked; the fallback scans freely
    const blocked = new Set([
      keyOf({ x: 5, y: 5 }), //the head itself
      keyOf({ x: 6, y: 5 }), //the dx step
      keyOf({ x: 5, y: 6 }), //the dy step
    ]);
    const next = nextCell({ x: 5, y: 5 }, { x: 10, y: 5 }, blocked, COLS, ROWS);
    //free neighbors: left (4,5) and up (5,4); left comes first in the scan
    expect(next).toEqual({ x: 4, y: 5 });
  });

  it("a fully surrounded snake has no step (undefined = death)", () => {
    const blocked = new Set([
      keyOf({ x: 1, y: 5 }), //right
      keyOf({ x: 0, y: 6 }), //down
      keyOf({ x: 0, y: 4 }), //up
      //left (x=-1) is outside the grid — a wall
    ]);
    const next = nextCell({ x: 0, y: 5 }, { x: 10, y: 5 }, blocked, COLS, ROWS);
    expect(next).toBeUndefined();
  });
});
