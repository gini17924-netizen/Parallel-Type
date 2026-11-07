import { BALANCE, dropIntervalMs } from "./balance";
import {
  canPlace,
  clearFullRows,
  emptyGrid,
  place,
  refillRows,
  supportedBelow,
  type Grid,
} from "./grid";

/**
 * Stack Attack engine (idea G12, phase 1): a word-block falls cell-step
 * through a 10x14 grid; the player types the word (a wrong key breaks the
 * no-wrong-key chain but keeps the progress) and steers the column with
 * Left/Right. Completing the word snaps the block down onto the stack and
 * locks it; full rows clear (score x lines x lines) and everything above
 * shifts down; a lock poking above the grid ends the run. The block that
 * landed on the stack rests there until its word completes — the only
 * loss is the player's own locks piling to the top (doc G12 §۰.۴).
 *
 * PURE: the injected spawnWord callback supplies the words; the fall is
 * cell-stepwise at a decreasing dropInterval. The snapshot hands out a
 * fresh grid copy every call (the KI-34 lesson).
 */

export type StackAttackPhase = "running" | "done";

export type FallingBlock = {
  wordId: number;
  word: string;
  col: number;
  /** the block's row; -1 = entering above the grid */
  row: number;
  typedIdx: number;
  resting: boolean;
};

export type StackAttackResult = {
  score: number;
  rowsCleared: number;
  level: number;
  blocksLocked: number;
};

export type StackAttackState = {
  phase: StackAttackPhase;
  score: number;
  level: number;
  rowsCleared: number;
  blocksLocked: number;
  comboEligible: boolean;
  grid: Grid;
  falling: FallingBlock | undefined;
  result: StackAttackResult | undefined;
};

export type StackAttackEngine = {
  state(): StackAttackState;
  /** the cell-step fall (when the block is not resting) */
  tick(dtMs: number): StackAttackState;
  /** a letter against the falling block's word */
  feedKey(key: string): StackAttackState;
  /** Left/Right steering (the page throttles the repeat) */
  moveCol(dir: -1 | 1): StackAttackState;
};

export function createStackAttackEngine(options: {
  /** supplies the next block's word for a level */
  spawnWord: (level: number) => string;
  cols?: number;
  rows?: number;
}): StackAttackEngine {
  const cols = options.cols ?? BALANCE.cols;
  const rows = options.rows ?? BALANCE.rows;
  let phase: StackAttackPhase = "running";
  let score = 0;
  let level = 1;
  let rowsCleared = 0;
  let blocksLocked = 0;
  let comboEligible = true; //no wrong key since the last lock
  let nextWordId = 1;
  let dropAcc = 0;
  const grid: Grid = emptyGrid(rows, cols);
  let falling: FallingBlock | undefined;

  function snapshot(): StackAttackState {
    return {
      phase,
      score,
      level,
      rowsCleared,
      blocksLocked,
      comboEligible,
      grid: grid.map((row) =>
        row.map((cell) => (cell ? { ...cell } : undefined)),
      ),
      falling: falling ? { ...falling } : undefined,
      result:
        phase === "done"
          ? { score, rowsCleared, level, blocksLocked }
          : undefined,
    };
  }

  function spawnBlock(): void {
    const word = options.spawnWord(level);
    const col = Math.max(0, Math.floor((cols - word.length) / 2));
    falling = {
      wordId: nextWordId++,
      word,
      col,
      row: -1, //entering above the grid
      typedIdx: 0,
      resting: false,
    };
    dropAcc = 0;
  }

  spawnBlock();

  function stepDown(): void {
    if (falling === undefined || falling.resting) return;
    if (supportedBelow(grid, falling.row, falling.col, falling.word.length)) {
      falling.resting = true; //landed on the stack or the floor
      return;
    }
    falling.row += 1;
  }

  function lock(): void {
    if (falling === undefined) return;
    //gravity snap: the completed block drops to its resting position
    while (
      !supportedBelow(grid, falling.row, falling.col, falling.word.length)
    ) {
      falling.row += 1;
    }
    if (falling.row < 0) {
      //a locked block poking above the grid: the run is over (doc G12 §۰.۴)
      phase = "done";
      falling = undefined;
      return;
    }
    place(grid, falling.row, falling.col, falling.word, falling.wordId);
    blocksLocked += 1;
    score +=
      falling.word.length *
      BALANCE.lockScorePerChar *
      (comboEligible ? BALANCE.chainLockMult : 1);
    comboEligible = true;
    const lines = clearFullRows(grid);
    if (lines > 0) {
      rowsCleared += lines;
      score += BALANCE.rowScore * lines * lines;
      level = 1 + Math.floor(rowsCleared / BALANCE.rowsPerLevel);
    }
    falling = undefined;
    refillRows(grid, rows, cols);
    spawnBlock();
  }

  return {
    state: () => snapshot(),
    tick(dtMs) {
      if (phase !== "running") return snapshot();
      if (falling === undefined || falling.resting) return snapshot();
      dropAcc += dtMs;
      const interval = dropIntervalMs(level);
      while (dropAcc >= interval && falling !== undefined) {
        dropAcc -= interval;
        stepDown();
      }
      return snapshot();
    },
    feedKey(key) {
      if (phase !== "running") return snapshot();
      if (falling === undefined) return snapshot();
      if (key.length !== 1) return snapshot();
      const ch = key.toLowerCase();
      const expected = falling.word[falling.typedIdx]?.toLowerCase();
      if (expected !== ch) {
        //a wrong key breaks the no-wrong-key chain (typed stays — the
        //Word Blast semantics)
        comboEligible = false;
        return snapshot();
      }
      falling.typedIdx += 1;
      if (falling.typedIdx >= falling.word.length) lock();
      return snapshot();
    },
    moveCol(dir) {
      if (phase !== "running") return snapshot();
      if (falling === undefined) return snapshot();
      const target = falling.col + dir;
      //lateral interference: the target columns at the current row must
      //be empty (falling into gaps below is the fall's own business)
      if (!canPlace(grid, falling.row, target, falling.word.length)) {
        return snapshot();
      }
      falling.col = target;
      //steering off a ledge un-rests the block
      falling.resting = !supportedBelow(
        grid,
        falling.row,
        falling.col,
        falling.word.length,
      )
        ? false
        : falling.resting;
      return snapshot();
    },
  };
}
