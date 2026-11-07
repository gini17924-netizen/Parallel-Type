import { describe, expect, it } from "vitest";

import {
  BALANCE,
  dropIntervalMs,
} from "../../../src/ts/utils/stack-attack/balance";
import {
  createStackAttackEngine,
  type StackAttackEngine,
  type StackAttackState,
} from "../../../src/ts/utils/stack-attack/engine";

function makeEngine(
  words: string[],
  opts: { cols?: number; rows?: number } = {},
): { engine: StackAttackEngine; state: () => StackAttackState } {
  let i = 0;
  const engine = createStackAttackEngine({
    spawnWord: () => words[i++ % words.length] ?? "cat",
    cols: opts.cols,
    rows: opts.rows,
  });
  return { engine, state: () => engine.state() };
}

/** types the falling block's word fully (locks it) */
function lockBlock(engine: StackAttackEngine): StackAttackState {
  let state = engine.state();
  const word = state.falling?.word ?? "";
  for (const ch of word) {
    state = engine.feedKey(ch);
  }
  return state;
}

describe("stack attack engine (idea G12 phase 1)", () => {
  it("spawns the first block centered above the grid", () => {
    const { state } = makeEngine(["cat"]);
    const falling = state().falling;
    expect(falling?.word).toBe("cat");
    expect(falling?.row).toBe(-1);
    expect(falling?.col).toBe(3); //(10-3)/2 with even split floor
    expect(falling?.typedIdx).toBe(0);
  });

  it("the block falls cell-stepwise and rests on the floor", () => {
    const { engine, state } = makeEngine(["cat"]);
    //drive the fall: 14 rows at the level-1 interval
    for (let i = 0; i < 30; i++) engine.tick(dropIntervalMs(1) + 10);
    const falling = state().falling;
    expect(falling?.resting).toBe(true);
    expect(falling?.row).toBe(BALANCE.rows - 1); //the bottom row
    //further ticks do not sink it deeper
    engine.tick(dropIntervalMs(1) + 10);
    expect(state().falling?.row).toBe(BALANCE.rows - 1);
  });

  it("typing locks the resting block into the grid (len x 5 x chain)", () => {
    const { engine } = makeEngine(["cat"]);
    for (let i = 0; i < 30; i++) engine.tick(dropIntervalMs(1) + 10);
    const s = lockBlock(engine);
    expect(s.falling?.word).toBe("cat"); //the next block arrived
    expect(s.blocksLocked).toBe(1);
    //a no-wrong-key chain pays x1.5: 3 x 5 x 1.5 = 22.5 -> 22? no: exact
    expect(s.score).toBe(3 * BALANCE.lockScorePerChar * BALANCE.chainLockMult);
    expect(s.grid[BALANCE.rows - 1]?.[3]?.letter).toBe("c");
    expect(s.grid[BALANCE.rows - 1]?.[5]?.letter).toBe("t");
  });

  it("a wrong key breaks the chain but keeps the typed progress", () => {
    const { engine, state } = makeEngine(["cat", "dog"]);
    for (let i = 0; i < 30; i++) engine.tick(dropIntervalMs(1) + 10);
    engine.feedKey("c");
    engine.feedKey("a");
    engine.feedKey("z"); //wrong: the chain breaks, typed stays
    let s = state();
    expect(s.comboEligible).toBe(false);
    expect(s.falling?.typedIdx).toBe(2);
    //the lock after a wrong key pays the plain rate
    engine.feedKey("t");
    s = state();
    expect(s.score).toBe(3 * BALANCE.lockScorePerChar);
    expect(s.blocksLocked).toBe(1);
  });

  it("arrow steering moves the block and refuses interference", () => {
    const { engine, state } = makeEngine(["cat"]);
    engine.moveCol(-1); //3 -> 2
    expect(state().falling?.col).toBe(2);
    engine.moveCol(-1);
    engine.moveCol(-1);
    engine.moveCol(-1); //0
    expect(state().falling?.col).toBe(0);
    engine.moveCol(-1); //refused: out of bounds
    expect(state().falling?.col).toBe(0);
    engine.moveCol(1);
    expect(state().falling?.col).toBe(1);
  });

  it("a full row clears and scores x lines x lines; level-up every 5 rows", () => {
    //2-wide grid: a 2-letter block locks a full row in one shot
    const { engine, state } = makeEngine(["ab", "cd", "ef", "gh", "ij"], {
      cols: 2,
      rows: 6,
    });
    //lock 5 rows: level 1 -> 2 at 5 rows
    for (let i = 0; i < 5; i++) {
      for (let t = 0; t < 40; t++) engine.tick(dropIntervalMs(1) + 10);
      lockBlock(engine);
    }
    const s = state();
    expect(s.rowsCleared).toBe(5);
    expect(s.level).toBe(2); //1 + floor(5/5)
    //row scoring: five 100 x 1 x 1 clears
    expect(s.score).toBe(
      5 * BALANCE.rowScore +
        5 * (2 * BALANCE.lockScorePerChar * BALANCE.chainLockMult),
    );
  });

  it("a lock poking above the grid ends the run", () => {
    //a 3-wide grid with 2-letter blocks: locks fill cols 0-1 only, so no
    //row ever clears and the stack climbs to the top
    const { engine, state } = makeEngine(["ab"], { cols: 3, rows: 3 });
    for (let i = 0; i < 3; i++) {
      for (let t = 0; t < 40; t++) engine.tick(dropIntervalMs(1) + 10);
      lockBlock(engine);
    }
    //the stack fills the grid; the 4th block rests at -1 -> gameover
    for (let t = 0; t < 40; t++) engine.tick(dropIntervalMs(1) + 10);
    lockBlock(engine);
    const s = state();
    expect(s.phase).toBe("done");
    expect(s.result).toBeDefined();
  });

  it("dropInterval decreases with the level", () => {
    expect(dropIntervalMs(1)).toBe(BALANCE.dropIntervalStartMs);
    expect(dropIntervalMs(2)).toBe(
      BALANCE.dropIntervalStartMs - BALANCE.dropIntervalStepMs,
    );
    expect(dropIntervalMs(100)).toBe(BALANCE.dropIntervalMinMs);
  });

  it("the snapshot hands out fresh grid references (the KI-34 lesson)", () => {
    const { state } = makeEngine(["cat"]);
    const a = state().falling;
    const b = state().falling;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
