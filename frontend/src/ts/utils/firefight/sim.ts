import { BALANCE } from "./balance";

/**
 * Firefight fire simulation (idea G16, phase 1): the pure cell-level fire
 * — intact -> burning -> ashes, one new ignition per burning cell per
 * spread tick (the interval shrinks from 6s to 2.5s across the run). The
 * typing/hose layer lives in engine.ts. PURE: the rng is injected.
 */

export type FireCellState = "intact" | "burning" | "ashes";

export type FireCell = {
  state: FireCellState;
  /** assigned when the cell ignites; cleared on ashes */
  word: string | undefined;
  /** the player's progress on THIS cell's word (the active cell only) */
  typed: number;
  /** the elapsed-ms moment the cell ignited */
  ignitedAtMs: number;
};

export type FireSim = {
  tick(dtMs: number): void;
  cells: FireCell[];
  /** indices of the currently burning cells */
  burningIndices(): number[];
  intactNeighborCount(idx: number): number;
  ashCount(): number;
  ashRatio(): number;
  elapsedMs: number;
  /** the spread interval at a given elapsed moment (shrinks over the run) */
  spreadIntervalAt(elapsedMs: number): number;
};

export function neighborsOf(idx: number, cols: number, rows: number): number[] {
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  const out: number[] = [];
  if (y > 0) out.push(idx - cols);
  if (y < rows - 1) out.push(idx + cols);
  if (x > 0) out.push(idx - 1);
  if (x < cols - 1) out.push(idx + 1);
  return out;
}

export function createFireSim(options: {
  cols?: number;
  rows?: number;
  /** supplies the word for every newly ignited cell */
  wordFor: () => string;
  rng: () => number;
  surviveMs?: number;
}): FireSim {
  const cols = options.cols ?? BALANCE.cols;
  const rows = options.rows ?? BALANCE.rows;
  const surviveMs = options.surviveMs ?? BALANCE.surviveMs;
  const cells: FireCell[] = Array.from({ length: cols * rows }, () => ({
    state: "intact" as FireCellState,
    word: undefined,
    typed: 0,
    ignitedAtMs: 0,
  }));
  let elapsedMs = 0;
  let spreadAcc = 0;
  const rng = options.rng;

  function spreadIntervalAt(atMs: number): number {
    const progress = Math.min(1, atMs / surviveMs);
    return Math.round(
      BALANCE.spreadStartMs -
        (BALANCE.spreadStartMs - BALANCE.spreadMinMs) * progress,
    );
  }

  function ignite(idx: number): void {
    const cell = cells[idx];
    if (cell?.state !== "intact") return;
    cell.state = "burning";
    cell.word = options.wordFor();
    cell.typed = 0;
    cell.ignitedAtMs = elapsedMs;
  }

  //the initial ignition: one random cell (doc G16 §۰.۱)
  ignite(Math.floor(rng() * cells.length));

  function spreadOnce(): void {
    const burning = cells
      .map((cell, idx) => (cell.state === "burning" ? idx : -1))
      .filter((idx) => idx >= 0);
    for (const idx of burning) {
      const intact = neighborsOf(idx, cols, rows).filter(
        (n) => cells[n]?.state === "intact",
      );
      if (intact.length === 0) continue;
      const pick = intact[Math.floor(rng() * intact.length)];
      if (pick !== undefined) ignite(pick);
    }
  }

  return {
    cells,
    tick(dtMs) {
      elapsedMs += dtMs;
      //burn-out: a burning cell goes to ashes after the burn duration
      for (const cell of cells) {
        if (
          cell.state === "burning" &&
          elapsedMs - cell.ignitedAtMs >= BALANCE.burnDurationMs
        ) {
          cell.state = "ashes";
          cell.word = undefined;
          cell.typed = 0;
        }
      }
      //the spread: each burning cell catches one intact neighbor per tick
      spreadAcc += dtMs;
      const interval = spreadIntervalAt(elapsedMs);
      while (spreadAcc >= interval) {
        spreadAcc -= interval;
        spreadOnce();
      }
    },
    burningIndices() {
      return cells
        .map((cell, idx) => (cell.state === "burning" ? idx : -1))
        .filter((idx) => idx >= 0);
    },
    intactNeighborCount(idx: number): number {
      return neighborsOf(idx, cols, rows).filter(
        (n) => cells[n]?.state === "intact",
      ).length;
    },
    ashCount() {
      return cells.filter((cell) => cell.state === "ashes").length;
    },
    ashRatio() {
      return cells.length === 0 ? 0 : this.ashCount() / cells.length;
    },
    //a GETTER: the shorthand `elapsedMs,` would snapshot the zero from
    //object creation and never track the ticking closure variable
    get elapsedMs() {
      return elapsedMs;
    },
    spreadIntervalAt,
  };
}
